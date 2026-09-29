import { readFile } from "node:fs/promises";
import path from "node:path";

import qrcode from "qrcode-terminal";

import { resolveStateDir } from "../config/index.js";
import { detectServeUrl, validatePairUrl } from "../remote.js";
import type { CliIo } from "./io.js";

interface AdminClientOptions {
  port: number;
  stateDir?: string;
}

/**
 * Loopback-only admin client used by local commands. It authenticates with the
 * machine-local admin key from the Homebase state directory; the key is never
 * printed and never leaves the machine.
 */
class AdminClient {
  readonly #port: number;
  readonly #keyPath: string;

  constructor(options: AdminClientOptions) {
    this.#port = options.port;
    this.#keyPath = path.join(options.stateDir ?? resolveStateDir(), "admin-key");
  }

  async call(endpoint: string, method: string): Promise<Response> {
    let key: string;
    try {
      key = (await readFile(this.#keyPath, "utf8")).trim();
    } catch {
      throw new Error(
        `Homebase local admin key not found at ${this.#keyPath}. Start Homebase once with device auth enabled to create it.`,
      );
    }
    try {
      return await fetch(`http://127.0.0.1:${this.#port}${endpoint}`, {
        method,
        headers: { "x-homebase-admin": key },
      });
    } catch {
      throw new Error(
        `Could not reach Homebase on 127.0.0.1:${this.#port}. Start Homebase (run \`homebase\`) and try again.`,
      );
    }
  }
}

export interface PairOptions {
  port: number;
  stateDir?: string;
  /** Explicit HTTPS origin; otherwise Homebase detects a Tailscale Serve URL. */
  url?: string;
}

export async function runPairCommand(io: CliIo, options: PairOptions): Promise<void> {
  const client = new AdminClient(options);
  const response = await client.call("/api/v1/admin/pair", "POST");
  if (!response.ok) {
    throw new Error(`Local Host command failed (${response.status}). Is Homebase running on port ${options.port}?`);
  }
  const body = (await response.json()) as { token: string; expiresAt: string };
  const origin = options.url ? validatePairUrl(options.url) : await detectServeUrl(options.port);
  if (!origin) {
    throw new Error(
      "No unambiguous private Tailscale Serve URL found. Run `tailscale serve --bg 8787`, then `homebase pair --url https://your-machine.your-tailnet.ts.net`.",
    );
  }
  const url = `${origin}/pair#${body.token}`;
  io.out(`Pairing invitation expires ${body.expiresAt}. Scan on your device:\n${url}`);
  qrcode.generate(url, { small: true }, (code) => io.out(code));
}

interface DeviceListing {
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
}

export async function runDevicesCommand(io: CliIo, options: { port: number; stateDir?: string }): Promise<void> {
  const client = new AdminClient(options);
  const response = await client.call("/api/v1/admin/devices", "GET");
  if (!response.ok) {
    throw new Error(`Local Host command failed (${response.status}). Is Homebase running on port ${options.port}?`);
  }
  const body = (await response.json()) as { devices?: DeviceListing[] };
  const devices = body.devices ?? [];
  if (devices.length === 0) {
    io.out("No devices paired.");
    return;
  }
  for (const device of devices) {
    io.out(
      `${device.id.slice(0, 8)}  ${device.name}  ${device.revokedAt ? "revoked" : "active"}  paired ${device.createdAt}  last seen ${device.lastSeenAt ?? "never"}`,
    );
  }
}

export async function runRevokeCommand(
  io: CliIo,
  options: { port: number; stateDir?: string; deviceId: string },
): Promise<void> {
  const client = new AdminClient(options);
  let revokeId = options.deviceId;
  const listing = await client.call("/api/v1/admin/devices", "GET");
  if (!listing.ok) throw new Error("Could not list devices from the local Host.");
  const listed = (await listing.json()) as { devices?: DeviceListing[] };
  const matches = (listed.devices ?? []).filter(
    (device) => device.id === revokeId || (revokeId.length >= 8 && device.id.startsWith(revokeId)),
  );
  if (matches.length !== 1) {
    throw new Error("Device id is missing or ambiguous. Run `homebase devices` and use its short or full id.");
  }
  revokeId = matches[0]!.id;
  const response = await client.call(`/api/v1/admin/devices/${encodeURIComponent(revokeId)}`, "DELETE");
  if (!response.ok) {
    throw new Error(`Local Host command failed (${response.status}). Is Homebase running on port ${options.port}?`);
  }
  const body = (await response.json()) as { device?: { id: string; name: string } };
  io.out(`Revoked ${body.device?.name ?? revokeId} (${body.device?.id ?? revokeId}).`);
}
