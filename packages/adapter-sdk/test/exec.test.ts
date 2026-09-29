import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ExecutableFailure,
  buildTaskkillArgs,
  quoteWindowsArgument,
  resolveExecutable,
  runExecutable,
  spawnExecutable,
  terminateOwnedProcess,
} from "../src/exec.js";

const IS_WINDOWS = process.platform === "win32";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "homebase-exec-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolveExecutable", () => {
  it("finds node on PATH", () => {
    const resolved = resolveExecutable(IS_WINDOWS ? "node.exe" : "node");
    expect(resolved.found).toBe(true);
    expect(resolved.command.toLowerCase()).toContain("node");
  });

  it("reports missing commands without throwing", () => {
    const resolved = resolveExecutable("homebase-definitely-not-installed-xyz");
    expect(resolved.found).toBe(false);
  });

  it("uses absolute paths as-is", () => {
    const resolved = resolveExecutable(process.execPath);
    expect(resolved.found).toBe(true);
    expect(resolved.command).toBe(path.resolve(process.execPath));
  });

  it("detects Windows .cmd shims", async ({ skip }) => {
    if (!IS_WINDOWS) return skip("Windows-only shim behavior");
    const shim = path.join(dir, "fake-tool.cmd");
    await writeFile(shim, "@echo off\r\necho hello\r\n", "utf8");
    const resolved = resolveExecutable(shim, { ...process.env, PATHEXT: ".EXE;.CMD" });
    expect(resolved.shim).toBe(true);
    expect(resolved.found).toBe(true);
  });
});

describe("spawnExecutable", () => {
  it("runs an executable without a shell and does not pass a command line", async () => {
    const child = spawnExecutable(process.execPath, ["-e", "process.stdout.write('ok')"], { stdio: "pipe" });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
    expect(output).toBe("ok");
  });

  it("runs Windows .cmd shims through the fixed cmd.exe wrapper", async ({ skip }) => {
    if (!IS_WINDOWS) return skip("Windows-only shim behavior");
    const shim = path.join(dir, "echo-args.cmd");
    await writeFile(shim, "@echo off\r\necho [%1]\r\n", "utf8");
    const result = await runExecutable(shim, ["a&b"], { timeoutMs: 10_000 });
    expect(result.code).toBe(0);
    // The metacharacter stays inside the argument instead of executing.
    expect(result.stdout).toContain("a&b");
  });
});

