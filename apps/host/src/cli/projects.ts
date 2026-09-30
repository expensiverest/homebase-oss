import path from "node:path";
import { realpath } from "node:fs/promises";
import { pathComparisonKey } from "../paths.js";

import {
  addProjectRoot,
  listProjectRoots,
  loadConfigDetailed,
  removeProjectRoot,
  resolveConfigTargetPaths,
} from "../config/index.js";
import type { CliArguments } from "./parse.js";
import type { CliIo } from "./io.js";
import { readServiceMetadata } from "../service/metadata.js";
import { resolveStateDir } from "../config/index.js";
import { serviceContext } from "./context.js";

/**
 * `homebase projects ...` — the only supported way to change the project-root
 * allowlist. These commands are local-only (no API route can add roots) and
 * edit the same validated configuration file the Host loads at startup.
 */
export async function runProjectsCommand(
  args: CliArguments,
  io: CliIo,
  restart: typeof restartForProjectChange = restartForProjectChange,
): Promise<number> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const cwd = process.cwd();
  const target = resolveConfigTargetPaths({
    ...(args.config !== undefined ? { configPath: args.config } : {}),
    env,
    cwd,
  });

  // Validates the configuration and performs the one-time legacy migration,
  // exactly like normal Host startup; explicit missing files fail loudly.
  await loadConfigDetailed({
    ...(args.config !== undefined ? { configPath: args.config } : {}),
    env,
    cwd,
    onNotice: (message) => io.out(message),
  });

  const subcommand = args.positionals[1] ?? "list";
  switch (subcommand) {
    case "list":
      return listRoots(io, target.configPath);
    case "add":
      return addRoot(io, target.configPath, args.positionals[2], () =>
        args.noRestart ? Promise.resolve(false) : restart(args, io),
      );
    case "remove":
      return removeRoot(io, target.configPath, args.positionals[2], () =>
        args.noRestart ? Promise.resolve(false) : restart(args, io),
      );
    default:
      io.error(`Unknown projects command "${subcommand}". Run homebase --help.`);
      return 1;
  }
}

async function listRoots(io: CliIo, configPath: string): Promise<number> {
  const { roots } = await listProjectRoots(configPath);
  if (roots.length === 0) {
    io.out("No project roots configured.\n\nAdd the current folder:\n  homebase projects add");
    return 0;
  }
  io.out("Project roots\n");
  roots.forEach((root, index) => io.out(`${index + 1}. ${root}`));
  io.out(`\n${roots.length} ${roots.length === 1 ? "root" : "roots"} configured.`);
  return 0;
}

async function addRoot(
  io: CliIo,
  configPath: string,
  input: string | undefined,
  restart: () => Promise<boolean>,
): Promise<number> {
  const requested = input ?? process.cwd();
  const result = await addProjectRoot({ configPath, root: requested });
  if (result.changed) {
    io.out(`Added project root:\n${result.path}`);
    if (!(await restart())) io.out("Restart Homebase to discover projects in this folder.");
  } else {
    io.out(`Already a project root:\n${result.path}`);
  }
  return 0;
}

async function removeRoot(
  io: CliIo,
  configPath: string,
  input: string | undefined,
  restart: () => Promise<boolean>,
): Promise<number> {
  if (input === undefined || input.trim() === "") {
    io.error("Usage: homebase projects remove <path>");
    return 1;
  }
  const result = await removeProjectRoot({ configPath, root: input });
  if (result.changed) {
    io.out(`Removed project root:\n${result.path}`);
    if (!(await restart())) io.out("Restart Homebase to apply this change.");
    return 0;
  }
  io.out(`Not a configured project root:\n${path.resolve(input)}`);
  return 0;
}

export async function restartForProjectChange(args: CliArguments, io: CliIo): Promise<boolean> {
  if (args.noRestart) return false;
  // No metadata means no Homebase-managed service to restart. This also keeps ordinary CI away from OS managers.
  const metadata = await readServiceMetadata(resolveStateDir());
  if (!metadata) return false;
  const target = resolveConfigTargetPaths({ configPath: args.config }).configPath;
  if (
    pathComparisonKey(await realpath(metadata.configPath).catch(() => metadata.configPath)) !==
    pathComparisonKey(await realpath(target))
  )
    return false;
  const context = await serviceContext(args);
  if (!(await context.manager.isAvailable())) return false;
  const state = await context.manager.inspect();
  if (!state.installed || !state.running) return false;
  if (!context.manager.matches(state, context.definition))
    throw new Error(
      "Project roots saved, but the installed service command differs. Run `homebase setup` before restarting.",
    );
  io.out("Restarting Homebase...");
  await context.controller.restart();
  io.out("✓ Ready");
  return true;
}
