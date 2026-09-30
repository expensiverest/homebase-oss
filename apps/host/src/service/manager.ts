import { WindowsTaskServiceManager } from "./windows.js";
import { LaunchdServiceManager } from "./launchd.js";
import { SystemdUserServiceManager } from "./systemd.js";
import type { ManagerOptions, ServiceManager } from "./types.js";
export function createServiceManager(
  platform: NodeJS.Platform = process.platform,
  options: ManagerOptions = {},
): ServiceManager {
  if (platform === "win32") return new WindowsTaskServiceManager(options);
  if (platform === "darwin") return new LaunchdServiceManager(options);
  if (platform === "linux") return new SystemdUserServiceManager(options);
  return {
    kind: "unsupported",
    identifier: "",
    logSource: "foreground terminal",
    isAvailable: async () => false,
    inspect: async () => ({ installed: false, enabled: false, running: false }),
    install: async () => {
      throw new Error("Background services are unavailable on this platform. Run `homebase` manually.");
    },
    start: async () => {
      throw new Error("No background service manager available.");
    },
    stop: async () => undefined,
    uninstall: async () => undefined,
    matches: () => false,
  };
}