describe("runExecutable", () => {
  it("captures stdout and exit codes", async () => {
    const result = await runExecutable(process.execPath, ["-e", "console.log('hello')"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("bounds captured output", async () => {
    const result = await runExecutable(process.execPath, ["-e", "process.stdout.write('x'.repeat(10000))"], {
      maxOutputBytes: 256,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(256);
  });

  it("times out long-running commands", async () => {
    await expect(
      runExecutable(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 250 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("reports missing executables as not_found", async () => {
    const failure = await runExecutable("homebase-definitely-not-installed-xyz", []).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ExecutableFailure);
    expect((failure as ExecutableFailure).kind).toBe("not_found");
  });
});

describe("quoteWindowsArgument", () => {
  it("leaves simple arguments untouched", () => {
    expect(quoteWindowsArgument("serve")).toBe("serve");
    expect(quoteWindowsArgument("127.0.0.1")).toBe("127.0.0.1");
  });

  it("quotes spaces and shell metacharacters", () => {
    expect(quoteWindowsArgument("C:\\Program Files\\tool.cmd")).toBe('"C:\\Program Files\\tool.cmd"');
    expect(quoteWindowsArgument("a&b")).toBe('"a&b"');
  });

  it("rejects line breaks", () => {
    expect(() => quoteWindowsArgument("a\nb")).toThrow(/line breaks/);
  });
});

interface FakeChildState {
  exited: boolean;
  exitsOnTerm: boolean;
  exitsOnKill: boolean;
}

/** Minimal ChildProcess stand-in for platform-independent termination tests. */
function createFakeChild(state: Partial<FakeChildState> = {}) {
  const resolved: FakeChildState = {
    exited: false,
    exitsOnTerm: true,
    exitsOnKill: true,
    ...state,
  };
  const emitter = new EventEmitter() as unknown as ChildProcess;
  Object.defineProperty(emitter, "pid", { value: 4242 });
  Object.defineProperty(emitter, "exitCode", { get: () => (resolved.exited ? 0 : null) });
  Object.defineProperty(emitter, "signalCode", { get: () => null });
  (emitter as unknown as { kill: (signal?: NodeJS.Signals) => boolean }).kill = vi.fn((signal?: NodeJS.Signals) => {
    if (signal === "SIGTERM" && !resolved.exitsOnTerm) return true;
    if (signal === "SIGKILL" && !resolved.exitsOnKill) return true;
    resolved.exited = true;
    queueMicrotask(() => emitter.emit("close", 0, signal));
    return true;
  });
  return { child: emitter, state: resolved };
}

describe("buildTaskkillArgs", () => {
  it("builds tree-termination argv without a shell string", () => {
    expect(buildTaskkillArgs(1234, false)).toEqual(["/PID", "1234", "/T"]);
    expect(buildTaskkillArgs(1234, true)).toEqual(["/PID", "1234", "/T", "/F"]);
  });

  it("rejects invalid process ids", () => {
    expect(() => buildTaskkillArgs(0, false)).toThrow(/Invalid process id/);
    expect(() => buildTaskkillArgs(-1, false)).toThrow(/Invalid process id/);
    expect(() => buildTaskkillArgs(1.5, true)).toThrow(/Invalid process id/);
  });
});

describe("terminateOwnedProcess", () => {
  it("treats an already-exited child as normal", async () => {
    const { child } = createFakeChild({ exited: true });
    await expect(terminateOwnedProcess(child, { platform: "linux" })).resolves.toBe("already-exited");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("uses SIGTERM first on POSIX and stops when the child exits", async () => {
    const { child } = createFakeChild({ exitsOnTerm: true });
    await expect(
      terminateOwnedProcess(child, { platform: "linux", terminateTimeoutMs: 500, forceTimeoutMs: 100 }),
    ).resolves.toBe("terminated");
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("escalates to SIGKILL on POSIX only when needed", async () => {
    const { child } = createFakeChild({ exitsOnTerm: false, exitsOnKill: true });
    await expect(
      terminateOwnedProcess(child, { platform: "linux", terminateTimeoutMs: 30, forceTimeoutMs: 500 }),
    ).resolves.toBe("forced");
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("uses taskkill /T then /T /F on Windows without a shell", async () => {
    const calls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];
    const { child } = createFakeChild({ exitsOnTerm: false, exitsOnKill: false });
    const result = await terminateOwnedProcess(child, {
      platform: "win32",
      terminateTimeoutMs: 50,
      forceTimeoutMs: 50,
      spawnFn: ((command: string, args: readonly string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options: options ?? {} });
        // A real, immediately-exiting helper process stands in for taskkill.
        return spawnExecutable(process.execPath, ["-e", ""], { stdio: "ignore" });
      }) as never,
    });
    expect(result).toBe("forced");
    expect(calls.map((call) => call.command)).toEqual(["taskkill.exe", "taskkill.exe"]);
    expect(calls[0]?.args).toEqual(["/PID", "4242", "/T"]);
    expect(calls[1]?.args).toEqual(["/PID", "4242", "/T", "/F"]);
    for (const call of calls) {
      expect(call.options.shell).not.toBe(true);
      expect(Array.isArray(call.args)).toBe(true);
    }
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("is idempotent when called twice", async () => {
    const { child } = createFakeChild({ exitsOnTerm: true });
    await terminateOwnedProcess(child, { platform: "linux", terminateTimeoutMs: 200 });
    await expect(terminateOwnedProcess(child, { platform: "linux", terminateTimeoutMs: 200 })).resolves.toBe(
      "already-exited",
    );
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("terminates a real Windows .cmd process tree including descendants", { timeout: 30_000 }, async ({ skip }) => {
    if (!IS_WINDOWS) return skip("Windows-only process-tree behavior");
    const treeDir = await mkdtemp(path.join(tmpdir(), "homebase-tree-"));
    let descendantPid: number | null = null;
    try {
      const pidFile = path.join(treeDir, "descendant.pid");
      const script = path.join(treeDir, "descendant.cjs");
      await writeFile(
        script,
        `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
          `setInterval(() => undefined, 1_000);\n`,
        "utf8",
      );
      const shim = path.join(treeDir, "wrapped.cmd");
      await writeFile(shim, `@echo off\r\n"${process.execPath}" "${script}"\r\n`, "utf8");

      const child = spawnExecutable(shim, [], { stdio: "ignore" });
      expect(child.pid).toBeTruthy();
      const deadline = Date.now() + 10_000;
      while (descendantPid === null && Date.now() < deadline) {
        try {
          descendantPid = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(descendantPid, "descendant pid file").toBeTruthy();
      expect(processAlive(descendantPid!)).toBe(true);

      const stage = await terminateOwnedProcess(child, { terminateTimeoutMs: 5_000, forceTimeoutMs: 3_000 });
      expect(["terminated", "forced"]).toContain(stage);
      const goneBy = Date.now() + 5_000;
      while (processAlive(descendantPid!) && Date.now() < goneBy) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(processAlive(descendantPid!), "descendant must be dead").toBe(false);
    } finally {
      if (descendantPid !== null && processAlive(descendantPid)) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch {
          // best effort cleanup
        }
      }
      await rm(treeDir, { recursive: true, force: true });
    }
  });
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
