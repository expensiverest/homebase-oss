import { createConsoleLogger } from "@homebase/adapter-sdk";
import type { AgentProvider } from "@homebase/protocol";
import type { HostConfig } from "../config/index.js";
import { EventBus } from "../events/index.js";
import { ProviderRegistry } from "../providers/index.js";
import { createDefaultRegistrations } from "../server.js";
import { HOST_VERSION } from "../version.js";

/** Adapter probes only. No sessions/catalog prompts; always dispose temporary children. */
export async function detectProviders(config: HostConfig): Promise<AgentProvider[]> {
  const registry = new ProviderRegistry({
    config,
    bus: new EventBus(),
    hostVersion: HOST_VERSION,
    logger: createConsoleLogger("setup", { level: "error", sink: { debug() {}, info() {}, warn() {}, error() {} } }),
    resolveProjectPath: async () => {
      throw new Error("Setup cannot start a session.");
    },
    findProjectByPath: async () => null,
    resolveAttachment: async () => {
      throw new Error("No setup attachments.");
    },
  });
  for (const registration of createDefaultRegistrations())
    if (registration.id !== "mock") registry.register(registration);
  const interrupted = () => {
    void registry.dispose();
  };
  process.once("SIGINT", interrupted);
  try {
    await registry.initialize();
    return registry.listProviders();
  } finally {
    process.removeListener("SIGINT", interrupted);
    await registry.dispose();
  }
}
