#!/usr/bin/env node
import { parseArgs } from "node:util";

import { configSummary, loadConfig } from "./config/index.js";
import { createHostRuntime } from "./server.js";
import { HOST_VERSION } from "./version.js";

const USAGE = `
Homebase Host ${HOST_VERSION}

Usage: homebase [options]

Options:
  --config <path>   Path to homebase.config.json (default: ./homebase.config.json)
  --port <port>     Override host.port
  --bind <address>  Override host.bindAddress (non-loopback binds require auth)
  -h, --help        Show this help

Environment:
  HOMEBASE_CONFIG, HOMEBASE_PORT, HOMEBASE_BIND_ADDRESS,
  HOMEBASE_LOG_LEVEL, HOMEBASE_DEV_TOKEN, HOMEBASE_PROJECT_ROOTS
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      port: { type: "string" },
      bind: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(USAGE.trim());
    return;
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (values.port) env.HOMEBASE_PORT = values.port;
  if (values.bind) env.HOMEBASE_BIND_ADDRESS = values.bind;

  const config = await loadConfig({
    ...(values.config !== undefined ? { configPath: values.config } : {}),
    env,
  });

  const runtime = await createHostRuntime({ config });
  const address = await runtime.start();

  const displayHost = address.hostname.includes(":") ? `[${address.hostname}]` : address.hostname;
  const baseUrl = `http://${displayHost}:${address.port}`;
  console.log(`Homebase Host ${HOST_VERSION} listening on ${baseUrl}`);
  console.log(`Config: ${JSON.stringify(configSummary(config))}`);

  const providers = runtime.providers.listProviders();
  for (const provider of providers) {
    const state = provider.installed ? (provider.compatible ? "ready" : "incompatible") : "not installed";
    console.log(`Provider ${provider.id}: ${state}${provider.version ? ` (${provider.version})` : ""}`);
  }
  console.log(`Projects: ${runtime.projects.list().length}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Homebase Host failed to start: ${message}`);
  if (error instanceof Error && "issues" in error && Array.isArray((error as { issues: unknown[] }).issues)) {
    for (const issue of (error as { issues: string[] }).issues) {
      console.error(`  - ${issue}`);
    }
  }
  process.exitCode = 1;
});
