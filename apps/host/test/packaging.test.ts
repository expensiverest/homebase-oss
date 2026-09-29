import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const hostRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJsonPath = path.join(hostRoot, "package.json");
const entryPath = path.join(hostRoot, "dist", "index.js");

let stateDir: string;

beforeAll(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "homebase-packaging-"));
});

afterAll(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

describe("homebase CLI packaging", () => {
  it("declares a bin entry that points at the built Node entry point", async () => {
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { bin?: Record<string, string> };
    expect(pkg.bin?.homebase).toBe("./dist/index.js");
  });

  it("ships an executable shebang on the built entry point", async (ctx) => {
    if (!existsSync(entryPath)) return ctx.skip("run `npm run build -w @homebase/host` first");
    const firstLine = (await readFile(entryPath, "utf8")).split("\n", 1)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  it("runs --help, --version, and nested projects commands through the built file", async (ctx) => {
    if (!existsSync(entryPath)) return ctx.skip("run `npm run build -w @homebase/host` first");
    const env = { ...process.env, HOMEBASE_STATE_DIR: stateDir };
    const run = async (args: string[]) => {
      const { stdout, stderr } = await execFileAsync(process.execPath, [entryPath, ...args], {
        env,
        windowsHide: true,
        timeout: 20_000,
      });
      return { stdout, stderr };
    };

    const version = await run(["--version"]);
    expect(version.stdout).toMatch(/^homebase \d+\.\d+\.\d+/);

    const help = await run(["--help"]);
    expect(help.stdout).toContain("Usage: homebase");

    const list = await run(["projects", "list"]);
    expect(list.stdout).toContain("No project roots configured.");

    const add = await run(["projects", "add", stateDir]);
    expect(add.stdout).toContain("Added project root:");

    const listAgain = await run(["projects"]);
    expect(listAgain.stdout).toContain("1 root configured.");

    const remove = await run(["projects", "remove", stateDir]);
    expect(remove.stdout).toContain("Removed project root:");
  });

  it("documents the one-time developer linking commands", async () => {
    const rootPackage = JSON.parse(await readFile(path.join(hostRoot, "..", "..", "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(rootPackage.scripts?.["link:cli"]).toBeTruthy();
    expect(rootPackage.scripts?.["unlink:cli"]).toBeTruthy();
    expect(rootPackage.scripts?.["link:cli"]).toContain("npm link");
  });
});
