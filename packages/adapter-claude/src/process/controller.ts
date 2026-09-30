import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { terminateOwnedProcess, type AdapterLogger } from "@homebase/adapter-sdk";
import { defineCapabilities, noCapabilities } from "@homebase/protocol";

import { ClaudeProcessError } from "../errors.js";
import type { NativeFrame } from "../native.js";

export interface ControllerExitInfo {
  code: number | null;
  signal: string | null;
  reason: string;
  spawnFailed: boolean;
}

export interface ControllerHandlers {
  onFrame(frame: NativeFrame): void;
  onInit(): void;
  onExit(info: ControllerExitInfo): void;
  onStderrLine?(line: string): void;
  logger?: AdapterLogger;
}

export interface ControllerOptions {
  executable: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  handlers: ControllerHandlers;
}

interface PendingControl {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One `claude` child process speaking stream-json on stdin/stdout.
 *
 * Owns: line framing, control_request correlation (interrupt/model/mode),
 * stderr tail collection, and SIGINT-first shutdown. It never builds shell
 * strings; argv is passed as an array.
 */
export class ClaudeProcessController {
  readonly #options: ControllerOptions;
  #child: ChildProcessWithoutNullStreams | null = null;
  #pending = new Map<string, PendingControl>();
  #counter = 0;
  #stderrTail = "";
  #exited = false;
  #initSeen = false;
  #initHandlers: Array<() => void> = [];
  #exitHandlers: Array<(info: ControllerExitInfo) => void> = [];
  #stopRequested = false;

  constructor(options: ControllerOptions) {
    this.#options = options;
  }

  get alive(): boolean {
    return this.#child !== null && !this.#exited;
  }

  get initialized(): boolean {
    return this.#initSeen;
  }

  start(): void {
    if (this.#child) return;
    const child = spawn(this.#options.executable, this.#options.args, {
      cwd: this.#options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...this.#options.env },
    });
    this.#child = child;
    this.#exited = false;

    let stdoutBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      let index: number;
      while ((index = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, index).trim();
        stdoutBuffer = stdoutBuffer.slice(index + 1);
        if (line.length === 0) continue;
        let frame: NativeFrame;
        try {
          frame = JSON.parse(line) as NativeFrame;
        } catch {
          this.#options.handlers.logger?.debug("Ignoring unparseable Claude stdout line.");
          continue;
        }
        this.#handleFrame(frame);
      }
    });

