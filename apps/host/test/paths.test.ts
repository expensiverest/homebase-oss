import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HostError } from "../src/errors.js";
import { canonicalizeExistingPath, isLoopbackHost, isPathInsideRoot, PathAllowlist } from "../src/paths.js";

let baseDir: string;
let root: string;
let outside: string;

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "homebase-paths-"));
  root = path.join(baseDir, "root");
  outside = path.join(baseDir, "outside");
  await mkdir(path.join(root, "child", "nested"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await mkdir(path.join(baseDir, "root-evil"), { recursive: true });
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("loopback detection", () => {
  it("accepts loopback bind addresses only", () => {
    for (const host of ["127.0.0.1", "127.1.2.3", "::1", "[::1]", "localhost", "LOCALHOST"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ["0.0.0.0", "::", "192.168.1.10", "example.com", "10.0.0.1"]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe("path containment", () => {
  it("allows the root itself and children, rejects siblings and escapes", () => {
    expect(isPathInsideRoot(root, root)).toBe(true);
    expect(isPathInsideRoot(root, path.join(root, "child"))).toBe(true);
    expect(isPathInsideRoot(root, path.join(baseDir, "root-evil"))).toBe(false);
    expect(isPathInsideRoot(root, path.join(root, "..", "outside"))).toBe(false);
    expect(isPathInsideRoot(root, outside)).toBe(false);
  });
});

describe("canonical path resolution", () => {
  it("resolves relative segments through existing paths", async () => {
    const canonical = await canonicalizeExistingPath(path.join(root, "child", "..", "child", "nested"));
    expect(path.basename(canonical)).toBe("nested");
  });

  it("fails for missing paths", async () => {
    await expect(canonicalizeExistingPath(path.join(root, "does-not-exist"))).rejects.toThrow();
  });
});

describe("PathAllowlist", () => {
  it("canonicalizes configured roots and checks candidates", async () => {
    const { allowlist, unavailableRoots } = await PathAllowlist.create([root]);
    expect(unavailableRoots).toEqual([]);
    expect(allowlist.roots).toHaveLength(1);

    const canonicalChild = await allowlist.check(path.join(root, "child"));
    expect(canonicalChild.startsWith(allowlist.roots[0] ?? "")).toBe(true);

    await expect(allowlist.check(outside)).rejects.toMatchObject({ code: "project_not_allowed" });
    await expect(allowlist.check(path.join(baseDir, "root-evil"))).rejects.toMatchObject({
      code: "project_not_allowed",
    });
  });

  it("reports unavailable roots instead of pretending they are usable", async () => {
    const { allowlist, unavailableRoots } = await PathAllowlist.create([root, path.join(baseDir, "missing-root")]);
    expect(unavailableRoots).toEqual([path.join(baseDir, "missing-root")]);
    expect(allowlist.roots).toHaveLength(1);
  });

  it("rejects relative roots", async () => {
    await expect(PathAllowlist.create(["relative/path"])).rejects.toBeInstanceOf(HostError);
  });

  it("rejects traversal outside the root even when the parent exists", async () => {
    const { allowlist } = await PathAllowlist.create([root]);
    await expect(allowlist.check(path.join(root, ".."))).rejects.toMatchObject({ code: "project_not_allowed" });
    await expect(allowlist.check(path.join(root, "..", "outside"))).rejects.toMatchObject({
      code: "project_not_allowed",
    });
  });

  it("does not allow symlink escapes", async (ctx) => {
    const linkPath = path.join(root, "escape-link");
    try {
      await symlink(outside, linkPath, "junction");
    } catch {
      ctx.skip("symlink creation is not permitted on this platform");
      return;
    }
    const { allowlist } = await PathAllowlist.create([root]);
    await expect(allowlist.check(linkPath)).rejects.toMatchObject({ code: "project_not_allowed" });
  });
});
