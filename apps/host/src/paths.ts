import { stat, realpath } from "node:fs/promises";
import path from "node:path";

import { HostError } from "./errors.js";

const IS_WINDOWS = process.platform === "win32";

/**
 * True for addresses that only expose the Host to the local machine.
 * Non-loopback binds require authentication and are never the default.
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized.startsWith("127.")
  );
}

/** Strips the Windows extended-length prefix that `realpath` can return. */
export function stripExtendedPathPrefix(value: string): string {
  return value.startsWith("\\\\?\\") ? value.slice(4) : value;
}

/**
 * Resolves a path to its canonical absolute form. Requires the path to exist;
 * symlinks are fully resolved so they cannot escape an allowlisted root.
 */
export async function canonicalizeExistingPath(input: string): Promise<string> {
  if (input.trim().length === 0) {
    throw new HostError("invalid_request", "Path must not be empty.");
  }
  const absolute = path.resolve(input);
  const resolved = stripExtendedPathPrefix(await realpath(absolute));
  return resolved;
}

/** Comparison key; Windows paths are case-insensitive. */
export function pathComparisonKey(value: string): string {
  return IS_WINDOWS ? value.toLowerCase() : value;
}

/** True when `candidate` is `root` itself or lives underneath it. */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(pathComparisonKey(root), pathComparisonKey(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export interface PathAllowlistInit {
  allowlist: PathAllowlist;
  /** Configured roots that do not currently exist or are not directories. */
  unavailableRoots: string[];
}

/**
 * Canonical allowlist of project roots. Every path that reaches a provider
 * process must pass through this check; configured roots are canonicalized once
 * at startup so symlinks and `..` cannot bypass them later.
 */
export class PathAllowlist {
  readonly roots: readonly string[];

  private constructor(roots: string[]) {
    this.roots = roots;
  }

  static async create(configuredRoots: readonly string[]): Promise<PathAllowlistInit> {
    const canonicalRoots: string[] = [];
    const unavailableRoots: string[] = [];

    for (const root of configuredRoots) {
      if (!path.isAbsolute(root)) {
        throw new HostError("invalid_request", `Configured project root must be an absolute path: "${root}".`);
      }
      try {
        const canonical = await canonicalizeExistingPath(root);
        const info = await stat(canonical);
        if (!info.isDirectory()) {
          unavailableRoots.push(root);
          continue;
        }
        const key = pathComparisonKey(canonical);
        if (!canonicalRoots.some((existing) => pathComparisonKey(existing) === key)) {
          canonicalRoots.push(canonical);
        }
      } catch {
        unavailableRoots.push(root);
      }
    }

    return { allowlist: new PathAllowlist(canonicalRoots), unavailableRoots };
  }

  /** True when an already-canonical path is inside a configured root. */
  allowsCanonical(canonicalPath: string): boolean {
    return this.roots.some((root) => isPathInsideRoot(root, canonicalPath));
  }

  /**
   * Canonicalizes a path and checks it against the configured roots. Returns
   * the canonical path; throws `project_not_allowed` or `project_unavailable`.
   */
  async check(candidate: string): Promise<string> {
    let canonical: string;
    try {
      canonical = await canonicalizeExistingPath(candidate);
    } catch (error) {
      throw new HostError("project_unavailable", "The requested path does not exist or is not accessible.", {
        cause: error,
      });
    }
    if (!this.allowsCanonical(canonical)) {
      throw new HostError("project_not_allowed", "The requested path is outside the configured project roots.");
    }
    return canonical;
  }
}
