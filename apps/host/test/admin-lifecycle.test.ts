import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTestHost, type TestHost } from "./helpers/host-fixture.js";
import { defaultMockRegistration } from "./helpers/host-fixture.js";
import { waitUntil } from "../src/service/health.js";
let host: TestHost;
let dir: string;
let base: string;
const disposed = vi.fn();
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "hb-admin-lifecycle-"));
  await mkdir(path.join(dir, "state"));
  const registration = defaultMockRegistration();
  const create = registration.create;
  registration.create = (config) => {
    const adapter = create(config);
    const original = adapter.dispose?.bind(adapter);
    adapter.dispose = async () => {
      disposed();
      await original?.();
    };
    return adapter;
  };
  host = await createTestHost({
    stateDir: path.join(dir, "state"),
    config: { auth: { mode: "device" } },
    registrations: [registration],
  });
  const address = await host.runtime.start();
  base = `http://127.0.0.1:${address.port}`;
  disposed.mockClear();
});
afterEach(async () => {
  await host.cleanup();
  await rm(dir, { recursive: true, force: true });
});
function request(endpoint: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/v1/admin/${endpoint}`, {
    method: endpoint === "shutdown" ? "POST" : "GET",
    headers: { "x-homebase-admin": host.runtime.devices!.adminKey, ...headers },
  });
}
describe("local admin lifecycle security", () => {
  it("safe local status has counts and provider status, no secrets/transcripts/paths", async () => {
    const response = await request("status");
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({
      projects: { count: 3 },
      devices: { total: 0, active: 0 },
      config: { authMode: "device" },
    });
    expect(text).not.toContain(host.runtime.devices!.adminKey);
    expect(text).not.toContain(host.rootDir);
    expect(text).not.toMatch(/transcript|session|digest|cookie/i);
  });
  it.each(["status", "shutdown"])("rejects browser Origin for %s", async (endpoint) => {
    expect([401, 403]).toContain((await request(endpoint, { origin: base })).status);
    expect(disposed).not.toHaveBeenCalled();
  });
  it.each(["status", "shutdown"])("rejects invalid admin key for %s", async (endpoint) => {
    expect((await request(endpoint, { "x-homebase-admin": "bad" })).status).toBe(401);
    expect(disposed).not.toHaveBeenCalled();
  });
  it.each(["status", "shutdown"])("rejects proxy headers even with valid key for %s", async (endpoint) => {
    const cases: Record<string, string>[] = [
      { "x-forwarded-proto": "https", "x-forwarded-host": "fixture.ts.net" },
      { forwarded: "proto=https" },
      { "x-forwarded-for": "127.0.0.1" },
    ];
    for (const headers of cases) expect([401, 403]).toContain((await request(endpoint, headers)).status);
    expect(disposed).not.toHaveBeenCalled();
  });
  it.each(["status", "shutdown"])("rejects non-loopback actual socket peer for %s", async (endpoint) => {
    const response = await host.runtime.app.request(
      `${base}/api/v1/admin/${endpoint}`,
      {
        method: endpoint === "shutdown" ? "POST" : "GET",
        headers: { "x-homebase-admin": host.runtime.devices!.adminKey },
      },
      { incoming: { socket: { remoteAddress: "192.0.2.1" } } },
    );
    expect(response.status).toBe(401);
    expect(disposed).not.toHaveBeenCalled();
  });
  it.each(["status", "shutdown"])("paired device cannot invoke %s", async (endpoint) => {
    const device = await host.runtime.devices!.add("Fixture phone");
    const response = await fetch(`${base}/api/v1/admin/${endpoint}`, {
      method: endpoint === "shutdown" ? "POST" : "GET",
      headers: { cookie: `__Host-homebase-device=${device.credential}`, "x-homebase-client": "1" },
    });
    expect(response.status).toBe(401);
    expect(disposed).not.toHaveBeenCalled();
  });
  it("flushes 202 before runtime shutdown, disposes providers, and closes real HTTP", async () => {
    const response = await request("shutdown");
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    await host.runtime.closed;
    expect(disposed).toHaveBeenCalledOnce();
    expect(
      await waitUntil(async () => {
        try {
          await fetch(`${base}/api/v1/health`);
          return false;
        } catch {
          return true;
        }
      }, 1000),
    ).toBe(true);
  });
});
