import { uninstallHomebase } from "../setup/uninstall.js";
import { ReadlinePrompter } from "../setup/prompts.js";
import { createServiceManager } from "../service/manager.js";
import { readServiceMetadata, metadataPath } from "../service/metadata.js";
import { ServiceController } from "../service/service.js";
import { fileExists, readJsonObjectFile, validateHostConfigRaw } from "../config/index.js";
import { rm } from "node:fs/promises";
import { cliPaths } from "./context.js";
import type { CliArguments } from "./parse.js";
import type { CliIo } from "./io.js";
export async function runUninstallCommand(args: CliArguments, io: CliIo): Promise<number> {
  const paths = cliPaths(args);
  const metadata = await readServiceMetadata(paths.stateDir);
  const manager = createServiceManager();
  const configPath = metadata?.configPath ?? paths.configPath;
  const config = (await fileExists(configPath)) ? validateHostConfigRaw(await readJsonObjectFile(configPath)) : null;
  const prompts = args.purgeState ? new ReadlinePrompter() : undefined;
  try {
    await uninstallHomebase({
      stateDir: paths.stateDir,
      purge: args.purgeState === true,
      io,
      prompts,
      projectRoots: config?.projectRoots,
      service: {
        uninstall: async () => {
          if (await manager.isAvailable()) {
            if (metadata && config)
              await new ServiceController({ manager, definition: metadata, port: config.host.port }).uninstall();
            else if ((await manager.inspect()).installed)
              throw new Error(
                "Installed service lacks usable metadata/config. Inspect `homebase service status` before removal; state was preserved.",
              );
          } else if (metadata)
            throw new Error(
              "The service manager is unavailable; removal could not be verified. Service metadata and user state were preserved. Run `homebase doctor`.",
            );
          await rm(metadataPath(paths.stateDir), { force: true });
        },
      },
    });
    return 0;
  } finally {
    prompts?.close();
  }
}
