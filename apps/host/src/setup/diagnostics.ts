import { access, readFile, realpath, stat, constants } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveExecutable, redactSecrets } from "@homebase/adapter-sdk";
import { z } from "zod";
import { AdminClient } from "../cli/admin.js";
import { readJsonObjectFile, validateHostConfigRaw, type HostConfig } from "../config/index.js";
import { PathAllowlist, pathComparisonKey } from "../paths.js";
import { ProjectRegistry } from "../projects/index.js";
import { TailscaleClient, type TailscaleStatus } from "../remote/tailscale.js";
import { readHealth, type HostHealth } from "../service/health.js";
import { readServiceMetadata, type ServiceMetadata } from "../service/metadata.js";
import type { ServiceDefinition, ServiceManager } from "../service/types.js";
import { HOST_VERSION } from "../version.js";

export const diagnosticCheckSchema = z
  .object({ id: z.string(), status: z.enum(["pass", "warn", "fail"]), message: z.string() })
  .strict();
export const diagnosticReportSchema = z.object({ ok: z.boolean(), checks: z.array(diagnosticCheckSchema) }).strict();
export type DiagnosticCheck = z.infer<typeof diagnosticCheckSchema>;
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;
export const adminStatusSchema = z.object({
  version: z.string(),
  uptimeSeconds: z.number(),
  config: z.object({ port: z.number(), bindAddress: z.string(), authMode: z.enum(["none", "dev-token", "device"]) }),
  projects: z.object({ count: z.number() }),
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      installed: z.boolean(),
      authenticated: z.boolean().nullable(),
      compatible: z.boolean(),
      version: z.string().nullable().optional(),
      warning: z.string().nullable().optional(),
    }),
  ),
  devices: z.object({ total: z.number(), active: z.number() }),
});
export type AdminStatus = z.infer<typeof adminStatusSchema>;
export async function readAdminStatus(port: number, stateDir: string): Promise<AdminStatus | null> {
  try {
    const response = await new AdminClient({ port, stateDir }).call("/api/v1/admin/status", "GET");
    if (!response.ok) return null;
    return adminStatusSchema.parse(await response.json());
  } catch {
    return null;
  }
}
export interface DoctorOptions {
  configPath: string;
  stateDir: string;
  manager: ServiceManager;
  entryPath?: string;
  env?: NodeJS.ProcessEnv;
  health?: (port: number) => Promise<HostHealth | null>;
  status?: (port: number, stateDir: string) => Promise<AdminStatus | null>;
  tailscale?: { inspect(port: number): Promise<TailscaleStatus> };
  metadata?: () => Promise<ServiceMetadata | null>;
}
/** Read-only: no runtime construction, adapter detection, config loader/migration, or DeviceState.open. */
export async function runDoctor(options: DoctorOptions): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  const add = (id: string, status: DiagnosticCheck["status"], message: string) =>
    checks.push({ id, status, message: redactSecrets(message).slice(0, 600) });
  const env = options.env ?? process.env;
  const entry = options.entryPath ?? fileURLToPath(new URL("../index.js", import.meta.url));
  add(
    "runtime.node",
    Number(process.versions.node.split(".")[0]) >= 22 ? "pass" : "fail",
    `Node ${process.versions.node}; Node 22 or later is required.`,
  );
  add("runtime.cli", "pass", `Homebase CLI ${HOST_VERSION}`);
  add("runtime.entry", (await accessible(entry)) ? "pass" : "fail", `CLI entrypoint: ${entry}`);
  let config: HostConfig | null = null;
  try {
    config = validateHostConfigRaw(await readJsonObjectFile(options.configPath));
    add("config.valid", "pass", `Configuration valid: ${options.configPath}`);
  } catch {
    add("config.valid", "fail", `Configuration is missing or invalid: ${options.configPath}. Run \`homebase setup\`.`);
  }
  try {
    await access(options.stateDir, constants.R_OK | constants.W_OK);
    const info = await stat(options.stateDir);
    add("state.access", info.isDirectory() ? "pass" : "fail", `State directory: ${options.stateDir}`);
    if (process.platform !== "win32") {
      add("state.permissions", (info.mode & 0o077) === 0 ? "pass" : "warn", "State directory should have mode 0700.");
      for (const filename of [
        options.configPath,
        path.join(options.stateDir, "admin-key"),
        path.join(options.stateDir, "security.json"),
        path.join(options.stateDir, "service.json"),
      ]) {
        try {
          add(
            `permissions.${path.basename(filename)}`,
            ((await stat(filename)).mode & 0o077) === 0 ? "pass" : "warn",
            `${filename} should be private to its owner (0600).`,
          );
        } catch {
          /* Missing checked elsewhere. */
        }
      }
    }
  } catch {
    add("state.access", "fail", "Homebase state directory is unavailable. Run `homebase setup`.");
  }
  if (config) {
    for (let i = 0; i < config.projectRoots.length; i++) {
      const root = config.projectRoots[i]!;
      try {
        const canonical = await realpath(root);
        add(`projects.root.${i}`, (await stat(canonical)).isDirectory() ? "pass" : "fail", `Project root: ${root}`);
        add(
          `projects.canonical.${i}`,
          pathComparisonKey(canonical) === pathComparisonKey(root) ? "pass" : "warn",
          "Project root canonical path checked.",
        );
      } catch {
        add(`projects.root.${i}`, "fail", `Project root is missing or inaccessible: ${root}`);
      }
    }
    if (config.projectRoots.length === 0)
      add("projects.roots", "warn", "No project folders configured. Run `homebase projects add <folder>`.");
    try {
      const { allowlist } = await PathAllowlist.create(config.projectRoots);
      const registry = new ProjectRegistry({
        roots: allowlist.roots,
        allowlist,
        scanDepth: config.projectScanDepth,
        git: { read: async () => ({ branch: null, remote: null, gitRoot: null }) },
      });
      await registry.discover();
      for (const project of registry.list()) await registry.resolvePath(project.id);
      add("projects.discovery", "pass", `${registry.list().length} projects discovered inside the allowlist.`);
    } catch {
      add("projects.discovery", "fail", "Project discovery/allowlist check failed.");
    }
  }
  let metadata: ServiceMetadata | null = null;
  try {
    metadata = await (options.metadata ?? (() => readServiceMetadata(options.stateDir)))();
    add(
      "service.metadata",
      metadata ? "pass" : "warn",
      metadata ? `Installed service metadata: ${metadata.homebaseVersion}` : "Service metadata is absent.",
    );
  } catch {
    add(
      "service.metadata",
      "warn",
      "Service metadata is corrupt. OS service state was left unchanged; inspect `homebase service status`.",
    );
  }
  const available = await options.manager.isAvailable();
  add(
    "service.manager",
    available ? "pass" : "warn",
    available
      ? `Service manager: ${options.manager.kind}`
      : "User service manager unavailable; Homebase can run manually.",
  );
  if (available) {
    try {
      const state = await options.manager.inspect();
      add(
        "service.installed",
        state.installed ? "pass" : "warn",
        state.installed
          ? "Background service installed."
          : "Background service is not installed. Run `homebase setup`.",
      );
      if (state.installed) {
        add(
          "service.enabled",
          state.enabled ? "pass" : "warn",
          state.enabled
            ? "Background service starts with the user session."
            : "Background service autostart is disabled.",
        );
        add(
          "service.running",
          state.running ? "pass" : "warn",
          state.running ? "Background service running." : "Background service stopped. Run `homebase service start`.",
        );
        if (metadata) {
          add(
            "service.definition",
            options.manager.matches(state, metadata) ? "pass" : "fail",
            "Installed native command compared with Homebase metadata. Repair differences with `homebase setup`.",
          );
          add(
            "service.version",
            metadata.homebaseVersion === HOST_VERSION ? "pass" : "warn",
            `CLI ${HOST_VERSION}; installed service ${metadata.homebaseVersion}. Run \`homebase upgrade\` after updating source.`,
          );
          add(
            "service.entry",
            pathComparisonKey(metadata.entryPath) === pathComparisonKey(entry) ? "pass" : "warn",
            "Service entrypoint compared with this CLI. Refresh with `homebase upgrade` if the source moved.",
          );
          add(
            "service.config",
            pathComparisonKey(metadata.configPath) === pathComparisonKey(options.configPath) ? "pass" : "warn",
            `Service config: ${metadata.configPath}`,
          );
        }
      }
    } catch {
      add("service.inspect", "warn", "Could not inspect native service state. Run `homebase service status`.");
    }
  }
  if (metadata) {
    for (const field of ["nodePath", "entryPath", "configPath"] as const)
      add(
        `service.file.${field}`,
        (await accessible(metadata[field])) ? "pass" : "fail",
        `${field}: ${metadata[field]}. Repair missing paths with \`homebase setup\`.`,
      );
    const commands = ["claude", "opencode", "grok", "tailscale"];
    for (const command of commands) {
      const executable = config?.providers[command]?.config.executable;
      const name = typeof executable === "string" ? executable : command;
      const interactive = resolveExecutable(name, env);
      const background = resolveExecutable(name, { PATH: metadata.path, PATHEXT: ".COM;.EXE;.BAT;.CMD" });
      add(
        `service.path.${command}`,
        interactive.found &&
          (!background.found || pathComparisonKey(interactive.command) !== pathComparisonKey(background.command))
          ? "warn"
          : "pass",
        `${command}: terminal and service PATH compared. Re-run setup after PATH changes.`,
      );
    }
  }
  if (
    [
      "XAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GOOGLE_API_KEY",
      "GEMINI_API_KEY",
      "HOMEBASE_DEV_TOKEN",
    ].some((name) => !!env[name])
  )
    add(
      "providers.environment",
      "warn",
      "Shell-local credentials may make terminal providers usable but are not copied into service files. Prefer the provider's saved CLI login.",
    );
  if (config) {
    const health = await (options.health ?? readHealth)(config.host.port);
    add(
      "host.health",
      health ? "pass" : "fail",
      health
        ? `Homebase ${health.version} is healthy on 127.0.0.1:${config.host.port}.`
        : `Homebase is down or its API/protocol is incompatible on 127.0.0.1:${config.host.port}. Run \`homebase service start\`.`,
    );
    if (health)
      add(
        "host.version",
        health.version === HOST_VERSION ? "pass" : "warn",
        `Running ${health.version}; CLI ${HOST_VERSION}. Refresh with \`homebase upgrade\`.`,
      );
    const status = health ? await (options.status ?? readAdminStatus)(config.host.port, options.stateDir) : null;
    if (status) {
      add(
        "host.config",
        status.config.bindAddress === config.host.bindAddress &&
          (config.host.port === 0 || status.config.port === config.host.port) &&
          status.config.authMode === config.auth.mode
          ? "pass"
          : "warn",
        "Running Host configuration compared with disk.",
      );
      add("pairing.devices", "pass", `${status.devices.active} active paired devices (${status.devices.total} total).`);
      for (const provider of status.providers.filter((p) => p.id !== "mock"))
        add(
          `providers.${provider.id}`,
          provider.installed && provider.compatible && provider.authenticated !== false ? "pass" : "warn",
          `${provider.name}${provider.version ? ` ${provider.version}` : ""}: ${provider.installed ? (provider.authenticated === false ? "sign in required" : provider.compatible ? "available" : "incompatible") : "unavailable"}${provider.warning ? ` — ${provider.warning}` : ""}`,
        );
    } else
      add(
        "providers.runtime",
        "warn",
        "Provider runtime status unknown; doctor does not launch providers. Start the Host for safe cached status.",
      );
    add(
      "pairing.auth",
      config.auth.mode === "device" ? "pass" : "warn",
      `Authentication mode: ${config.auth.mode}. Private remote setup requires device auth.`,
    );
    const key = await readFile(path.join(options.stateDir, "admin-key"), "utf8").catch(() => "");
    add(
      "pairing.admin",
      /^[A-Za-z0-9_-]{43}$/.test(key.trim()) ? "pass" : "warn",
      "Machine-local admin state checked without printing credentials.",
    );
    const tailscale = await (options.tailscale ?? new TailscaleClient()).inspect(config.host.port);
    add(
      "tailscale.installed",
      tailscale.installed ? "pass" : "warn",
      tailscale.installed ? "Tailscale installed." : tailscale.message,
    );
    if (tailscale.installed) {
      add(
        "tailscale.connected",
        tailscale.connected ? "pass" : "warn",
        tailscale.connected ? "Tailscale connected." : tailscale.message,
      );
      add(
        "tailscale.serve",
        tailscale.serve === "funnel" ? "fail" : tailscale.serve === "correct" ? "pass" : "warn",
        tailscale.message,
      );
      if (tailscale.url && config.auth.mode !== "device")
        add(
          "tailscale.auth",
          "fail",
          "Serve exposes a Host without device auth. Disable that mapping or explicitly enable device auth before remote access.",
        );
    }
  }
  add("service.logs", "pass", `Logs: ${options.manager.logSource.replace("<state-dir>", options.stateDir)}`);
  return { ok: !checks.some((check) => check.status === "fail"), checks };
}
async function accessible(filename: string): Promise<boolean> {
  try {
    await access(filename, constants.R_OK);
    return (await stat(filename)).isFile();
  } catch {
    return false;
  }
}

export function formatDoctor(report: DiagnosticReport): string[] {
  const marks = { pass: "✓", warn: "!", fail: "✕" };
  return report.checks.map((check) => `${marks[check.status]} ${check.message}`);
}
export function definitionsEqual(a: ServiceDefinition, b: ServiceDefinition): boolean {
  return ["nodePath", "entryPath", "configPath", "stateDir", "path", "homebaseVersion"].every(
    (key) => a[key as keyof ServiceDefinition] === b[key as keyof ServiceDefinition],
  );
}
