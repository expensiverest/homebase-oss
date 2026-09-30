import { definitionsEqual } from "./diagnostics.js";
import type { ServiceDefinition, ServiceInspection, ServiceManager } from "../service/types.js";
import type { CliIo } from "../cli/io.js";
export async function upgradeService(options: {
  current: ServiceDefinition;
  installed: ServiceDefinition | null;
  manager: ServiceManager;
  service: { install(): Promise<void>; restart(): Promise<void> };
  io: CliIo;
}): Promise<void> {
  options.io.out(
    "This is a pre-alpha source installation. Fetching new source remains manual:\n  git pull\n  npm install\n  npm run build\nThen run:\n  homebase upgrade\n",
  );
  const state: ServiceInspection = await options.manager.inspect();
  if (!state.installed) {
    options.io.out("No background service installed. Run `homebase setup`.");
    return;
  }
  if (
    options.installed &&
    state.enabled &&
    definitionsEqual(options.installed, options.current) &&
    options.manager.matches(state, options.current)
  ) {
    options.io.out("✓ Service definition is current.");
    return;
  }
  options.io.out("Refreshing the service to this CLI...");
  const nativeCurrent = options.manager.matches(state, options.current) && state.enabled;
  await options.service.install();
  // Installation restores a running service only when its native definition changed.
  // Metadata-only repair leaves a correct running Host uninterrupted.
  if (
    !state.running ||
    (nativeCurrent && options.installed && options.installed.homebaseVersion !== options.current.homebaseVersion)
  )
    await options.service.restart();
  options.io.out("✓ Service refreshed; Host version verified.");
}
