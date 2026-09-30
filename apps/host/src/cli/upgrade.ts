import { serviceContext } from "./context.js";
import { upgradeService } from "../setup/upgrade.js";
import type { CliArguments } from "./parse.js";
import type { CliIo } from "./io.js";
export async function runUpgradeCommand(args: CliArguments, io: CliIo): Promise<number> {
  const context = await serviceContext(args, true);
  await upgradeService({
    current: context.definition,
    installed: context.metadata,
    manager: context.manager,
    service: context.controller,
    io,
  });
  return 0;
}
