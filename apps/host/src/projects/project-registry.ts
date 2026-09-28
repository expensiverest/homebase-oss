import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { AdapterLogger } from "@homebase/adapter-sdk";
import type { AgentProject, ProjectId } from "@homebase/protocol";

import { HostError } from "../errors.js";
import { canonicalizeExistingPath, isPathInsideRoot, pathComparisonKey, type PathAllowlist } from "../paths.js";

const execFileAsync = promisify(execFile);

/** Directories that never contain a project the user cares about. */
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", "out", "target", "vendor", ".git"]);

export interface GitMetadata {
  branch: string | null;
  remote: string | null;
  gitRoot: string | null;
}

export interface GitMetadataReader {
  read(projectPath: string): Promise<GitMetadata>;
}

/** Deterministic Homebase project id derived from the canonical path. */
export function projectIdForPath(canonicalPath: string): ProjectId {
  const digest = createHash("sha256").update(pathComparisonKey(canonicalPath)).digest("hex");
  return `prj_${digest.slice(0, 12)}`;
}

/** Reads branch/remote with the local git binary; failures degrade gracefully. */
export const defaultGitMetadataReader: GitMetadataReader = {
  async read(projectPath: string): Promise<GitMetadata> {
    const run = async (args: string[]): Promise<string> => {
      const { stdout } = await execFileAsync("git", ["-C", projectPath, ...args], {
        timeout: 5_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return stdout.trim();
    };

    const [gitRoot, branch, remote] = await Promise.all([
      run(["rev-parse", "--show-toplevel"]).catch(() => ""),
      run(["branch", "--show-current"]).catch(() => ""),
      run(["config", "--get", "remote.origin.url"]).catch(() => ""),
    ]);

    return {
      gitRoot: gitRoot.length > 0 ? gitRoot : null,
      branch: branch.length > 0 ? branch : null,
      remote: remote.length > 0 ? remote : null,
    };
  },
};

export interface ProjectRegistryOptions {
  /** Canonical roots from the allowlist. */
  roots: readonly string[];
  allowlist: PathAllowlist;
  scanDepth?: number;
  logger?: AdapterLogger;
  git?: GitMetadataReader;
}

/**
 * Discovers repositories under the Host's configured project roots and owns
 * the mapping from Homebase project ids to canonical paths. Provider calls
 * receive project ids and `AgentProject` records from here, never raw paths
 * supplied by clients.
 */
export class ProjectRegistry {
  readonly #allowlist: PathAllowlist;
  readonly #roots: readonly string[];
  readonly #scanDepth: number;
  readonly #logger: AdapterLogger | undefined;
  readonly #git: GitMetadataReader;

  #projects = new Map<ProjectId, AgentProject>();

  constructor(options: ProjectRegistryOptions) {
    this.#allowlist = options.allowlist;
    this.#roots = [...options.roots];
    this.#scanDepth = options.scanDepth ?? 3;
    this.#logger = options.logger;
    this.#git = options.git ?? defaultGitMetadataReader;
  }

  get roots(): readonly string[] {
    return this.#roots;
  }

  /** Scans every configured root for git repositories. */
  async discover(): Promise<AgentProject[]> {
    const found = new Map<string, AgentProject>();
    for (const root of this.#roots) {
      await this.#scan(root, 0, found);
    }
    this.#projects = new Map([...found.entries()].map(([id, project]) => [id as ProjectId, project]));
    this.#logger?.info("Project discovery complete.", { projects: this.#projects.size, roots: this.#roots.length });
    return this.list();
  }

  async #scan(directory: string, levelsBelowRoot: number, found: Map<string, AgentProject>): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      this.#logger?.debug("Skipping unreadable directory during discovery.", {
        directory,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const hasGitEntry = entries.some((entry) => entry.name === ".git");
    if (hasGitEntry) {
      const canonical = await canonicalizeExistingPath(directory).catch(() => path.resolve(directory));
      if (this.#allowlist.allowsCanonical(canonical)) {
        const metadata = await this.#git.read(canonical).catch(() => ({ branch: null, remote: null, gitRoot: null }));
        const id = projectIdForPath(canonical);
        if (!found.has(id)) {
          found.set(id, {
            id,
            name: path.basename(canonical),
            path: canonical,
            gitRoot: metadata.gitRoot ?? canonical,
            gitRemote: metadata.remote,
            branch: metadata.branch,
            providersAvailable: [],
          });
        }
      }
    }

    if (levelsBelowRoot >= this.#scanDepth) return;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) continue;
      await this.#scan(path.join(directory, entry.name), levelsBelowRoot + 1, found);
    }
  }

  list(): AgentProject[] {
    return [...this.#projects.values()].map((project) => ({ ...project })).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(projectId: ProjectId): AgentProject | undefined {
    const project = this.#projects.get(projectId);
    return project ? { ...project } : undefined;
  }

  require(projectId: ProjectId): AgentProject {
    const project = this.#projects.get(projectId);
    if (!project) {
      throw new HostError("project_not_found", `Unknown project "${projectId}".`);
    }
    return { ...project };
  }

  /** Canonical, allowlisted path for a registered project. */
  async resolvePath(projectId: ProjectId): Promise<string> {
    const project = this.require(projectId);
    return this.#allowlist.check(project.path);
  }

  /**
   * Maps a provider-reported directory (for example a session location) back to
   * a registered project, or undefined when it is outside every configured
   * root. Exact matches win; containment covers sessions in subdirectories.
   */
  async findByPath(candidate: string): Promise<AgentProject | undefined> {
    const canonical = await canonicalizeExistingPath(candidate).catch(() => path.resolve(candidate));
    const key = pathComparisonKey(canonical);
    for (const project of this.#projects.values()) {
      if (pathComparisonKey(project.path) === key) return { ...project };
    }
    for (const project of this.#projects.values()) {
      if (isPathInsideRoot(project.path, canonical)) return { ...project };
    }
    return undefined;
  }
}
