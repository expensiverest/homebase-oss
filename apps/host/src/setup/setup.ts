import path from "node:path";
import {
  atomicWriteJson,
  ensurePrivateDirectory,
  fileExists,
  readJsonObjectFile,
  validateHostConfigRaw,
  addProjectRoot,
  LEGACY_CONFIG_FILENAME,
  type HostConfig,
} from "../config/index.js";
import type { CliIo } from "../cli/io.js";
import type { AgentProvider } from "@homebase/protocol";
import { runPairCommand } from "../cli/admin.js";
import { TailscaleClient } from "../remote/tailscale.js";
import { ServiceController } from "../service/service.js";
import { currentDefinition, readServiceMetadata } from "../service/metadata.js";
import { readHealth, portAvailable } from "../service/health.js";
import type { ServiceDefinition, ServiceManager } from "../service/types.js";
import { HOST_VERSION } from "../version.js";
import { detectProviders } from "./providers.js";
import { definitionsEqual, formatDoctor, readAdminStatus, runDoctor, type DiagnosticReport } from "./diagnostics.js";
import { SetupCancelled, type SetupPrompter } from "./prompts.js";

export interface SetupOptions {
  configPath: string;
  stateDir: string;
  cwd: string;
  io: CliIo;
  prompts: SetupPrompter;
  manager: ServiceManager;
  explicitConfig?: boolean;
  providers?: (
    config: HostConfig,
  ) => Promise<
    Array<Pick<AgentProvider, "id" | "name" | "installed" | "authenticated" | "compatible" | "version" | "warning">>
  >;
  tailscale?: Pick<TailscaleClient, "inspect" | "configure">;
  definition?: (configPath: string, stateDir: string) => Promise<ServiceDefinition>;
  controller?: (
    definition: ServiceDefinition,
    config: HostConfig,
  ) => Pick<ServiceController, "install" | "start" | "restart">;
  health?: typeof readHealth;
  portAvailable?: typeof portAvailable;
  pair?: (io: CliIo, options: { port: number; stateDir: string; url: string }) => Promise<void>;
  doctor?: () => Promise<DiagnosticReport>;
  status?: typeof readAdminStatus;
}
/** Business logic has no readline and all OS mutations are injectable. */
export async function runSetup(options: SetupOptions): Promise<number> {
  const { io, prompts, manager } = options;
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    io.out(`! ${message}`);
  };
  io.out(
    `Homebase setup ${HOST_VERSION}\nConfig: ${options.configPath}\nState: ${options.stateDir}\nPlatform: ${process.platform}`,
  );
  const managerAvailable = await manager.isAvailable();
  let existing = managerAvailable ? await manager.inspect() : { installed: false, running: false, enabled: false };
  io.out(`Service: ${existing.installed ? (existing.running ? "running" : "installed, stopped") : "not installed"}`);
  let changed = false;
  await ensurePrivateDirectory(options.stateDir);
  if (!(await fileExists(options.configPath))) {
    const legacy = path.join(options.cwd, LEGACY_CONFIG_FILENAME);
    let initial: Record<string, unknown> = {};
    if (
      !options.explicitConfig &&
      options.configPath === path.join(options.stateDir, "config.json") &&
      (await fileExists(legacy))
    ) {
      initial = await readJsonObjectFile(legacy);
      validateHostConfigRaw(initial);
      io.out("Migrating existing legacy configuration; the original is preserved.");
    }
    await atomicWriteJson(options.configPath, initial);
    changed = true;
  }
  // Never turn environment overrides into persisted configuration.
  let raw = await readJsonObjectFile(options.configPath);
  let config = validateHostConfigRaw(raw);
  await atomicWriteJson(path.join(options.stateDir, "state-owner.json"), {
    version: 1,
    product: "homebase",
    stateDir: options.stateDir,
  });
  io.out("✓ Configuration ready");
  io.out("\nProject folders:");
  for (const root of config.projectRoots) io.out(`✓ ${root}`);
  let add = config.projectRoots.length === 0 || (await prompts.confirm("Add another project folder?", false));
  while (add) {
    const root = await prompts.input("Project folder", options.cwd);
    try {
      const result = await addProjectRoot({ configPath: options.configPath, root });
      changed ||= result.changed;
      io.out(`✓ ${result.path}`);
    } catch (error) {
      if (error instanceof SetupCancelled) throw error;
      io.out(`! ${error instanceof Error ? error.message : "Project folder could not be added."}`);
      continue;
    }
    add = await prompts.confirm("Add another project folder?", false);
  }
  raw = await readJsonObjectFile(options.configPath);
  config = validateHostConfigRaw(raw);
  io.out("\nChecking coding agents...");
  const cached = await (options.status ?? readAdminStatus)(config.host.port, options.stateDir);
  const providers = options.providers
    ? await options.providers(config)
    : (cached?.providers ?? (await detectProviders(config)));
  for (const provider of providers.filter((p) => p.id !== "mock")) {
    const mark = !provider.installed ? "✕" : !provider.compatible || provider.authenticated === false ? "!" : "✓";
    io.out(
      `${mark} ${provider.name}${provider.version ? ` ${provider.version}` : ""}${provider.warning ? ` — ${provider.warning}` : ""}`,
    );
  }
  const install = await prompts.confirm("Install/update Homebase as a background service?", true);
  if (install) {
    let port = config.host.port;
    while (
      port === 0 ||
      (!(await (options.health ?? readHealth)(port)) && !(await (options.portAvailable ?? portAvailable)(port)))
    ) {
      io.out(
        port === 0
          ? "Background access needs a fixed port."
          : `Port ${port} is occupied. Homebase will leave that process alone.`,
      );
      const input = await prompts.input("Homebase port", "8787");
      const candidate = Number(input);
      if (!/^\d+$/.test(input) || !Number.isInteger(candidate) || candidate < 1 || candidate > 65535) {
        io.out("! Enter a port between 1 and 65535.");
        continue;
      }
      port = candidate;
    }
    if (port !== config.host.port) {
      const host = { ...((raw.host as Record<string, unknown> | undefined) ?? {}), port };
      raw = { ...raw, host };
      config = validateHostConfigRaw(raw);
      await atomicWriteJson(options.configPath, raw);
      changed = true;
    }
  }
  io.out("\nChecking Tailscale...");
  const tailscaleClient = options.tailscale ?? new TailscaleClient();
  let tailscale = await tailscaleClient.inspect(config.host.port);
  if (config.auth.mode !== "device")
    warn(
      "Private remote access requires device auth. Your explicit development auth was preserved; Serve setup and pairing are skipped.",
    );
  if (config.host.bindAddress !== "127.0.0.1")
    warn("Private setup requires host.bindAddress 127.0.0.1. Your custom bind was preserved; Serve setup is skipped.");
  if (tailscale.serve === "correct") io.out(`✓ ${tailscale.message}`);
  else if (
    tailscale.connected &&
    tailscale.serve === "missing" &&
    config.host.port > 0 &&
    config.auth.mode === "device" &&
    config.host.bindAddress === "127.0.0.1"
  ) {
    if (await prompts.confirm("Configure private Tailscale access for Homebase?", true)) {
      try {
        tailscale = await tailscaleClient.configure(config.host.port);
        io.out("✓ Private HTTPS access configured");
      } catch (error) {
        warn(error instanceof Error ? error.message : "Private Serve could not be configured.");
      }
    }
  } else warn(tailscale.message);
  let ready = !!(await (options.health ?? readHealth)(config.host.port));
  if (install && managerAvailable) {
    io.out("\nInstalling background service...");
    try {
      const definition = await (options.definition ?? currentDefinition)(options.configPath, options.stateDir);
      const controller =
        options.controller?.(definition, config) ??
        new ServiceController({ manager, definition, port: config.host.port });
      existing = await manager.inspect();
      const metadata = await readServiceMetadata(options.stateDir);
      const nativeCurrent = existing.installed && existing.enabled && manager.matches(existing, definition);
      const metadataCurrent =
        metadata &&
        definitionsEqual(metadata, definition) &&
        metadata.manager === manager.kind &&
        metadata.serviceIdentifier === manager.identifier;
      if (!nativeCurrent || !metadataCurrent) {
        await controller.install();
        io.out(nativeCurrent ? "✓ Homebase service metadata repaired" : "✓ Homebase service installed");
      }
      const runningHealth = existing.running ? await (options.health ?? readHealth)(config.host.port) : null;
      if (
        existing.running &&
        nativeCurrent &&
        (changed || (runningHealth && runningHealth.version !== definition.homebaseVersion))
      )
        await controller.restart();
      else await controller.start();
      ready = true;
      io.out("✓ Homebase running");
    } catch (error) {
      warn(error instanceof Error ? error.message : "Background service failed. Run `homebase doctor`.");
      ready = false;
    }
  } else if (install)
    warn(
      "Homebase could not install a background service because the user service manager is unavailable. Run `homebase` manually.",
    );
  else io.out("Run `homebase` for foreground use.");
  if (ready && config.auth.mode === "device" && tailscale.url && tailscale.serve === "correct") {
    if (await prompts.confirm("Pair a phone now?", true)) {
      try {
        await (options.pair ?? runPairCommand)(io, {
          port: config.host.port,
          stateDir: options.stateDir,
          url: tailscale.url,
        });
        await prompts.input("Press Enter after scanning, or finish pairing later");
        const after = await (options.status ?? readAdminStatus)(config.host.port, options.stateDir);
        if (after && after.devices.active > (cached?.devices.active ?? 0)) io.out("✓ New device paired");
      } catch (error) {
        if (error instanceof SetupCancelled) throw error;
        warn(error instanceof Error ? error.message : "Pair later with `homebase pair`.");
      }
    }
  } else
    io.out(
      "Pairing from another device requires private HTTPS. Run `homebase pair` after Tailscale Serve is configured.",
    );
  io.out("\nChecking installation...");
  const report = await (
    options.doctor ?? (() => runDoctor({ configPath: options.configPath, stateDir: options.stateDir, manager }))
  )();
  for (const line of formatDoctor(report).filter(
    (_line, i) =>
      report.checks[i]!.status !== "pass" ||
      ["host.health", "service.running", "projects.discovery", "pairing.devices", "tailscale.serve"].includes(
        report.checks[i]!.id,
      ),
  ))
    io.out(line);
  io.out(
    ready && report.ok && warnings.length === 0
      ? "\nHomebase is ready."
      : "\nSetup finished with items to review. Run `homebase doctor`; completed configuration was preserved.",
  );
  if (ready && tailscale.url && config.auth.mode === "device") io.out(`Open: ${tailscale.url}`);
  return report.ok && (!install || ready) ? 0 : 1;
}
