import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addProjectRoot,
  listProjectRoots,
  loadConfig,
  loadConfigDetailed,
  removeProjectRoot,
} from "../src/config/index.js";
import { canonicalizeExistingPath, pathComparisonKey } from "../src/paths.js";

let baseDir: string;
let stateDir: string;
let projectsDir: string;
let configPath: string;

beforeEach(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "homebase-roots-"));
  stateDir = path.join(baseDir, "state");
  projectsDir = path.join(baseDir, "development");
  configPath = path.join(stateDir, "config.json");
  await mkdir(projectsDir, { recursive: true });
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("project root configuration", () => {
  it("creates the config on first add and stores the canonical path", async () => {
    const result = await addProjectRoot({ configPath, root: projectsDir });
    expect(result.changed).toBe(true);
    expect(result.path).toBe(await canonicalizeExistingPath(projectsDir));

    const stored = JSON.parse(await readFile(configPath, "utf8")) as { projectRoots: string[] };
    expect(stored.projectRoots).toEqual([await canonicalizeExistingPath(projectsDir)]);
  });

  it("canonicalizes relative paths against the process cwd", async () => {
    const relative = path.relative(process.cwd(), projectsDir);
    const result = await addProjectRoot({ configPath, root: relative });
    expect(result.path).toBe(await canonicalizeExistingPath(projectsDir));
  });

  it("rejects missing paths and files", async () => {
    await expect(addProjectRoot({ configPath, root: path.join(baseDir, "missing") })).rejects.toThrow(
      /does not exist|not accessible/i,
    );
    const filePath = path.join(baseDir, "notes.txt");
    await writeFile(filePath, "hello", "utf8");
    await expect(addProjectRoot({ configPath, root: filePath })).rejects.toThrow(/must be a directory/i);
  });

  it("treats duplicates as a no-op without rewriting the file", async () => {
    await addProjectRoot({ configPath, root: projectsDir });
    const firstStat = await stat(configPath);
    const duplicate = await addProjectRoot({ configPath, root: projectsDir });
    expect(duplicate.changed).toBe(false);
    const secondStat = await stat(configPath);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it("compares roots case-insensitively on Windows", async () => {
    await addProjectRoot({ configPath, root: projectsDir });
    if (process.platform !== "win32") return;
    const upper = projectsDir.toUpperCase();
    if (pathComparisonKey(upper) === pathComparisonKey(projectsDir)) {
      const duplicate = await addProjectRoot({ configPath, root: upper });
      expect(duplicate.changed).toBe(false);
    }
  });

  it("supports spaces in paths and lists them in order", async () => {
    const spaced = path.join(baseDir, "my development folder");
    await mkdir(spaced, { recursive: true });
    await addProjectRoot({ configPath, root: projectsDir });
    await addProjectRoot({ configPath, root: spaced });
    const { roots } = await listProjectRoots(configPath);
    expect(roots[0]).toBe(await canonicalizeExistingPath(projectsDir));
    expect(roots[1]).toBe(await canonicalizeExistingPath(spaced));
  });

  it("removes an exact root and reports unknown roots", async () => {
    await addProjectRoot({ configPath, root: projectsDir });
    const removed = await removeProjectRoot({ configPath, root: projectsDir });
    expect(removed.changed).toBe(true);
    expect((await listProjectRoots(configPath)).roots).toEqual([]);

    const missing = await removeProjectRoot({ configPath, root: projectsDir });
    expect(missing.changed).toBe(false);
    expect(missing.path).toBeNull();
  });

  it("leaves no temp files behind and writes private files on POSIX", async () => {
    await addProjectRoot({ configPath, root: projectsDir });
    const entries = await readdir(stateDir);
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    if (process.platform !== "win32") {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
      expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
    }
  });

  it("fails safely on a corrupt configuration", async () => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(configPath, "{ not json", "utf8");
    await expect(addProjectRoot({ configPath, root: projectsDir })).rejects.toThrow(/not valid JSON/i);
    await expect(listProjectRoots(configPath)).rejects.toThrow(/not valid JSON/i);
    // The corrupt file is untouched.
    expect(await readFile(configPath, "utf8")).toBe("{ not json");
  });

  it("refuses to persist a configuration the Host would reject", async () => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(configPath, JSON.stringify({ auth: { mode: "none" }, host: { bindAddress: "0.0.0.0" } }), "utf8");
    await expect(addProjectRoot({ configPath, root: projectsDir })).rejects.toThrow(
      /security validation|Invalid Homebase configuration/i,
    );
  });
});