    let stderrBuffer = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      let index: number;
      while ((index = stderrBuffer.indexOf("\n")) >= 0) {
        const line = stderrBuffer.slice(0, index);
        stderrBuffer = stderrBuffer.slice(index + 1);
        this.#stderrTail = `${this.#stderrTail}\n${line}`.slice(-4_000);
        if (/error|not logged in|failed|denied|invalid/i.test(line)) {
          this.#options.handlers.onStderrLine?.(line);
        }
      }
    });

    child.on("error", (error) => {
      const reason = `Claude Code failed to start: ${error.message}`;
      this.#finish(child, { code: null, signal: null, reason, spawnFailed: true });
    });
    child.on("close", (code, signal) => {
      const tail = this.#stderrTail.trim();
      const reason = this.#stopRequested
        ? "Claude Code was stopped."
        : tail.length > 0
          ? (tail.split("\n").at(-1) ?? `Claude Code exited (code ${code ?? "unknown"}).`)
          : `Claude Code exited (code ${code ?? "unknown"}, signal ${signal ?? "none"}).`;
      this.#finish(child, { code, signal, reason, spawnFailed: false });
    });
  }

  onceInit(handler: () => void): () => void {
    if (this.#initSeen) {
      handler();
      return () => undefined;
    }
    this.#initHandlers.push(handler);
    return () => {
      this.#initHandlers = this.#initHandlers.filter((candidate) => candidate !== handler);
    };
  }

  onceExit(handler: (info: ControllerExitInfo) => void): () => void {
    if (this.#exited) return () => undefined;
    this.#exitHandlers.push(handler);
    return () => {
      this.#exitHandlers = this.#exitHandlers.filter((candidate) => candidate !== handler);
    };
  }

  writeUserMessage(message: Record<string, unknown>): boolean {
    const child = this.#child;
    if (!child || this.#exited || !child.stdin.writable) return false;
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  /** Sends a control_request and resolves with its `response` payload. */
  request(subtype: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const child = this.#child;
    if (!child || this.#exited || !child.stdin.writable) {
      return Promise.reject(new ClaudeProcessError("provider_error", "Claude Code is not running."));
    }
    this.#counter += 1;
    const requestId = `hb_${this.#counter}_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new ClaudeProcessError("timeout", "Claude Code did not answer a control request in time."));
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(
        `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype, ...payload } })}\n`,
      );
    });
  }

  async interrupt(cancelQueued: boolean, timeoutMs: number): Promise<{ stillQueued: string[]; cancelled: string[] }> {
    const response = (await this.request("interrupt", cancelQueued ? { cancel_queued: true } : {}, timeoutMs)) as
      { still_queued?: unknown; cancelled?: unknown } | undefined;
    const toArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    return { stillQueued: toArray(response?.still_queued), cancelled: toArray(response?.cancelled) };
  }

  /** SIGINT ends a turn cleanly; SIGTERM (fallback) may leave it unfinished. */
  async dispose(): Promise<void> {
    const child = this.#child;
    if (!child || this.#exited) return;
    this.#stopRequested = true;
    // Windows SIGINT kills the root immediately; terminate its owned tree
    // before that root disappears. POSIX keeps the existing SIGINT-first path.
    if (process.platform === "win32") {
      await terminateOwnedProcess(child);
      return;
    }
    this.stop();
    await new Promise<void>((resolve) => {
      const remove = this.onceExit(() => {
        clearTimeout(timer);
        resolve();
      });
      const timer = setTimeout(() => {
        remove();
        resolve();
      }, 1700);
    });
    await terminateOwnedProcess(child);
  }

  /** SIGINT ends a turn cleanly; SIGTERM (fallback) may leave it unfinished. */
  stop(): void {
    const child = this.#child;
    if (!child || this.#exited) return;
    this.#stopRequested = true;
    try {
      child.kill("SIGINT");
    } catch {
      // ignore
    }
    const fallback = setTimeout(() => {
      if (this.#child === child && !this.#exited) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    }, 1_500);
    fallback.unref?.();
  }

  #handleFrame(frame: NativeFrame): void {
    if (frame.type === "control_response") {
      const response = (
        frame as { response?: { request_id?: unknown; subtype?: unknown; response?: unknown; error?: unknown } }
      ).response;
      const requestId = typeof response?.request_id === "string" ? response.request_id : null;
      if (requestId) {
        const pending = this.#pending.get(requestId);
        if (pending) {
          this.#pending.delete(requestId);
          clearTimeout(pending.timer);
          if (response?.subtype === "error") {
            pending.reject(
              new ClaudeProcessError(
                "provider_error",
                typeof response.error === "string" ? response.error : "Claude Code rejected the control request.",
              ),
            );
          } else {
            pending.resolve(response?.response ?? {});
          }
          return;
        }
      }
    }

    if (frame.type === "system" && frame.subtype === "init" && !this.#initSeen) {
      this.#initSeen = true;
      this.#options.handlers.onInit();
      const handlers = this.#initHandlers;
      this.#initHandlers = [];
      for (const handler of handlers) handler();
    }

    this.#options.handlers.onFrame(frame);
  }

  #finish(child: ChildProcessWithoutNullStreams, info: ControllerExitInfo): void {
    if (this.#child !== child || this.#exited) return;
    this.#exited = true;
    this.#child = null;
    for (const [requestId, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new ClaudeProcessError("provider_error", "Claude Code exited before answering."));
      this.#pending.delete(requestId);
    }
    const handlers = this.#exitHandlers;
    this.#exitHandlers = [];
    info.reason = info.reason.length > 0 ? info.reason : "Claude Code exited.";
    this.#options.handlers.onExit(info);
    for (const handler of handlers) handler(info);
  }
}

/** Convenience re-exports used by tests. */
export { defineCapabilities, noCapabilities };
