import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceState } from "../src/auth/index.js";
import { createTestHost, type TestHost } from "./helpers/host-fixture.js";

const dirs: string[] = [];
const hosts: TestHost[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) await host.cleanup();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function stateDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "hb-security-"));
  dirs.push(dir);
  return dir;
}
async function host(dir: string) {
  const result = await createTestHost({ config: { auth: { mode: "device" } }, stateDir: dir });
  hosts.push(result);
  return result;
}
const clientHeaders = { "x-homebase-client": "1", "content-type": "application/json" };

describe("device security", () => {
  it("uses one-time random invitations, expires them, and throttles invalid redemption", async () => {
    const dir = await stateDir();
    const runtime = await host(dir);
    const auth = runtime.runtime.auth;
    const first = auth.createInvitation();
    const second = auth.createInvitation();
    expect(first.token).not.toBe(second.token);
    expect(first.token).toMatch(/^hbpair1\.[A-Za-z0-9_-]{43}$/);
    expect((await auth.redeem(first.token, "Phone", "one")).status).toBe("invalid");
    const results = await Promise.all([
      auth.redeem(second.token, "Phone 1", "two"),
      auth.redeem(second.token, "Phone 2", "three"),
    ]);
    expect(results.filter((item) => item.status === "ok")).toHaveLength(1);
    expect(results.filter((item) => item.status === "used")).toHaveLength(1);
    expect(await readFile(path.join(dir, "security.json"), "utf8")).not.toContain(second.token);
    vi.useFakeTimers();
    const third = auth.createInvitation();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect((await auth.redeem(third.token, "Phone", "four")).status).toBe("expired");
    for (let i = 0; i < 9; i++) await auth.redeem("invalid", "Phone", "attacker");
    expect((await auth.redeem("invalid", "Phone", "attacker")).status).toBe("rate_limited");
    const owner = auth.createInvitation();
    expect((await auth.redeem(owner.token, "Owner phone", "attacker")).status).toBe("ok");
  });
  it("creates private versioned state and fails closed on corruption", async () => {
    const dir = await stateDir();
    const state = await DeviceState.open(dir);
    expect(state.list()).toEqual([]);
    await Promise.all([state.add("Phone"), state.add("Tablet")]);
    const file = path.join(dir, "security.json");
    expect(JSON.parse(await readFile(file, "utf8")).devices).toHaveLength(2);
    if (process.platform !== "win32") {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect((await stat(path.join(dir, "admin-key"))).mode & 0o777).toBe(0o600);
    }
    await writeFile(file, "{broken");
    await expect(DeviceState.open(dir)).rejects.toThrow("Refusing startup");
    await writeFile(file, JSON.stringify({ version: 2, devices: [] }));
    await expect(DeviceState.open(dir)).rejects.toThrow("Refusing startup");
  });

  it("pairs once, authenticates after restart, and rejects a revoked credential after another restart", async () => {
    const dir = await stateDir();
    const first = await host(dir);
    const app = first.runtime.app;
    expect((await app.request("/api/v1/projects")).status).toBe(401);
    const status = await app.request("/api/v1/auth/status");
    expect(await status.json()).toEqual({ mode: "device", authenticated: false });
    expect((await app.request("/api/v1/sessions/claude:child-session")).status).toBe(401);
    expect((await app.request("/api/v1/events")).status).toBe(401);
    expect((await app.request("/api/v1/admin/pair", { method: "POST" })).status).toBe(401);
    const admin = first.runtime.devices!.adminKey;
    const inviteResponse = await app.request("/api/v1/admin/pair", {
      method: "POST",
      headers: { "x-homebase-admin": admin },
    });
    expect(inviteResponse.status).toBe(201);
    const invitation = (await inviteResponse.json()) as { token: string };
    const crossSite = await app.request("/api/v1/pairing/redeem", {
      method: "POST",
      headers: { ...clientHeaders, origin: "https://evil.example" },
      body: JSON.stringify({ credential: invitation.token, name: "Phone" }),
    });
    expect(crossSite.status).toBe(403);
    const redeem = await app.request("/api/v1/pairing/redeem", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ credential: invitation.token, name: "Phone" }),
    });
    expect(redeem.status).toBe(201);
    const cookie = redeem.headers.get("set-cookie")!;
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    const credential = cookie.split(";")[0]!;
    const metadata = await redeem.text();
    expect(metadata).not.toContain("hbdev1.");
    expect(await readFile(path.join(dir, "security.json"), "utf8")).not.toContain("hbdev1.");
    const duplicate = await app.request("/api/v1/pairing/redeem", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ credential: invitation.token, name: "Phone" }),
    });
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe("pairing_used");
    expect((await app.request("/api/v1/projects", { headers: { cookie: credential } })).status).toBe(200);
    const missingClientHeader = await app.request("/api/v1/providers/refresh", {
      method: "POST",
      headers: { cookie: credential },
    });
    expect(missingClientHeader.status).toBe(403);
    const wrongSecret = credential.slice(0, -1) + (credential.endsWith("A") ? "B" : "A");
    expect((await app.request("/api/v1/projects", { headers: { cookie: wrongSecret } })).status).toBe(401);
    await first.cleanup();
    hosts.splice(hosts.indexOf(first), 1);
    const second = await host(dir);
    expect((await second.runtime.app.request("/api/v1/projects", { headers: { cookie: credential } })).status).toBe(
      200,
    );
    const device = second.runtime.devices!.list()[0]!;
    const renamed = await second.runtime.app.request(`/api/v1/devices/${device.id}`, {
      method: "PATCH",
      headers: { ...clientHeaders, cookie: credential },
      body: JSON.stringify({ name: "New phone" }),
    });
    expect(renamed.status).toBe(200);
    const stream = await second.runtime.app.request("/api/v1/events", { headers: { cookie: credential } });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    await reader.read(); // initial retry/ready chunk
    const revoked = await second.runtime.app.request(`/api/v1/devices/${device.id}`, {
      method: "DELETE",
      headers: { ...clientHeaders, cookie: credential },
    });
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get("set-cookie")).toContain("Max-Age=0");
    let done = false;
    let received = "";
    for (let i = 0; i < 5 && !done; i++) {
      const next = await reader.read();
      done = next.done;
      if (next.value) received += new TextDecoder().decode(next.value);
    }
    expect(done).toBe(true);
    expect(received).toContain("auth.revoked");
    expect((await second.runtime.app.request("/api/v1/projects", { headers: { cookie: credential } })).status).toBe(
      401,
    );
    const freshInvitation = await second.runtime.app.request("/api/v1/admin/pair", {
      method: "POST",
      headers: { "x-homebase-admin": second.runtime.devices!.adminKey },
    });
    const freshToken = ((await freshInvitation.json()) as { token: string }).token;
    const repaired = await second.runtime.app.request("/api/v1/pairing/redeem", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ credential: freshToken, name: "Replacement phone" }),
    });
    expect(repaired.status).toBe(201);
    const replacementCookie = repaired.headers.get("set-cookie")!.split(";")[0]!;
    const replacementStream = await second.runtime.app.request("/api/v1/events", {
      headers: { cookie: replacementCookie },
    });
    expect(replacementStream.status).toBe(200);
    const replacementId = ((await repaired.clone().json()) as { device: { id: string } }).device.id;
    await second.runtime.app.request(`/api/v1/devices/${replacementId}`, {
      method: "DELETE",
      headers: { ...clientHeaders, cookie: replacementCookie },
    });
    await second.cleanup();
    hosts.splice(hosts.indexOf(second), 1);
    const third = await host(dir);
    expect((await third.runtime.app.request("/api/v1/projects", { headers: { cookie: credential } })).status).toBe(401);
  });
});
