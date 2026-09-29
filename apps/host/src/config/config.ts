import path from "node:path";

import { z } from "zod";

import { isLoopbackHost } from "../paths.js";
import {
  atomicWriteJson,
  fileExists,
  isMissingFileError,
  readJsonObjectFile,
  resolveConfigTargetPaths,
} from "./store.js";

export const providerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Provider-specific settings passed to the adapter factory, never to clients. */
  config: z.record(z.string(), z.json()).default({}),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const hostConfigSchema = z.object({
  host: z
    .object({
      port: z.number().int().min(0).max(65_535).default(8787),
      bindAddress: z.string().min(1).default("127.0.0.1"),
      logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    })
    .default(() => ({ port: 8787, bindAddress: "127.0.0.1", logLevel: "info" as const })),
  /** Configured project roots. The only locations agents may ever run in. */
  projectRoots: z.array(z.string().min(1)).default([]),
  /** How many directory levels below each root are scanned for repositories. */
  projectScanDepth: z.number().int().min(1).max(8).default(3),
  auth: z
    .object({
      mode: z.enum(["none", "dev-token", "device"]).default("device"),
      /** Required only for explicit `dev-token` mode; at least 32 characters. */
      devToken: z.string().min(32).max(4_096).optional(),
    })
    .default(() => ({ mode: "device" as const })),
  providers: z.record(z.string(), providerConfigSchema).default({}),
});
export type HostConfig = z.infer<typeof hostConfigSchema>;

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export interface LoadConfigOptions {
  /** Explicit config file path (from `--config`). */
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Override the Homebase state directory (tests). */
  stateDir?: string;
  /** Receives migration and compatibility notices for the operator. */
  onNotice?: (message: string) => void;
  /** Set to false to disable legacy cwd-config migration (tests). */
  migrateLegacy?: boolean;
}

export interface LoadedConfig {
  config: HostConfig;
  /** File that was loaded, or null when Homebase used built-in defaults. */
  configPath: string | null;
  /** Legacy file that was copied into the user-scoped location, if any. */
  migratedFrom: string | null;
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const location = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${location}: ${issue.message}`;
  });
}

function applyEnvOverrides(raw: Record<string, unknown>, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const result = structuredClone(raw);
  const host = { ...((result.host as Record<string, unknown> | undefined) ?? {}) };
  const auth = { ...((result.auth as Record<string, unknown> | undefined) ?? {}) };

  if (env.HOMEBASE_PORT !== undefined && env.HOMEBASE_PORT !== "") {
    host.port = Number(env.HOMEBASE_PORT);
  }
  if (env.HOMEBASE_BIND_ADDRESS) {
    host.bindAddress = env.HOMEBASE_BIND_ADDRESS;
  }
  if (env.HOMEBASE_LOG_LEVEL) {
    host.logLevel = env.HOMEBASE_LOG_LEVEL;
  }
  if (env.HOMEBASE_DEV_TOKEN) {
    auth.devToken = env.HOMEBASE_DEV_TOKEN;
    auth.mode = "dev-token";
  }
  if (env.HOMEBASE_AUTH_MODE) auth.mode = env.HOMEBASE_AUTH_MODE;
  if (env.HOMEBASE_PROJECT_ROOTS) {
    result.projectRoots = env.HOMEBASE_PROJECT_ROOTS.split(path.delimiter).filter((entry) => entry.trim().length > 0);
  }

  result.host = host;
  result.auth = auth;
  return result;
}

/**
 * Security invariants that must hold before the Host starts. These are
 * release-blocking product rules, not warnings.
 */
export function assertSecurityInvariants(config: HostConfig): void {
  const issues: string[] = [];

  if (!isLoopbackHost(config.host.bindAddress) && config.auth.mode === "none") {
    issues.push(
      `host.bindAddress is "${config.host.bindAddress}" but auth.mode is "none". ` +
        `Non-loopback binds require authentication. Use auth.mode "dev-token" for development, or keep the default 127.0.0.1 and reach the Host over a private network such as Tailscale.`,
    );
  }

  if (config.auth.mode === "dev-token" && (config.auth.devToken ?? "").length < 32) {
    issues.push(`auth.devToken must be at least 32 characters when auth.mode is "dev-token".`);
  }

  for (const root of config.projectRoots) {
    if (!path.isAbsolute(root)) {
      issues.push(`projectRoots entries must be absolute paths: "${root}".`);
    }
  }

  if (issues.length > 0) {
    throw new ConfigError("Homebase configuration failed security validation.", issues);
  }
}

/**
 * Validates a raw configuration object with the full schema and security
 * invariants. Used by load, migration, and local config mutation paths so a
 * file is never persisted or started from in a state the Host would reject.
 */
export function validateHostConfigRaw(raw: Record<string, unknown>, label = "Homebase configuration"): HostConfig {
  const result = hostConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid ${label}.`, describeIssues(result.error));
  }
  assertSecurityInvariants(result.data);
  return result.data;
}

