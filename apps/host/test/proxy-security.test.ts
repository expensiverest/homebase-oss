import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestHost, type TestHost } from "./helpers/host-fixture.js";

const hosts: TestHost[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.cleanup();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "hb-proxy-"));
  dirs.push(dir);
  const host = await createTestHost({ config: { auth: { mode: "device" } }, stateDir: dir });
  hosts.push(host);
  const address = await host.runtime.start();
  const base = `http://127.0.0.1:${address.port}`;
  const adminKey = host.runtime.devices!.adminKey;
  const admin = (headers: Record<string, string> = {}) =>
    fetch(`${base}/api/v1/admin/pair`, { method: "POST", headers: { "x-homebase-admin": adminKey, ...headers } });
  const proxyHeaders = {
    host: "machine.example.ts.net",
    origin: "https://machine.example.ts.net",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "machine.example.ts.net",
    "sec-fetch-site": "same-origin",
    "x-homebase-client": "1",
  };
  return { host, base, admin, proxyHeaders };
}

describe("loopback reverse proxy security", () => {
  it("pairs and accepts authenticated mutations through a simulated Tailscale HTTPS proxy", async () => {
    const { base, admin, proxyHeaders } = await fixture();
    const invitation = (await (await admin()).json()) as { token: string };
    const paired = await fetch(`${base}/api/v1/pairing/redeem`, {
      method: "POST",
      headers: { ...proxyHeaders, "content-type": "application/json" },
      body: JSON.stringify({ credential: invitation.token, name: "Test Phone" }),
    });
    expect(paired.status).toBe(201);
    const cookie = paired.headers.get("set-cookie")!.split(";")[0]!;
    const refreshed = await fetch(`${base}/api/v1/providers/refresh`, {
      method: "POST",
      headers: { ...proxyHeaders, cookie },
    });
    expect(refreshed.status).toBe(200);
    const direct = await fetch(`${base}/api/v1/providers/refresh`, {
      method: "POST",
      headers: { origin: base, "sec-fetch-site": "same-origin", "x-homebase-client": "1", cookie },
    });
    expect(direct.status).toBe(200);
  });

  it("rejects wrong browser origins and malformed trusted forwarding headers", async () => {
    const { base, admin, proxyHeaders } = await fixture();
    const invitation = (await (await admin()).json()) as { token: string };
    const request = (headers: Record<string, string>) =>
      fetch(`${base}/api/v1/pairing/redeem`, {
        method: "POST",
        headers: { ...proxyHeaders, "content-type": "application/json", ...headers },
        body: JSON.stringify({ credential: invitation.token, name: "Test Phone" }),
      });
    expect((await request({ origin: "https://evil.example" })).status).toBe(403);
    for (const value of ["https,http", "javascript"])
      expect((await request({ "x-forwarded-proto": value })).status).toBe(403);
    for (const value of ["good.ts.net,evil.example", "https://evil.example", "good.ts.net/evil"])
      expect((await request({ "x-forwarded-host": value })).status).toBe(403);
    expect((await request({ "x-forwarded-host": "" })).status).toBe(403);
  });

  it("rejects proxied and browser admin requests even with the valid local key", async () => {
    const { base, admin } = await fixture();
    expect((await admin()).status).toBe(201);
    expect((await admin({ "x-forwarded-proto": "https", "x-forwarded-host": "machine.ts.net" })).status).toBe(401);
    expect((await admin({ "x-forwarded-for": "127.0.0.1" })).status).toBe(401);
    expect((await admin({ forwarded: "proto=https;host=machine.ts.net" })).status).toBe(401);
    expect((await admin({ origin: "https://machine.ts.net" })).status).toBe(403);
    expect(
      (
        await fetch(`${base}/api/v1/admin/pair`, {
          method: "POST",
          headers: { "x-homebase-admin": "invalid" },
        })
      ).status,
    ).toBe(401);
  });
});
