#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import qrcode from "qrcode-terminal";

import { configSummary, loadConfig } from "./config/index.js";
import { createHostRuntime } from "./server.js";
import { HOST_VERSION } from "./version.js";
import { detectServeUrl, validatePairUrl } from "./remote.js";

const USAGE = `
Homebase Host ${HOST_VERSION}

Usage: homebase [options]
       homebase pair [--url https://machine.tailnet.ts.net]
       homebase devices
       homebase revoke <device-id>

Options:
  --config <path>   Path to homebase.config.json (default: ./homebase.config.json)
  --port <port>     Override host.port
  --bind <address>  Override host.bindAddress (non-loopback binds require auth)
  -h, --help        Show this help
  --url <origin>    Explicit HTTPS origin for pair

Environment:
  HOMEBASE_CONFIG, HOMEBASE_PORT, HOMEBASE_BIND_ADDRESS,
  HOMEBASE_LOG_LEVEL, HOMEBASE_DEV_TOKEN, HOMEBASE_PROJECT_ROOTS, HOMEBASE_STATE_DIR
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: "string" },
      port: { type: "string" },
      bind: { type: "string" },
      help: { type: "boolean", short: "h" },
      url: { type: "string" },
    },
    allowPositionals: true,
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

  if (positionals.length > 0) {
    await localCommand(positionals, config.host.port, values.url);
    return;
  }

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

async function localCommand(args: string[], port: number, explicitUrl?: string): Promise<void> {
  const command = args[0];
  if (!["pair", "devices", "revoke"].includes(command ?? "") || (command === "revoke" && !args[1]))
    throw new Error("Unknown or incomplete command. Run homebase --help.");
  const directory = process.env.HOMEBASE_STATE_DIR ?? path.join(os.homedir(), ".homebase");
  const key = (await readFile(path.join(directory, "admin-key"), "utf8")).trim();
  const adminCall = (endpoint: string, method: string) =>
    fetch(`http://127.0.0.1:${port}${endpoint}`, { method, headers: { "x-homebase-admin": key } });
  let revokeId = args[1];
  if (command === "revoke") {
    const listing = await adminCall("/api/v1/admin/devices", "GET");
    if (!listing.ok) throw new Error("Could not list devices from the local Host.");
    const listed = (await listing.json()) as { devices: Array<{ id: string }> };
    const matches = listed.devices.filter(
      (device) => device.id === revokeId || ((revokeId?.length ?? 0) >= 8 && device.id.startsWith(revokeId!)),
    );
    if (matches.length !== 1)
      throw new Error("Device id is missing or ambiguous. Run `homebase devices` and use its short or full id.");
    revokeId = matches[0]!.id;
  }
  const endpoint =
    command === "pair"
      ? "/api/v1/admin/pair"
      : command === "devices"
        ? "/api/v1/admin/devices"
        : `/api/v1/admin/devices/${encodeURIComponent(revokeId!)}`;
  const method = command === "devices" ? "GET" : command === "revoke" ? "DELETE" : "POST";
  const response = await adminCall(endpoint, method);
  if (!response.ok)
    throw new Error(
      `Local Host command failed (${response.status}). Is Homebase running with device auth on port ${port}?`,
    );
  const body = (await response.json()) as {
    token?: string;
    expiresAt?: string;
    devices?: Array<{
      id: string;
      name: string;
      createdAt: string;
      revokedAt: string | null;
      lastSeenAt: string | null;
    }>;
    device?: { id: string; name: string };
  };
  if (command === "devices") {
    for (const device of body.devices ?? [])
      console.log(
        `${device.id.slice(0, 8)}  ${device.name}  ${device.revokedAt ? "revoked" : "active"}  paired ${device.createdAt}  last seen ${device.lastSeenAt ?? "never"}`,
      );
  } else if (command === "revoke") {
    console.log(`Revoked ${body.device?.name} (${body.device?.id}).`);
  } else {
    const origin = explicitUrl ? validatePairUrl(explicitUrl) : await detectServeUrl(port);
    if (!origin)
      throw new Error(
        "No unambiguous private Tailscale Serve URL found. Run `tailscale serve --bg 8787`, then `homebase pair --url https://your-machine.your-tailnet.ts.net`.",
      );
    const url = `${origin}/pair#${body.token}`;
    console.log(`Pairing invitation expires ${body.expiresAt}. Scan on your device:\n${url}`);
    qrcode.generate(url, { small: true });
  }
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
