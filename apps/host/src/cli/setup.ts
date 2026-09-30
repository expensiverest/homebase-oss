import { createServiceManager } from "../service/manager.js";
import { runSetup } from "../setup/setup.js";
import { ReadlinePrompter, SetupCancelled } from "../setup/prompts.js";
import { cliPaths } from "./context.js";
import type { CliArguments } from "./parse.js";
import type { CliIo } from "./io.js";
export async function runSetupCommand(args: CliArguments, io: CliIo): Promise<number> {
  const prompts = new ReadlinePrompter();
  try {
    return await runSetup({
      ...cliPaths(args),
      explicitConfig: !!args.config || !!process.env.HOMEBASE_CONFIG,
      cwd: process.cwd(),
      io,
      prompts,
      manager: createServiceManager(),
    });
  } catch (error) {
    if (error instanceof SetupCancelled) {
      io.out(error.message);
      return 130;
    }
    throw error;
  } finally {
    prompts.close();
  }
}