describe("config resolution and migration", () => {
  it("loads the user-scoped config from any working directory", async () => {
    await addProjectRoot({ configPath, root: projectsDir });
    const elsewhere = path.join(baseDir, "elsewhere");
    await mkdir(elsewhere, { recursive: true });

    const config = await loadConfig({ cwd: elsewhere, env: {}, stateDir });
    expect(config.projectRoots).toEqual([await canonicalizeExistingPath(projectsDir)]);
  });

  it("prefers an explicit config path over the user config", async () => {
    await addProjectRoot({ configPath, root: projectsDir });
    const explicit = path.join(baseDir, "explicit.json");
    await writeFile(explicit, JSON.stringify({ host: { port: 9123 } }), "utf8");

    const config = await loadConfig({ configPath: explicit, env: {}, stateDir });
    expect(config.host.port).toBe(9123);
    expect(config.projectRoots).toEqual([]);
  });

  it("honors HOMEBASE_CONFIG", async () => {
    const explicit = path.join(baseDir, "env.json");
    await writeFile(explicit, JSON.stringify({ host: { port: 9124 } }), "utf8");
    const config = await loadConfig({ env: { HOMEBASE_CONFIG: explicit }, stateDir });
    expect(config.host.port).toBe(9124);
  });

  it("migrates a legacy cwd config once and never deletes it", async () => {
    const legacyDir = path.join(baseDir, "legacy");
    await mkdir(legacyDir, { recursive: true });
    const legacyPath = path.join(legacyDir, "homebase.config.json");
    await writeFile(
      legacyPath,
      JSON.stringify({ host: { port: 9333 }, projectRoots: [await canonicalizeExistingPath(projectsDir)] }),
      "utf8",
    );

    const notices: string[] = [];
    const loaded = await loadConfigDetailed({
      cwd: legacyDir,
      env: {},
      stateDir,
      onNotice: (message) => notices.push(message),
    });
    expect(loaded.migratedFrom).toBe(legacyPath);
    expect(loaded.config.host.port).toBe(9333);
    expect(notices.join(" ")).toMatch(/migrated/i);

    // Legacy file survives.
    expect(JSON.parse(await readFile(legacyPath, "utf8")).host.port).toBe(9333);

    // From another directory the same user-scoped config applies.
    const elsewhere = await loadConfig({ cwd: baseDir, env: {}, stateDir });
    expect(elsewhere.host.port).toBe(9333);
  });

  it("does not migrate an invalid legacy config", async () => {
    const legacyDir = path.join(baseDir, "broken-legacy");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      path.join(legacyDir, "homebase.config.json"),
      JSON.stringify({ projectRoots: ["relative"] }),
      "utf8",
    );
    await expect(loadConfigDetailed({ cwd: legacyDir, env: {}, stateDir })).rejects.toThrow(/legacy configuration/i);
  });

  it("uses built-in defaults when nothing is configured", async () => {
    const config = await loadConfig({ cwd: baseDir, env: {}, stateDir });
    expect(config.host.port).toBe(8787);
    expect(config.projectRoots).toEqual([]);
  });

  it("fails when an explicitly requested config is missing", async () => {
    await expect(
      loadConfigDetailed({ configPath: path.join(baseDir, "absent.json"), env: {}, stateDir }),
    ).rejects.toThrow(/Failed to load Homebase configuration/);
  });
});
