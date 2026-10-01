import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as FsPromises from "node:fs/promises";
import { mkdir, writeFile, symlink, rm, rename } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { ProjectFiles, FILE_LIMITS } from "../src/projects/files.js";
import { createTestHost, type TestHost } from "./helpers/host-fixture.js";

const readRace = vi.hoisted(() => ({ beforeOpen: null as ((target: unknown) => Promise<void>) | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & typeof FsPromises>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof FsPromises.open>) => {
      await readRace.beforeOpen?.(args[0]);
      return (actual.open as typeof FsPromises.open)(...args);
    },
  };
});

let host: TestHost, files: ProjectFiles, id: string, root: string;
beforeEach(async () => {
  host = await createTestHost();
  files = new ProjectFiles(host.runtime.projects);
  const project = host.runtime.projects.list().find((p) => p.name === "repo-alpha")!;
  id = project.id;
  root = project.path;
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/index.ts"), 'export const safe = "<script>alert(1)</script>";');
  await writeFile(path.join(root, "README.md"), "# Example\n<script>alert(1)</script>\n[bad](javascript:alert(1))");
});
afterEach(async () => {
  readRace.beforeOpen = null;
  await host.cleanup();
});
describe("project-scoped read-only filesystem", () => {
  it("fails safely when a file disappears after stat and before open", async () => {
    readRace.beforeOpen = async (target) => {
      if (target === path.join(root, "src/index.ts")) {
        readRace.beforeOpen = null;
        await rm(path.join(root, "src/index.ts"));
      }
    };
    await expect(files.preview(id, "src/index.ts")).rejects.toMatchObject({ code: "not_found" });
  });
  it("rechecks a directory junction swapped between resolution and open", async () => {
    await writeFile(path.join(host.rootDir, "repo-beta", "index.ts"), "outside fixture content");
    readRace.beforeOpen = async (target) => {
      if (target === path.join(root, "src/index.ts")) {
        readRace.beforeOpen = null;
        await rename(path.join(root, "src"), path.join(root, "src-original"));
        await symlink(
          path.join(host.rootDir, "repo-beta"),
          path.join(root, "src"),
          process.platform === "win32" ? "junction" : "dir",
        );
      }
    };
    await expect(files.preview(id, "src/index.ts")).rejects.toMatchObject({ code: "project_not_allowed" });
  });
  it.skipIf(process.platform === "win32")("rejects special socket files without opening them", async () => {
    const server = createServer();
    const socket = path.join(root, "fixture.sock");
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    try {
      await expect(files.preview(id, "fixture.sock")).rejects.toMatchObject({ code: "not_found" });
      expect((await files.list(id)).entries.find((e) => e.name === "fixture.sock")?.accessible).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("lists folders first, case-insensitive files, hides only .git", async () => {
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "a.env.example"), "EXAMPLE=demo");
    const listing = await files.list(id);
    expect(listing.entries.map((e) => e.name)).toEqual(["dist", "src", "a.env.example", "README.md"]);
    expect(listing.entries.every((e) => !path.isAbsolute(e.relativePath))).toBe(true);
  });
  it("lists nested folders and reads code as source", async () => {
    expect((await files.list(id, "src")).entries[0]?.relativePath).toBe("src/index.ts");
    const { preview } = await files.preview(id, "src/index.ts");
    expect(preview).toMatchObject({ kind: "text", language: "typescript" });
    expect(preview.text).toContain("<script>");
  });
  it("reads Markdown and environment config as text, never executes HTML", async () => {
    await writeFile(path.join(root, "index.html"), "<script>alert(1)</script>");
    await writeFile(path.join(root, ".env.example"), "EXAMPLE=demo");
    expect((await files.preview(id, "README.md")).preview.language).toBe("markdown");
    expect((await files.preview(id, "index.html")).preview).toMatchObject({
      kind: "text",
      language: "html",
      text: "<script>alert(1)</script>",
    });
    expect((await files.preview(id, ".env.example")).preview.kind).toBe("text");
  });
  it("serves authenticated raster bytes with no-store and strict CSP", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(path.join(root, "pixel.png"), png);
    const response = await host.runtime.app.request(`/api/v1/projects/${id}/file-bytes?path=pixel.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });
  it("does not interpret binary, SVG, PDF or fake image content", async () => {
    for (const [name, content] of [
      ["binary.bin", Buffer.from([0, 1, 2, 255])],
      ["evil.svg", '<svg onload="alert(1)"><script>alert(1)</script></svg>'],
      ["evil.png", "<script>alert(1)</script>"],
      ["notes.pdf", "%PDF"],
    ] as const) {
      await writeFile(path.join(root, name), content);
      expect((await files.preview(id, name)).preview.kind).toBe("unsupported");
    }
  });
  it("bounds text and image preview sizes", async () => {
    await writeFile(path.join(root, "large.txt"), Buffer.alloc(FILE_LIMITS.text + 1, 65));
    await writeFile(path.join(root, "large.png"), Buffer.alloc(FILE_LIMITS.image + 1));
    for (const name of ["large.txt", "large.png"]) {
      const preview = (await files.preview(id, name)).preview;
      expect(preview.kind).toBe("too-large");
      expect(preview.text).toBeUndefined();
    }
  });
  it("bounds directory iteration without recursive crawling", async () => {
    await mkdir(path.join(root, "many"));
    await Promise.all(Array.from({ length: 505 }, (_, i) => writeFile(path.join(root, "many", `file-${i}.txt`), "")));
    const listing = await files.list(id, "many");
    expect(listing.truncated).toBe(true);
    expect(listing.entries).toHaveLength(500);
  });
  it.each([
    "../repo-beta/secret.txt",
    "src/../../other",
    "/etc/passwd",
    "C:/private/key",
    "C:\\private\\key",
    "\\\\server\\share",
    "src\\index.ts",
    "src//index.ts",
    "src/./index.ts",
    "%2e%2e/secret",
    "%252e%252e/secret",
    "bad\0name",
  ])("rejects hostile relative path %j", async (input) => {
    await expect(files.preview(id, input)).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("rejects encoded traversal through the API", async () => {
    for (const input of ["../secret", "%2e%2e/secret", "C:/secret", "\\\\host\\share", "x\0y"]) {
      const response = await host.runtime.app.request(`/api/v1/projects/${id}/file?path=${encodeURIComponent(input)}`);
      expect(response.status).toBe(400);
    }
  });
  it("does not mark names as accessible when the path validator would reject opening them", async () => {
    await writeFile(path.join(root, "100%.txt"), "x");
    await writeFile(path.join(root, "ok.txt"), "x");
    const entries = (await files.list(id)).entries;
    expect(entries.find((e) => e.name === "100%.txt")?.accessible).toBe(false);
    expect(entries.find((e) => e.name === "ok.txt")?.accessible).toBe(true);
  });
  it("allows contained links and rejects outside/nested directory junctions", async () => {
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(path.join(root, "src"), path.join(root, "inside"), type);
    await symlink(path.join(host.rootDir, "repo-beta"), path.join(root, "outside"), type);
    await symlink(path.join(host.rootDir, "repo-beta"), path.join(root, "src", "escape"), type);
    await writeFile(path.join(host.rootDir, "repo-beta", "secret.txt"), "outside fixture");
    expect((await files.preview(id, "inside/index.ts")).preview.kind).toBe("text");
    for (const input of ["outside/secret.txt", "src/escape/secret.txt"])
      await expect(files.preview(id, input)).rejects.toMatchObject({ code: "project_not_allowed" });
    expect((await files.list(id)).entries.find((e) => e.name === "outside")?.accessible).toBe(false);
    expect(JSON.stringify(await files.list(id))).not.toContain("repo-beta");
  });
  it("handles missing files/directories and unknown projects safely", async () => {
    await rm(path.join(root, "src/index.ts"));
    await expect(files.preview(id, "src/index.ts")).rejects.toMatchObject({ code: "not_found" });
    await expect(files.list(id, "README.md")).rejects.toMatchObject({ code: "not_found" });
    await expect(files.preview("prj_unknown", "README.md")).rejects.toMatchObject({ code: "project_not_found" });
    await expect(files.preview(id, "src")).rejects.toMatchObject({ code: "not_found" });
  });
  it("applies normal device authentication to file routes", async () => {
    const secured = await createTestHost({ config: { auth: { mode: "device" } } });
    try {
      const projectId = secured.runtime.projects.list()[0]!.id;
      expect((await secured.runtime.app.request(`/api/v1/projects/${projectId}/files`)).status).toBe(401);
    } finally {
      await secured.cleanup();
    }
  });
});
