import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import {
  readJsonObjectFile,
  resolveConfigTargetPaths,
  resolveStateDir,
  validateHostConfigRaw,
} from "../config/index.js";
import { createServiceManager } from "../service/manager.js";
import { currentDefinition, readServiceMetadata, sanitizePath } from "../service/metadata.js";
import { ServiceController } from "../service/service.js";
import { HOST_VERSION } from "../version.js";
import type { ServiceDefinition } from "../service/types.js";
import type { CliArguments } from "./parse.js";

export function cliPaths(args: CliArguments) {
  return { configPath: resolveConfigTargetPaths({ configPath: args.config }).configPath, stateDir: resolveStateDir() };
}
export async function serviceContext(args: CliArguments, refresh = false) {
  const paths = cliPaths(args);
  const config = validateHostConfigRaw(await readJsonObjectFile(paths.configPath));
  const manager = createServiceManager();
  const metadata = await readServiceMetadata(paths.stateDir);
  let definition: ServiceDefinition;
  if (refresh) definition = await currentDefinition(paths.configPath, paths.stateDir);
  else
    definition = metadata ?? {
      nodePath: process.execPath,
      entryPath: fileURLToPath(new URL("../index.js", import.meta.url)),
      ...paths,
      path: sanitizePath(process.env.PATH ?? process.env.Path ?? ""),
      homebaseVersion: HOST_VERSION,
    };
  if (
    metadata &&
    (await realpath(metadata.configPath).catch(() => metadata.configPath)) !== (await realpath(paths.configPath))
  ) {
    throw new Error(
      `The service uses another config: ${metadata.configPath}. Invoke this command with --config for that file.`,
    );
  }
  return {
    ...paths,
    config,
    manager,
    metadata,
    definition,
    controller: new ServiceController({ manager, definition, port: config.host.port }),
  };
}
