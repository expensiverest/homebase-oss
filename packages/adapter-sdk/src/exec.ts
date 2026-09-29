import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

/**
 * Safe cross-platform process execution helpers shared by adapters.
 *
 * Homebase never builds shell command strings from user content. Two platform
 * realities are handled here:
 *
 * - On Windows, npm-installed CLIs are `.cmd` shims, and Node refuses to spawn
 *   `.cmd`/`.bat` directly (`EINVAL`). Homebase resolves the real shim and
 *   invokes `cmd.exe /d /s /c` with a fixed, quoted argv. Command-line content
 *   is always Homebase-controlled; credentials go through the environment.
 * - On POSIX, `PATH` resolution and the executable bit are applied by hand so a
 *   missing CLI is reported as "not installed" instead of a raw spawn error.
 */

const IS_WINDOWS = process.platform === "win32";
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export interface ResolvedExecutable {
  /** Absolute path (or unresolved command name when nothing matched). */
  command: string;
  /** True when the resolved target is a Windows `.cmd`/`.bat` shim. */
  shim: boolean;
  /** True when a matching executable was found. */
  found: boolean;
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isExecutable(candidate: string): boolean {
  if (!isFile(candidate)) return false;
  if (IS_WINDOWS) return true;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathDirectories(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  return raw.split(path.delimiter).filter((entry) => entry.trim().length > 0);
}

function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  const pathext = env.PATHEXT ?? DEFAULT_PATHEXT;
  return pathext
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.length > 0);
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function isShimPath(candidate: string): boolean {
  const extension = path.extname(candidate).toLowerCase();
  return extension === ".cmd" || extension === ".bat";
}

/**
 * Resolves a command name to an executable the current platform can launch.
 * Absolute and relative paths are used as-is; bare names are searched on PATH.
 */
export function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env): ResolvedExecutable {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { command: trimmed, shim: false, found: false };

  if (hasPathSeparator(trimmed) || path.isAbsolute(trimmed)) {
    const absolute = path.resolve(trimmed);
    return { command: absolute, shim: IS_WINDOWS && isShimPath(absolute), found: isFile(absolute) };
  }

  for (const directory of pathDirectories(env)) {
    if (IS_WINDOWS) {
      for (const extension of windowsExtensions(env)) {
        const candidate = path.join(directory, `${trimmed}${extension}`);
        if (isFile(candidate)) {
          return { command: candidate, shim: isShimPath(candidate), found: true };
        }
      }
      // Some tools ship a bare extensionless launcher; prefer shims above it.
      const bare = path.join(directory, trimmed);
      if (isFile(bare)) return { command: bare, shim: false, found: true };
    } else {
      const candidate = path.join(directory, trimmed);
      if (isExecutable(candidate)) return { command: candidate, shim: false, found: true };
    }
  }

  return { command: trimmed, shim: false, found: false };
}

/** Quotes one argv element for `cmd.exe /d /s /c` without allowing injection. */
export function quoteWindowsArgument(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error("Command arguments must not contain line breaks or NUL bytes.");
  }
  if (value.length === 0) return '""';
  if (!/[\s"&<>|^()%!]/.test(value)) return value;
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  return `"${escaped}"`;
}

/**
 * Spawns an executable without a shell, with the safe Windows `.cmd` shim
 * fallback. Credentials must be passed through `env`, never in `args`.
 */
export function spawnExecutable(command: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  const env = options.env ?? process.env;
  const resolved = resolveExecutable(command, env);
  const base: SpawnOptions = {
    ...options,
    shell: false,
    windowsHide: options.windowsHide ?? true,
  };

  if (IS_WINDOWS && resolved.shim) {
    const comspec = env.ComSpec ?? process.env.ComSpec ?? "cmd.exe";
    for (const argument of args) {
      if (/[\r\n\0]/.test(argument)) {
        throw new Error("Command arguments must not contain line breaks or NUL bytes.");
      }
    }
    const line = [resolved.command, ...args].map(quoteWindowsArgument).join(" ");
    return spawn(comspec, ["/d", "/s", "/c", line], base);
  }

  return spawn(resolved.command, [...args], base);
}

export type ExecutableFailureKind = "not_found" | "timeout" | "failed";

export class ExecutableFailure extends Error {
  readonly kind: ExecutableFailureKind;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    kind: ExecutableFailureKind,
    message: string,
    options: { code?: number | null; stdout?: string; stderr?: string } = {},
  ) {
    super(message);
    this.name = "ExecutableFailure";
    this.kind = kind;
    this.code = options.code ?? null;
    this.stdout = options.stdout ?? "";
    this.stderr = options.stderr ?? "";
  }
}

export interface RunExecutableOptions {
  timeoutMs?: number;
  /** Per-stream output cap; output beyond it is discarded and flagged. */
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface RunExecutableResult {
  command: string;
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when either stream hit the output cap. */
  truncated: boolean;
}

/**
 * Runs a command with a bounded timeout and bounded output capture. Never uses
 * a shell (except the Windows `.cmd` shim fallback) and never inherits stdin.
 */
export async function runExecutable(
  command: string,
  args: readonly string[],
  options: RunExecutableOptions = {},
): Promise<RunExecutableResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
  const resolved = resolveExecutable(command, options.env);