/**
 * Loads, merges, validates, and security-checks configuration.
 *
 * Precedence: explicit `--config` → `HOMEBASE_CONFIG` → user-scoped
 * `${HOMEBASE_STATE_DIR:-~/.homebase}/config.json` (with one-time migration of
 * a legacy `./homebase.config.json`) → built-in defaults plus env overrides.
 */
export async function loadConfigDetailed(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const target = resolveConfigTargetPaths({
    ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
    env,
    cwd,
    ...(options.stateDir !== undefined ? { stateDir: options.stateDir } : {}),
  });

  let migratedFrom: string | null = null;
  const configPath = target.explicit ? target.configPath : target.userConfigPath;

  if (!target.explicit && !(await fileExists(configPath))) {
    if ((options.migrateLegacy ?? true) && (await fileExists(target.legacyPath))) {
      let legacyRaw: Record<string, unknown>;
      try {
        legacyRaw = await readJsonObjectFile(target.legacyPath);
        validateHostConfigRaw(legacyRaw, `legacy configuration at ${target.legacyPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ConfigError(
          `Homebase found a legacy configuration at ${target.legacyPath} but could not migrate it.`,
          [message],
        );
      }
      // Copy the validated legacy file into the private user-scoped location.
      // The legacy file is intentionally left in place for the user to remove.
      await atomicWriteJson(configPath, legacyRaw);
      migratedFrom = target.legacyPath;
      options.onNotice?.(
        `Homebase migrated ${target.legacyPath} to ${configPath}. The original file was left in place; ` +
          `future commands use the user-scoped configuration from any directory.`,
      );
    }
  }

  let raw: Record<string, unknown> = {};
  let loadedFromFile = false;
  try {
    raw = await readJsonObjectFile(configPath);
    loadedFromFile = true;
  } catch (error) {
    if (isMissingFileError(error) && !target.explicit) {
      // No config file and none was requested: use defaults plus env overrides.
    } else {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConfigError(`Failed to load Homebase configuration from ${configPath}.`, [message]);
    }
  }

  const merged = applyEnvOverrides(raw, env);
  const config = validateHostConfigRaw(merged);
  return {
    config,
    configPath: loadedFromFile || migratedFrom !== null ? configPath : null,
    migratedFrom,
  };
}

/** Convenience wrapper returning only the validated configuration. */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<HostConfig> {
  return (await loadConfigDetailed(options)).config;
}

/** Safe configuration summary for startup logs. Never contains secrets. */
export function configSummary(config: HostConfig): Record<string, unknown> {
  return {
    port: config.host.port,
    bindAddress: config.host.bindAddress,
    logLevel: config.host.logLevel,
    authMode: config.auth.mode,
    projectRoots: [...config.projectRoots],
    projectScanDepth: config.projectScanDepth,
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([id, provider]) => [id, { enabled: provider.enabled }]),
    ),
  };
}
