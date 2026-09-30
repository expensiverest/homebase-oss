import { readHealth } from "../service/health.js";
import { HOST_VERSION } from "../version.js";
import type { CliArguments } from "./parse.js";
import type { CliIo } from "./io.js";
import { cliPaths, serviceContext } from "./context.js";
import { createServiceManager } from "../service/manager.js";
import { readServiceMetadata } from "../service/metadata.js";
import { readJsonObjectFile, validateHostConfigRaw } from "../config/index.js";

export async function runServiceCommand(args: CliArguments, io: CliIo): Promise<number> {
  const action = args.positionals[1] ?? "status";
  if (!["status", "install", "start", "stop", "restart", "uninstall"].includes(action))
    throw new Error("Usage: homebase service status|install|start|stop|restart|uninstall");
  if (action === "status") {
    const context = cliPaths(args);
    const manager = createServiceManager();
    const metadata = await readServiceMetadata(context.stateDir).catch(() => {
      io.out("! Service metadata is corrupt; native state is still authoritative. Run `homebase doctor`.");
      return null;
    });
    const configPath = metadata?.configPath ?? context.configPath;
    const config = await readJsonObjectFile(configPath)
      .then(validateHostConfigRaw)
      .catch(() => null);
    if (!(await manager.isAvailable())) {
      io.out("! Homebase user service manager unavailable. Run `homebase` manually.");
      return 0;
    }
    const state = await manager.inspect();
    const health = config ? await readHealth(config.host.port) : null;
    const names = {
      "windows-task": "Windows Task Scheduler",
      launchd: "macOS LaunchAgent",
      "systemd-user": "systemd user service",
      unsupported: "Unsupported",
    };
    io.out(
      `Homebase service\n\nPlatform: ${names[manager.kind]}\nInstalled: ${state.installed ? "yes" : "no"}\nAutostart: ${state.enabled ? "yes" : "no"}\nRunning: ${state.running ? "yes" : "no"}\nHost: ${health ? "healthy" : "unreachable or incompatible"}\nCLI version: ${HOST_VERSION}\nInstalled version: ${metadata?.homebaseVersion ?? "unknown"}\nRunning version: ${health?.version ?? "unknown"}\nAddress: ${config ? `${config.host.bindAddress}:${config.host.port}` : "unknown (configuration unavailable)"}\nConfig: ${configPath}\nLogs: ${manager.logSource.replace("<state-dir>", context.stateDir)}${state.warning ? `\nTask: ${state.warning}` : ""}`,
    );
    if ((health && health.version !== HOST_VERSION) || (metadata && metadata.homebaseVersion !== HOST_VERSION))
      io.out("! Service/CLI versions differ. Run `homebase upgrade` or `homebase setup`.");
    return 0;
  }
  const { controller } = await serviceContext(args, action === "install");
  io.out(
    `${action === "install" ? "Installing" : action === "uninstall" ? "Removing" : action === "restart" ? "Restarting" : action === "stop" ? "Stopping" : "Starting"} Homebase...`,
  );
  await controller[action as "install" | "start" | "stop" | "restart" | "uninstall"]();
  io.out(
    action === "start" || action === "restart"
      ? "✓ Host healthy"
      : action === "install"
        ? "✓ Homebase service installed; run `homebase service start`."
        : action === "uninstall"
          ? "✓ Homebase service removed. State preserved."
          : "✓ Homebase service stopped",
  );
  return 0;
}
