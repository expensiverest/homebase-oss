import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Durable, user-scoped configuration storage.
 *
 * Homebase is a machine-level local service, not a per-repository CLI, so the
 * default configuration lives next to the rest of the Host state in
 * `${HOMEBASE_STATE_DIR:-~/.homebase}/config.json`. A legacy
 * `./homebase.config.json` in the current working directory is still honored
 * once and migrated into the user-scoped location (the legacy file is never
 * deleted). Explicit `--config` and `HOMEBASE_CONFIG` always win.
 */

export const USER_CONFIG_FILENAME = "config.json";
export const LEGACY_CONFIG_FILENAME = "homebase.config.json";

const IS_WINDOWS = process.platform === "win32";

/** Resolves the Homebase state directory, matching DeviceState's convention. */
export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HOMEBASE_STATE_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".homebase");
}

export interface ConfigTargetPaths {
  /** True when `--config` or `HOMEBASE_CONFIG` selected the path explicitly. */
  explicit: boolean;
  /** File the Host should load (and CLI project commands should edit). */
  configPath: string;
  /** User-scoped default, used as the migration destination. */
  userConfigPath: string;
  /** Legacy per-directory config candidate. */
  legacyPath: string;
}

export interface ResolveConfigTargetOptions {
  /** Explicit `--config` path. */
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Override the state directory (tests). */
  stateDir?: string;
}

/** Resolves which config file is active, without reading it. */
export function resolveConfigTargetPaths(options: ResolveConfigTargetOptions = {}): ConfigTargetPaths {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const stateDir = options.stateDir ?? resolveStateDir(env);
  const userConfigPath = path.join(stateDir, USER_CONFIG_FILENAME);
  const legacyPath = path.join(cwd, LEGACY_CONFIG_FILENAME);
  const explicitValue = options.configPath ?? env.HOMEBASE_CONFIG;
  if (explicitValue !== undefined && explicitValue.trim() !== "") {
    return { explicit: true, configPath: path.resolve(explicitValue), userConfigPath, legacyPath };
  }
  return { explicit: false, configPath: userConfigPath, userConfigPath, legacyPath };
}

export function isMissingFileError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT";
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

/** Reads a JSON object file. Throws with the file path for actionable errors. */
export async function readJsonObjectFile(filePath: string): Promise<Record<string, unknown>> {
  const text = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Homebase configuration at ${filePath} is not valid JSON: ${message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Homebase configuration at ${filePath} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/** Creates a directory that only the current user can read where supported. */
export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!IS_WINDOWS) await chmod(directory, 0o700);
}

/**
 * Atomic JSON persistence: private parent directory, unique temp file in the
 * same directory, fsync, then rename over the target. A process interruption
 * can never leave a half-written target file, and failures clean up the temp.
 */
export async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  const directory = path.dirname(target);
  await ensurePrivateDirectory(directory);
  const temp = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  if (!IS_WINDOWS) await chmod(target, 0o600);
}
