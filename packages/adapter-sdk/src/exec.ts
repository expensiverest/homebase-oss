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
      child.kill("SIGKILL");
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
