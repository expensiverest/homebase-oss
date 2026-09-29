import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ExecutableFailure,
  quoteWindowsArgument,
  resolveExecutable,
  runExecutable,
  spawnExecutable,
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