  return await new Promise<RunExecutableResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnExecutable(
        command,
        args,
        options.env !== undefined ? { env: options.env, stdio: "pipe" } : { stdio: "pipe" },
      );
    } catch (error) {
      reject(new ExecutableFailure("failed", error instanceof Error ? error.message : String(error)));
      return;
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;

    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= maxOutputBytes) {
        truncated = true;
        return current;
      }
      const next = current + chunk.toString("utf8");
      if (next.length > maxOutputBytes) {
        truncated = true;
        return next.slice(0, maxOutputBytes);
      }
      return next;
    };

    child.stdout?.on("data", (chunk: Buffer) => (stdout = append(stdout, chunk)));
    child.stderr?.on("data", (chunk: Buffer) => (stderr = append(stderr, chunk)));

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // The command timed out: terminate the tree Homebase spawned (the
      // wrapper's descendants included) without blocking the rejection.
      void terminateOwnedProcess(child, { terminateTimeoutMs: 500, forceTimeoutMs: 500 }).catch(() => undefined);
      reject(
        new ExecutableFailure("timeout", `${resolved.command} did not finish within ${timeoutMs}ms.`, {
          stdout,
          stderr,
        }),
      );
    }, timeoutMs);
    timer.unref?.();

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reject(new ExecutableFailure("not_found", `${resolved.command} was not found.`, { stdout, stderr }));
        return;
      }
      reject(new ExecutableFailure("failed", error.message, { stdout, stderr }));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ command: resolved.command, code, stdout, stderr, truncated });
    });
  });
}

/** Injectable process-spawner type (tests, alternate transports). */
export type SpawnExecutable = typeof spawnExecutable;
/** Injectable bounded-command-runner type (tests, detection helpers). */
export type RunExecutable = typeof runExecutable;

const TASKKILL_EXECUTABLE = "taskkill.exe";
const DEFAULT_TERMINATE_TIMEOUT_MS = 3_000;
const DEFAULT_FORCE_TIMEOUT_MS = 500;
const TASKKILL_TIMEOUT_MS = 5_000;

export type OwnedProcessTermination = "already-exited" | "terminated" | "forced";

export interface TerminateOwnedProcessOptions {
  /** How long to wait after the first termination attempt before forcing. */
  terminateTimeoutMs?: number;
  /** Bounded wait after the forced attempt (and after a final SIGKILL). */
  forceTimeoutMs?: number;
  /** Test hook: platform override. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Test hook: spawner used to run `taskkill.exe`. */
  spawnFn?: SpawnExecutable;
  env?: NodeJS.ProcessEnv;
}

/**
 * Builds the argv for the built-in Windows tree terminator. The PID is always
 * validated as a positive integer and passed as an argv element; Homebase never
 * constructs a shell command string.
 */
export function buildTaskkillArgs(pid: number, force: boolean): string[] {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid process id for taskkill: ${String(pid)}`);
  }
  return ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
}

function processHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForProcessClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (processHasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onClose = () => finish(true);
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.removeListener("close", onClose);
      resolve(exited);
    };
    const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    child.once("close", onClose);
  });
}

async function runTaskkill(pid: number, force: boolean, options: TerminateOwnedProcessOptions): Promise<boolean> {
  const spawn = options.spawnFn ?? spawnExecutable;
  let child: ChildProcess;
  try {
    child = spawn(TASKKILL_EXECUTABLE, buildTaskkillArgs(pid, force), {
      env: options.env ?? process.env,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    return false;
  }
  return await new Promise<boolean>((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      finish(false);
    }, TASKKILL_TIMEOUT_MS);
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
}

/**
 * Terminates only a process tree Homebase itself spawned.
 *
 * POSIX: SIGTERM → bounded wait → SIGKILL → bounded wait.
 * Windows: `taskkill.exe /PID <pid> /T` → bounded wait → `/T /F` → bounded
 * wait, with a direct child kill as a last resort. Killing the wrapper alone
 * would orphan descendants (`cmd.exe` → provider process), which is why the
 * tree form is used.
 *
 * Never call this with a PID discovered from a provider; it must only receive
 * a `ChildProcess` this application started. Already-exited children and
 * "process not found" results are normal and never surface as errors.
 */
export async function terminateOwnedProcess(
  child: ChildProcess,
  options: TerminateOwnedProcessOptions = {},
): Promise<OwnedProcessTermination> {
  if (processHasExited(child)) return "already-exited";
  const platform = options.platform ?? process.platform;
  const terminateTimeoutMs = options.terminateTimeoutMs ?? DEFAULT_TERMINATE_TIMEOUT_MS;
  const forceTimeoutMs = options.forceTimeoutMs ?? DEFAULT_FORCE_TIMEOUT_MS;

  if (platform === "win32") {
    const pid = child.pid;
    if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) {
      await runTaskkill(pid, false, options);
      if (await waitForProcessClose(child, terminateTimeoutMs)) return "terminated";
      await runTaskkill(pid, true, options);
      if (await waitForProcessClose(child, forceTimeoutMs)) return "forced";
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      await waitForProcessClose(child, DEFAULT_FORCE_TIMEOUT_MS);
      return "forced";
    }
    // Falling through to the direct path is the only option without a PID.
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // already gone
  }
  if (await waitForProcessClose(child, terminateTimeoutMs)) return "terminated";
  try {
    child.kill("SIGKILL");
  } catch {
    // already gone
  }
  if (await waitForProcessClose(child, forceTimeoutMs)) return "forced";
  return "forced";
}
