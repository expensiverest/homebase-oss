import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PathAllowlist } from "../src/paths.js";
import { ProjectRegistry, projectIdForPath, type GitMetadataReader } from "../src/projects/index.js";

const git: GitMetadataReader = {
  async read(projectPath) {
    return { branch: "main", remote: null, gitRoot: projectPath };
  },
};

let baseDir: string;
let root: string;
let registry: ProjectRegistry;

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "homebase-projects-"));
  root = path.join(baseDir, "root");

  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, "repo-a", ".git"), { recursive: true });
  await mkdir(path.join(root, "group", "repo-b", ".git"), { recursive: true });
  await mkdir(path.join(root, "group", "deeper", "repo-c", ".git"), { recursive: true });
  await mkdir(path.join(root, "group", "deeper", "more", "repo-d", ".git"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "repo-e", ".git"), { recursive: true });
  await mkdir(path.join(root, ".hidden", "repo-f", ".git"), { recursive: true });
  await mkdir(path.join(root, "plain-folder"), { recursive: true });

  const { allowlist } = await PathAllowlist.create([root]);
  registry = new ProjectRegistry({ roots: allowlist.roots, allowlist, scanDepth: 3, git });
  await registry.discover();
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("ProjectRegistry discovery", () => {
  it("finds git repositories within the configured roots and depth", () => {
    const names = registry
      .list()
      .map((project) => project.name)
      .sort();
    expect(names).toContain("repo-a");
    expect(names).toContain("repo-b");
    expect(names).toContain("repo-c");
    expect(names).toContain(path.basename(root));
  });

  it("skips noise directories and depths beyond the limit", () => {
    const names = registry.list().map((project) => project.name);
    expect(names).not.toContain("repo-d");
    expect(names).not.toContain("repo-e");
    expect(names).not.toContain("repo-f");
    expect(names).not.toContain("plain-folder");
  });

  it("produces deterministic ids from canonical paths", () => {
    const repoA = registry.list().find((project) => project.name === "repo-a");
    expect(repoA).toBeDefined();
    expect(repoA?.id).toBe(projectIdForPath(repoA?.path ?? ""));
  });

  it("exposes projects by id and throws for unknown ids", () => {
    const project = registry.list()[0];
    expect(project).toBeDefined();
    if (!project) return;

    expect(registry.get(project.id)?.id).toBe(project.id);
    expect(registry.get("prj_missing")).toBeUndefined();
    expect(() => registry.require("prj_missing")).toThrowError(/Unknown project/);

    const copy = registry.get(project.id);
    if (copy) copy.name = "mutated";
    expect(registry.get(project.id)?.name).toBe(project.name);
  });

  it("resolves canonical, allowlisted paths for registered projects", async () => {
    const project = registry.list().find((entry) => entry.name === "repo-a");
    expect(project).toBeDefined();
    if (!project) return;

    const resolved = await registry.resolvePath(project.id);
    expect(path.basename(resolved)).toBe("repo-a");
  });
});
