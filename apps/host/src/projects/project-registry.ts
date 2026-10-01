import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { AdapterLogger } from "@homebase/adapter-sdk";
import type { AgentProject, AgentSession, ProjectId, ProjectRoot, ProjectSummary } from "@homebase/protocol";
import type { ProjectActivity } from "./activity.js";

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

export function rootIdForPath(canonicalPath: string): string {
  return `root_${createHash("sha256").update(pathComparisonKey(canonicalPath)).digest("hex").slice(0, 12)}`;
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
  unavailableRoots?: readonly string[];
  activity?: ProjectActivity;
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
  readonly #unavailableRoots: readonly string[];
  readonly #activity: ProjectActivity | undefined;

  #projects = new Map<ProjectId, AgentProject>();

  constructor(options: ProjectRegistryOptions) {
    this.#allowlist = options.allowlist;
    this.#roots = [...options.roots];
    this.#scanDepth = options.scanDepth ?? 3;
    this.#logger = options.logger;
    this.#git = options.git ?? defaultGitMetadataReader;
    this.#unavailableRoots = options.unavailableRoots ?? [];
    this.#activity = options.activity;
  }

  get roots(): readonly string[] {
    return this.#roots;
  }

  rootForProject(project: AgentProject): string {
    const root = [...this.#roots]
      .filter((root) => isPathInsideRoot(root, project.path))
      .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
    if (!root) throw new HostError("project_not_allowed", "Project no longer belongs to a configured folder.");
    return rootIdForPath(root);
  }

  summaries(sessions: readonly AgentSession[]): ProjectSummary[] {
    const grouped = new Map<string, AgentSession[]>();
    for (const session of sessions) {
      const group = grouped.get(session.projectId) ?? [];
      group.push(session);
      grouped.set(session.projectId, group);
    }
    return this.list()
      .map((project) => {
        const known = grouped.get(project.id) ?? [];
        return {
          ...project,
          rootId: this.rootForProject(project),
          lastActivityAt: this.#activity?.get(project.id) ?? null,
          knownSessionCount: known.length,
          workingCount: known.filter((s) => s.state === "working").length,
          waitingCount: known.filter((s) => s.state === "waiting").length,
        };
      })
      .sort(
        (a, b) =>
          (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
  }

  listRoots(): ProjectRoot[] {
    const projects = this.summaries([]);
    return [...this.#roots, ...this.#unavailableRoots]
      .map((root) => {
        const id = rootIdForPath(root),
          children = projects.filter((p) => p.rootId === id);
        return {
          id,
          name: path.basename(root) || root,
          path: root,
          available: this.#roots.includes(root),
          projectCount: children.length,
          lastActivityAt:
            children
              .map((p) => p.lastActivityAt)
              .filter((t): t is string => !!t)
              .sort()
              .at(-1) ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  }

  projectsForRoot(rootId: string, sessions: readonly AgentSession[]): ProjectSummary[] {
    if (!this.listRoots().some((root) => root.id === rootId))
      throw new HostError("not_found", "Configured folder not found.");
    return this.summaries(sessions).filter((p) => p.rootId === rootId);
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
    for (const project of [...this.#projects.values()].sort(
      (a, b) => b.path.length - a.path.length || a.id.localeCompare(b.id),
    )) {
      if (isPathInsideRoot(project.path, canonical)) return { ...project };
    }
    return undefined;
  }
}
