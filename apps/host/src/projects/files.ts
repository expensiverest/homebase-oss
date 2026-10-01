import { constants } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectDirectoryListing, ProjectFileEntry, ProjectFilePreview } from "@homebase/protocol";
import { HostError } from "../errors.js";
import { isPathInsideRoot, pathComparisonKey, stripExtendedPathPrefix } from "../paths.js";
import type { ProjectRegistry } from "./project-registry.js";

export const FILE_LIMITS = { entries: 500, text: 1024 * 1024, image: 10 * 1024 * 1024 } as const;
const languages: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  ps1: "powershell",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  sql: "sql",
};
const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export function validateRelativePath(value: string): string {
  if (
    value.length > 4096 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("%") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    (value !== "" && value.split("/").some((p) => p === ".." || p === "." || p === ""))
  ) {
    throw new HostError("invalid_request", "Use a relative project path without traversal or encoded separators.");
  }
  return value;
}

function isOpenablePath(value: string): boolean {
  try {
    validateRelativePath(value);
    return true;
  } catch {
    return false;
  }
}

const unavailable = () => new HostError("not_found", "This project file is unavailable.");
export class ProjectFiles {
  constructor(readonly projects: ProjectRegistry) {}
  async #resolve(projectId: string, relativePath: string): Promise<{ root: string; target: string }> {
    const relative = validateRelativePath(relativePath);
    const project = this.projects.require(projectId);
    const root = await this.projects.resolvePath(projectId);
    // A replaced project path must not expand its original trust boundary.
    if (pathComparisonKey(root) !== pathComparisonKey(project.path))
      throw new HostError("project_not_allowed", "Project folder changed; restart Homebase to rediscover it.");
    let target: string;
    try {
      target = stripExtendedPathPrefix(await realpath(path.join(root, relative)));
    } catch {
      throw unavailable();
    }
    if (!isPathInsideRoot(root, target))
      throw new HostError("project_not_allowed", "This entry points outside the project.");
    return { root, target };
  }
  async list(projectId: string, relativePath = ""): Promise<ProjectDirectoryListing> {
    const { root, target } = await this.#resolve(projectId, relativePath);
    if (!(await stat(target).catch(() => null))?.isDirectory()) throw unavailable();
    const entries: ProjectFileEntry[] = [];
    let truncated = false;
    try {
      const directory = await opendir(target);
      for await (const entry of directory) {
        if (entry.name === ".git") continue;
        if (entries.length === FILE_LIMITS.entries) {
          truncated = true;
          break;
        }
        const entryPath = path.join(target, entry.name);
        const relative = [relativePath, entry.name].filter(Boolean).join("/");
        let kind: ProjectFileEntry["kind"] = entry.isSymbolicLink() ? "symlink" : "other";
        let sizeBytes: number | null = null,
          modifiedAt: string | null = null,
          accessible = false;
        try {
          const canonical = stripExtendedPathPrefix(await realpath(entryPath));
          if (isPathInsideRoot(root, canonical)) {
            const info = await stat(canonical);
            kind = info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
            accessible = (kind === "file" || kind === "directory") && isOpenablePath(relative);
            sizeBytes = info.isFile() ? info.size : null;
            modifiedAt = info.mtime.toISOString();
          }
        } catch {
          /* Broken/escaped links stay unavailable without disclosing targets. */
        }
        entries.push({ name: entry.name, relativePath: relative, kind, sizeBytes, modifiedAt, accessible });
      }
      // Re-check the directory after iteration; never return an escaped listing.
      const current = await this.#resolve(projectId, relativePath);
      if (pathComparisonKey(current.target) !== pathComparisonKey(target)) throw unavailable();
    } catch (error) {
      if (error instanceof HostError) throw error;
      throw unavailable();
    }
    entries.sort(
      (a, b) =>
        Number(b.kind === "directory") - Number(a.kind === "directory") ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        a.name.localeCompare(b.name),
    );
    return { projectId, relativePath, entries, truncated };
  }
  async preview(projectId: string, relativePath: string): Promise<{ preview: ProjectFilePreview; bytes?: Uint8Array }> {
    const { root, target } = await this.#resolve(projectId, relativePath);
    const before = await lstat(target).catch(() => null);
    if (!before?.isFile()) throw unavailable();
    const extension = path.extname(relativePath).toLowerCase();
    const limit = rasterExtensions.has(extension) ? FILE_LIMITS.image : FILE_LIMITS.text;
    const base = {
      projectId,
      relativePath,
      name: path.posix.basename(relativePath),
      sizeBytes: before.size,
      language: languages[extension.slice(1)] ?? null,
      mimeType: null,
    };
    if (before.size > limit) return { preview: { ...base, kind: "too-large" } };
    // NOFOLLOW closes the final symlink race; NONBLOCK prevents a replacement
    // pipe from hanging POSIX reads. fstat + re-resolution defend replacements.
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch {
      throw unavailable();
    }
    try {
      const info = await handle.stat();
      const current = await this.#resolve(projectId, relativePath);
      const currentInfo = await stat(current.target);
      if (
        !info.isFile() ||
        info.dev !== currentInfo.dev ||
        info.ino !== currentInfo.ino ||
        !isPathInsideRoot(root, current.target) ||
        pathComparisonKey(current.target) !== pathComparisonKey(target)
      )
        throw unavailable();
      if (info.size > limit) return { preview: { ...base, sizeBytes: info.size, kind: "too-large" } };
      const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
      let read = 0;
      while (read < bytes.length) {
        const r = await handle.read(bytes, read, bytes.length - read, null);
        if (!r.bytesRead) break;
        read += r.bytesRead;
      }
      if (read > limit) return { preview: { ...base, sizeBytes: read, kind: "too-large" } };
      const data = bytes.subarray(0, read),
        mime = rasterMime(data);
      if (mime && rasterExtensions.has(extension))
        return { preview: { ...base, sizeBytes: read, kind: "image", mimeType: mime }, bytes: data };
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        return { preview: { ...base, kind: "unsupported" } };
      }
      // These literal controls distinguish binary/special content from text.
      if (
        rasterExtensions.has(extension) ||
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u0008\u000b\u000e-\u001f]/.test(text) ||
        extension === ".svg" ||
        extension === ".pdf"
      ) {
        return { preview: { ...base, kind: "unsupported" } };
      }
      return { preview: { ...base, sizeBytes: read, kind: "text", mimeType: "text/plain", text } };
    } catch (error) {
      if (error instanceof HostError) throw error;
      throw unavailable();
    } finally {
      await handle.close();
    }
  }
}

function rasterMime(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  if (b.length >= 10 && ["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6))) return "image/gif";
  return null;
}
