import { lstat, realpath, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileExists } from "../config/index.js";
import { isPathInsideRoot, pathComparisonKey } from "../paths.js";
import type { CliIo } from "../cli/io.js";
import type { SetupPrompter } from "./prompts.js";

const OWNED = new Set([
  "config.json",
  "security.json",
  "admin-key",
  "service.json",
  "project-activity.json",
  "state-owner.json",
  "logs",
  "cache",
  "service",
]);
export async function validatePurgeTarget(
  stateDir: string,
  options: { repository?: string; home?: string; projectRoots?: string[] } = {},
): Promise<string> {
  if (!stateDir.trim() || [".", ".."].includes(stateDir.trim()) || !path.isAbsolute(stateDir))
    throw new Error("Refusing unsafe state purge path.");
  const info = await lstat(stateDir);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Refusing to purge a symlink or non-directory state location.");
  const target = await realpath(stateDir);
  const home = await realpath(options.home ?? os.homedir());
  const repository = await realpath(options.repository ?? process.cwd());
  const providerDirectories = [".claude", ".grok", ".config/opencode", ".config/grok", ".config/tailscale"].map(
    (name) => path.join(home, name),
  );
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA])
    if (base)
      for (const name of ["Claude", "OpenCode", "Grok", "Tailscale"]) providerDirectories.push(path.join(base, name));
  if (
    providerDirectories.some((directory) => isPathInsideRoot(directory, target) || isPathInsideRoot(target, directory))
  )
    throw new Error("Refusing to purge a provider or Tailscale data location.");
  const components = target
    .slice(path.parse(target).root.length)
    .split(/[\\/]+/)
    .filter(Boolean);
  if (
    components.length < 3 ||
    isPathInsideRoot(target, home) ||
    isPathInsideRoot(target, repository) ||
    (options.projectRoots ?? []).some((root) => isPathInsideRoot(target, root)) ||
    (await fileExists(path.join(target, ".git")))
  )
    throw new Error("Refusing to purge a root, home, repository, project ancestor, or shallow directory.");
  let marker: { version?: number; product?: string; stateDir?: string };
  try {
    marker = JSON.parse(await readFile(path.join(target, "state-owner.json"), "utf8"));
  } catch {
    throw new Error(
      "State ownership marker is absent. Run setup before using --purge-state, or remove verified Homebase files manually.",
    );
  }
  if (
    marker.version !== 1 ||
    marker.product !== "homebase" ||
    !marker.stateDir ||
    pathComparisonKey(marker.stateDir) !== pathComparisonKey(target)
  )
    throw new Error("State ownership marker does not match this directory. Purge refused.");
  const entries = await readdir(target);
  if (entries.some((name) => !OWNED.has(name)))
    throw new Error(
      "State directory contains files Homebase does not own. Purge refused; remove Homebase files manually.",
    );
  return target;
}
export async function uninstallHomebase(options: {
  stateDir: string;
  io: CliIo;
  purge: boolean;
  prompts?: SetupPrompter;
  service: { uninstall(): Promise<void> };
  repository?: string;
  projectRoots?: string[];
}): Promise<void> {
  const { io } = options;
  io.out(
    "Homebase will stop gracefully and remove its user background service. Provider CLIs, provider logins, projects, and Tailscale are left unchanged.",
  );
  let purgeTarget: string | null = null;
  if (options.purge && (await fileExists(options.stateDir))) {
    purgeTarget = await validatePurgeTarget(options.stateDir, {
      repository: options.repository,
      projectRoots: options.projectRoots,
    });
    if (
      !options.prompts ||
      !(await options.prompts.confirm(`Permanently delete Homebase state at ${purgeTarget}?`, false))
    )
      throw new Error("State purge cancelled; nothing was removed.");
  }
  await options.service.uninstall();
  io.out(
    "Homebase background service removed.\nTailscale Serve was left unchanged. Inspect `tailscale serve status` before removing any mapping. For an HTTPS root dedicated to Homebase: `tailscale serve --https=443 off`.",
  );
  if (purgeTarget) {
    const rechecked = await validatePurgeTarget(options.stateDir, {
      repository: options.repository,
      projectRoots: options.projectRoots,
    });
    if (rechecked !== purgeTarget) throw new Error("State path changed; purge refused.");
    await rm(purgeTarget, { recursive: true, force: true });
    io.out("Homebase state removed.");
  } else
    io.out(
      `Your Homebase state was preserved at:\n${options.stateDir}\n\nTo remove it too:\n  homebase uninstall --purge-state`,
    );
  io.out(
    "To remove the linked CLI: npm run unlink:cli in the source checkout. Remove the checkout yourself when no longer needed.",
  );
}
