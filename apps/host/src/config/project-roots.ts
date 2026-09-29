import { stat } from "node:fs/promises";
import path from "node:path";

import { canonicalizeExistingPath, pathComparisonKey } from "../paths.js";
import { validateHostConfigRaw } from "./config.js";
import { atomicWriteJson, fileExists, readJsonObjectFile } from "./store.js";

/**
 * Local operator management of configured project roots.
 *
 * This is a Host-side (CLI) operation only. The project-root allowlist is a
 * security boundary: the PWA can never submit arbitrary filesystem paths, and
 * only the local operator can change the configured roots. The same config
 * file the Host loads is edited here, atomically and schema-validated.
 */

export interface ProjectRootsInfo {
  configPath: string;
  roots: string[];
}

export interface ProjectRootChange {
  configPath: string;
  /** Canonical path that changed, or null when nothing matched. */
  path: string | null;
  /** False when the root was already present (add) or absent (remove). */
  changed: boolean;
  roots: string[];
}

function describeRootsError(configPath: string, message: string): Error {
  return new Error(`${message} (configuration: ${configPath})`);
}

async function readConfigForEdit(configPath: string): Promise<Record<string, unknown>> {
  if (!(await fileExists(configPath))) return {};
  try {
    return await readJsonObjectFile(configPath);
  } catch (error) {
    throw describeRootsError(configPath, error instanceof Error ? error.message : String(error));
  }
}

function readRoots(raw: Record<string, unknown>, configPath: string): string[] {
  const value = raw.projectRoots;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw describeRootsError(configPath, '"projectRoots" must be an array of non-empty strings.');
  }
  return value as string[];
}

/** Canonical comparison form for a configured (or requested) root. */
async function rootComparisonKey(value: string): Promise<string> {
  const canonical = await canonicalizeExistingPath(value).catch(() => path.resolve(value));
  return pathComparisonKey(canonical);
}

/** Requires the input to be an existing directory and returns its canonical path. */
export async function canonicalizeProjectRoot(input: string): Promise<string> {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("A project root path is required.");
  const absolute = path.resolve(trimmed);
  let canonical: string;
  try {
    canonical = await canonicalizeExistingPath(absolute);
  } catch {
    throw new Error(`The path does not exist or is not accessible: ${absolute}`);
  }
  const info = await stat(canonical);
  if (!info.isDirectory()) {
    throw new Error(`A project root must be a directory: ${canonical}`);
  }
  return canonical;
}

/** Reads configured roots without modifying anything. */
export async function listProjectRoots(configPath: string): Promise<ProjectRootsInfo> {
  const raw = await readConfigForEdit(configPath);
  return { configPath, roots: readRoots(raw, configPath) };
}

/**
 * Adds one canonical project root to the configuration. Duplicate roots
 * (case-insensitive on Windows) are a no-op; the file is only rewritten when
 * something actually changed.
 */
export async function addProjectRoot(options: { configPath: string; root: string }): Promise<ProjectRootChange> {
  const canonical = await canonicalizeProjectRoot(options.root);
  const raw = await readConfigForEdit(options.configPath);
  const roots = readRoots(raw, options.configPath);
  const key = pathComparisonKey(canonical);
  for (const existing of roots) {
    if ((await rootComparisonKey(existing)) === key) {
      return { configPath: options.configPath, path: canonical, changed: false, roots };
    }
  }
  const nextRoots = [...roots, canonical];
  const next = { ...raw, projectRoots: nextRoots };
  // The complete result must satisfy the same schema and security invariants
  // the Host enforces at startup before it is persisted.
  validateHostConfigRaw(next, `Homebase configuration at ${options.configPath}`);
  await atomicWriteJson(options.configPath, next);
  return { configPath: options.configPath, path: canonical, changed: true, roots: nextRoots };
}

/**
 * Removes one configured project root by exact canonical match. Substrings and
 * ambiguous partial paths are never interpreted.
 */
export async function removeProjectRoot(options: { configPath: string; root: string }): Promise<ProjectRootChange> {
  const requested = await rootComparisonKey(options.root);
  const raw = await readConfigForEdit(options.configPath);
  const roots = readRoots(raw, options.configPath);
  let matched: string | null = null;
  for (const existing of roots) {
    if ((await rootComparisonKey(existing)) === requested) {
      matched = existing;
      break;
    }
  }
  if (matched === null) {
    return { configPath: options.configPath, path: null, changed: false, roots };
  }
  const nextRoots = roots.filter((existing) => existing !== matched);
  const next = { ...raw, projectRoots: nextRoots };
  validateHostConfigRaw(next, `Homebase configuration at ${options.configPath}`);
  await atomicWriteJson(options.configPath, next);
  return { configPath: options.configPath, path: matched, changed: true, roots: nextRoots };
}
