import { loadConfigDetailed } from "../config/index.js";
import { createHostRuntime } from "../server.js";
import { HOST_VERSION } from "../version.js";
import { runDevicesCommand, runPairCommand, runRevokeCommand } from "./admin.js";
import { consoleIo, printFailure, type CliIo } from "./io.js";
import { CliUsageError, parseCliArguments, type CliArguments } from "./parse.js";
import { runProjectsCommand } from "./projects.js";
import { USAGE } from "./usage.js";
import { runSetupCommand } from "./setup.js";
import { runServiceCommand } from "./service.js";
import { runDoctorCommand } from "./doctor.js";
import { runUninstallCommand } from "./uninstall.js";
import { runUpgradeCommand } from "./upgrade.js";
import { serviceLogging } from "../service/logging.js";
import path from "node:path";

export type { CliIo } from "./io.js";

/** Environment passed to config loading, with CLI flag overrides applied. */
function hostEnvironment(args: CliArguments): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (args.port !== undefined) env.HOMEBASE_PORT = args.port;
  if (args.bind !== undefined) env.HOMEBASE_BIND_ADDRESS = args.bind;
  return env;
}

/**
 * Runs the Homebase CLI and returns a process exit code. All commands share
 * one config resolution path so `homebase` behaves the same from any working
 * directory. The default invocation starts the Host.
 */
export async function runCli(argv: string[], io: CliIo = consoleIo): Promise<number> {
  let args: CliArguments;
  try {
    args = parseCliArguments(argv);
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.error(`Homebase: ${error.message}`);
      io.error(USAGE);
      return 1;
    }
    throw error;
  }

  if (args.help) {
    io.out(USAGE);
    return 0;
  }
  if (args.version) {
    io.out(`homebase ${HOST_VERSION}`);
    return 0;
  }

  const command = args.positionals[0];
  try {
    if (command === undefined) return await runHost(args, io);
    const handlers: Record<string, (args: CliArguments, io: CliIo) => Promise<number>> = {
      pair: runPair,
      devices: runDevices,
      revoke: runRevoke,
      projects: runProjectsCommand,
      setup: runSetupCommand,
      service: runServiceCommand,
      doctor: runDoctorCommand,
      uninstall: runUninstallCommand,
      upgrade: runUpgradeCommand,
    };
    const handler = handlers[command];
    if (handler) return await handler(args, io);
    io.error(`Unknown command "${command}". Run homebase --help.`);
    return 1;
  } catch (error) {
    printFailure(io, error);
    return 1;
  }
}

async function runHost(args: CliArguments, io: CliIo): Promise<number> {
  if (args.serviceRuntime) {
    if (
      !args.stateDir ||
      !path.isAbsolute(args.stateDir) ||
      args.servicePath === undefined ||
      !args.config ||
      !path.isAbsolute(args.config)
    )
      throw new Error("Invalid installed Homebase service context. Run `homebase setup`.");
    // Keep OS-owned user context; never inherit shell Homebase overrides at login.
    for (const key of Object.keys(process.env)) if (key.startsWith("HOMEBASE_")) delete process.env[key];
    process.env.HOMEBASE_STATE_DIR = args.stateDir;
    delete process.env.Path;
    process.env.PATH = args.servicePath;
  }
  const logging = args.serviceRuntime ? serviceLogging(args.stateDir!) : undefined;
  if (logging) io = logging.io;
  const env = hostEnvironment(args);
  const loaded = await loadConfigDetailed({
    ...(args.config !== undefined ? { configPath: args.config } : {}),
    env,
    cwd: process.cwd(),
    onNotice: (message) => io.out(message),
  });
  const runtime = await createHostRuntime({ config: loaded.config, ...(logging ? { logger: logging.logger } : {}) });
  let address: { hostname: string; port: number };
  try {
    address = await runtime.start();
  } catch (error) {
    await runtime.close();
    throw error;
  }

  const displayHost = address.hostname.includes(":") ? `[${address.hostname}]` : address.hostname;
  io.out(`Homebase Host ${HOST_VERSION} listening on http://${displayHost}:${address.port}`);
  io.out(`Config: ${loaded.configPath ?? "built-in defaults (no config file yet)"}`);

  for (const provider of runtime.providers.listProviders()) {
    io.out(`Provider ${provider.id}: ${providerStatus(provider)}`);
  }
  io.out(`Projects: ${runtime.projects.list().length}`);

  return await new Promise<number>((resolve) => {
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      io.out(`Received ${signal}; shutting down.`);
      try {
        await runtime.close();
        resolve(0);
      } catch (error) {
        printFailure(io, error);
        resolve(1);
      }
    };
    const interrupt = () => void shutdown("SIGINT");
    const terminate = () => void shutdown("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    void runtime.closed.then(() => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
      resolve(0);
    });
  });
}

function providerStatus(provider: {
  installed: boolean;
  authenticated: boolean | null;
  compatible: boolean;
  version?: string | null;
  warning?: string | null;
}): string {
  const version = provider.version ? ` (${provider.version})` : "";
  if (!provider.installed) return `not available${version}${provider.warning ? ` — ${provider.warning}` : ""}`;
  if (!provider.compatible) return `incompatible${version}${provider.warning ? ` — ${provider.warning}` : ""}`;
  if (provider.authenticated === false)
    return `installed, not authenticated${version}${provider.warning ? ` — ${provider.warning}` : ""}`;
  const suffix = provider.warning ? ` — ${provider.warning}` : "";
  return `ready${version}${suffix}`;
}

async function runPair(args: CliArguments, io: CliIo): Promise<number> {
  const { config } = await loadConfigDetailed({
    ...(args.config !== undefined ? { configPath: args.config } : {}),
    env: hostEnvironment(args),
    cwd: process.cwd(),
    onNotice: (message) => io.out(message),
  });
  await runPairCommand(io, {
    port: config.host.port,
    ...(args.url !== undefined ? { url: args.url } : {}),
  });
  return 0;
}

async function runDevices(args: CliArguments, io: CliIo): Promise<number> {
  const { config } = await loadConfigDetailed({
    ...(args.config !== undefined ? { configPath: args.config } : {}),
    env: hostEnvironment(args),
    cwd: process.cwd(),
    onNotice: (message) => io.out(message),
  });
  await runDevicesCommand(io, { port: config.host.port });
  return 0;
}

async function runRevoke(args: CliArguments, io: CliIo): Promise<number> {
  const deviceId = args.positionals[1];
  if (deviceId === undefined || deviceId.trim() === "") {
    io.error("Usage: homebase revoke <device-id>");
    return 1;
  }
  const { config } = await loadConfigDetailed({
    ...(args.config !== undefined ? { configPath: args.config } : {}),
    env: hostEnvironment(args),
    cwd: process.cwd(),
    onNotice: (message) => io.out(message),
  });
  await runRevokeCommand(io, { port: config.host.port, deviceId });
  return 0;
}
