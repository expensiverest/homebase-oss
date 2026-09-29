import type { ChildProcess } from "node:child_process";

import { spawnExecutable, type SpawnExecutable } from "@homebase/adapter-sdk";

import type { AcpTransportLogger } from "./logger.js";

export interface AcpProcessExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** True when `stop()` initiated the termination. */
  expected: boolean;
  /** True when the process could not be spawned at all. */
  spawnFailed: boolean;
  /** Bounded, human-readable reason (never includes environment dumps). */
  reason: string;
}

export interface AcpProcessOptions {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Maximum stderr bytes kept for local diagnostics. */
  stderrLimitBytes?: number;
  /** Injectable spawner for deterministic tests. */
  spawnFn?: SpawnExecutable;
  logger?: AcpTransportLogger;
}

/** Bounded tail buffer: keeps at most `limitBytes` of the most recent stderr. */
export class BoundedTail {
  readonly #limitBytes: number;
  #chunks: Buffer[] = [];
  #size = 0;

  constructor(limitBytes: number) {
    this.#limitBytes = Math.max(1_024, limitBytes);
  }

  append(chunk: Buffer): void {
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    while (this.#size > this.#limitBytes && this.#chunks.length > 1) {
      const removed = this.#chunks.shift();
      if (removed) this.#size -= removed.length;
    }
    const only = this.#chunks[0];
    if (only && only.length > this.#limitBytes) {
      this.#chunks[0] = only.subarray(only.length - this.#limitBytes);
      this.#size = this.#chunks[0]?.length ?? 0;
    }
  }

  toString(): string {
    return Buffer.concat(this.#chunks).toString("utf8");
  }

  get size(): number {
    return this.#size;
  }
}

/**
 * One local ACP agent child process speaking newline-delimited JSON-RPC over
 * stdio. Owns spawning, bounded stderr capture, exit observation, and graceful
 * shutdown of only the process it started. stdout belongs exclusively to the
 * protocol; stderr is never parsed and never forwarded to clients.
 */
export class AcpProcess {
  readonly #options: AcpProcessOptions;
  readonly #stderr: BoundedTail;
  readonly #exitListeners = new Set<(info: AcpProcessExitInfo) => void>();
  #child: ChildProcess | null = null;
  #exitInfo: AcpProcessExitInfo | null = null;
  #expectedStop = false;

  constructor(options: AcpProcessOptions) {
    this.#options = options;
    this.#stderr = new BoundedTail(options.stderrLimitBytes ?? 64 * 1024);
  }

  get child(): ChildProcess | null {
    return this.#child;
  }

  get alive(): boolean {
    return this.#child !== null && this.#exitInfo === null;
  }

  get exitInfo(): AcpProcessExitInfo | null {
    return this.#exitInfo;
  }

  /** Spawns the child. Throws only for synchronous spawn failures. */
  start(): ChildProcess {
    if (this.#child) throw new Error("AcpProcess has already been started.");
    const child = (this.#options.spawnFn ?? spawnExecutable)(this.#options.command, [...this.#options.args], {
      ...(this.#options.cwd !== undefined ? { cwd: this.#options.cwd } : {}),
      env: this.#options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;

    child.stderr?.on("data", (chunk: Buffer) => this.#stderr.append(chunk));
    child.on("error", (error) => {
      this.#options.logger?.warn("ACP agent process failed to spawn.");
      this.#finish({
        code: null,
        signal: null,
        expected: this.#expectedStop,
        spawnFailed: true,
        reason: `The ACP agent process failed to start: ${error.message}`,
      });
    });
    child.on("close", (code, signal) => {
      const reason = this.#expectedStop
        ? "The ACP agent process was stopped."
        : `The ACP agent process exited (code ${code ?? "unknown"}, signal ${signal ?? "none"}).`;
      this.#finish({ code, signal, expected: this.#expectedStop, spawnFailed: false, reason });
    });

    return child;
  }

  stderrTail(): string {
    return this.#stderr.toString();
  }

  onExit(listener: (info: AcpProcessExitInfo) => void): () => void {
    if (this.#exitInfo) {
      listener(this.#exitInfo);
      return () => undefined;
    }
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  waitForExit(): Promise<AcpProcessExitInfo> {
    if (this.#exitInfo) return Promise.resolve(this.#exitInfo);
    return new Promise((resolve) => this.onExit(resolve));
  }

  /** Ends stdin, then escalates SIGTERM → SIGKILL. Idempotent. */
  async stop(timeoutMs: number): Promise<void> {
    const child = this.#child;
    if (!child || this.#exitInfo) return;
    this.#expectedStop = true;
    try {
      child.stdin?.end();
    } catch {
      // stdin may already be closed
    }
    const closed = this.waitForExit();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      closed.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), Math.min(timeoutMs, 500));
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!timedOut) return;

    child.kill("SIGTERM");
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const afterTerm = await Promise.race([
      closed.then(() => false),
      new Promise<boolean>((resolve) => {
        forceTimer = setTimeout(() => resolve(true), timeoutMs);
      }),
    ]);
    if (forceTimer) clearTimeout(forceTimer);
    if (!afterTerm) return;

    child.kill("SIGKILL");
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      closed,
      new Promise<void>((resolve) => {
        killTimer = setTimeout(() => resolve(), 500);
      }),
    ]);
    if (killTimer) clearTimeout(killTimer);
  }

  #finish(info: AcpProcessExitInfo): void {
    if (this.#exitInfo) return;
    this.#exitInfo = info;
    for (const listener of [...this.#exitListeners]) listener(info);
    this.#exitListeners.clear();
  }
}
