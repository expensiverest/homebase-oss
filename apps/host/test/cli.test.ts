import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCli, type CliIo } from "../src/cli/index.js";
import { canonicalizeExistingPath } from "../src/paths.js";

interface CapturedIo extends CliIo {
  outLines: string[];
  errorLines: string[];
}

function captureIo(): CapturedIo {
  const outLines: string[] = [];
  const errorLines: string[] = [];
  return {
    outLines,
    errorLines,
    out: (line) => outLines.push(line),
    error: (line) => errorLines.push(line),
  };
}

let baseDir: string;
let stateDir: string;
let projectsDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "homebase-cli-"));
  stateDir = path.join(baseDir, "state");
  projectsDir = path.join(baseDir, "code");
  await mkdir(projectsDir, { recursive: true });
  vi.stubEnv("HOMEBASE_STATE_DIR", stateDir);
  vi.stubEnv("HOMEBASE_CONFIG", "");
  delete process.env.HOMEBASE_PROJECT_ROOTS;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(baseDir, { recursive: true, force: true });
});

describe("homebase CLI", () => {
  it("prints help and version without starting the Host", async () => {
    const help = captureIo();
    expect(await runCli(["--help"], help)).toBe(0);
    expect(help.outLines.join("\n")).toContain("Usage: homebase");

    const version = captureIo();
    expect(await runCli(["--version"], version)).toBe(0);
    expect(version.outLines.join("\n")).toMatch(/^homebase \d+\.\d+\.\d+/);
  });

  it("rejects unknown commands and unknown flags with a non-zero exit", async () => {
    const unknown = captureIo();
    expect(await runCli(["frobnicate"], unknown)).toBe(1);
    expect(unknown.errorLines.join("\n")).toContain("Unknown command");

    const badFlag = captureIo();
    expect(await runCli(["--not-a-flag"], badFlag)).toBe(1);
    expect(badFlag.errorLines.join("\n")).toContain("Usage: homebase");
  });

  it("lists, adds, de-duplicates, and removes project roots", async () => {
    const empty = captureIo();
    expect(await runCli(["projects"], empty)).toBe(0);
    expect(empty.outLines.join("\n")).toContain("No project roots configured.");

    const add = captureIo();
    expect(await runCli(["projects", "add", projectsDir], add)).toBe(0);
    expect(add.outLines.join("\n")).toContain("Added project root:");
    expect(add.outLines.join("\n")).toContain("Restart Homebase");

    const duplicate = captureIo();
    expect(await runCli(["projects", "add", projectsDir], duplicate)).toBe(0);
    expect(duplicate.outLines.join("\n")).toContain("Already a project root:");

    const list = captureIo();
    expect(await runCli(["projects", "list"], list)).toBe(0);
    expect(list.outLines.join("\n")).toContain("1 root configured.");

    const remove = captureIo();
    expect(await runCli(["projects", "remove", projectsDir], remove)).toBe(0);
    expect(remove.outLines.join("\n")).toContain("Removed project root:");

    const removedAgain = captureIo();
    expect(await runCli(["projects", "remove", projectsDir], removedAgain)).toBe(0);
    expect(removedAgain.outLines.join("\n")).toContain("Not a configured project root:");

    const stored = JSON.parse(await readFile(path.join(stateDir, "config.json"), "utf8")) as {
      projectRoots: string[];
    };
    expect(stored.projectRoots).toEqual([]);
  });

  it("adds the current working directory when no path is given", async () => {
    const previous = process.cwd();
    try {
      process.chdir(projectsDir);
      const io = captureIo();
      expect(await runCli(["projects", "add"], io)).toBe(0);
      expect(io.outLines.join("\n")).toContain(await canonicalizeExistingPath(projectsDir));
    } finally {
      process.chdir(previous);
    }
  });

  it("uses --config and HOMEBASE_CONFIG when provided", async () => {
    const custom = path.join(baseDir, "custom", "homebase.json");
    await mkdir(path.dirname(custom), { recursive: true });
    await writeFile(custom, JSON.stringify({}), "utf8");

    const flag = captureIo();
    expect(await runCli(["projects", "add", projectsDir, "--config", custom], flag)).toBe(0);
    const stored = JSON.parse(await readFile(custom, "utf8")) as { projectRoots: string[] };
    expect(stored.projectRoots).toEqual([await canonicalizeExistingPath(projectsDir)]);

    vi.stubEnv("HOMEBASE_CONFIG", custom);
    const viaEnv = captureIo();
    expect(await runCli(["projects", "list"], viaEnv)).toBe(0);
    expect(viaEnv.outLines.join("\n")).toContain(await canonicalizeExistingPath(projectsDir));
  });

  it("requires a path for projects remove and a device id for revoke", async () => {
    const remove = captureIo();
    expect(await runCli(["projects", "remove"], remove)).toBe(1);
    expect(remove.errorLines.join("\n")).toContain("projects remove <path>");

    const revoke = captureIo();
    expect(await runCli(["revoke"], revoke)).toBe(1);
    expect(revoke.errorLines.join("\n")).toContain("revoke <device-id>");
  });

  it("explains how to start Homebase when local commands cannot reach it", async () => {
    const io = captureIo();
    expect(await runCli(["devices"], io)).toBe(1);
    const text = io.errorLines.join("\n");
    expect(text).toMatch(/admin key|Could not reach Homebase/);
  });
});
