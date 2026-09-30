import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { runExecutable, spawnExecutable, type AgentAdapter, type AdapterRegistration } from "@homebase/adapter-sdk";
import { OpenCodeAdapter } from "@homebase/adapter-opencode";
import { MockAdapter } from "@homebase/adapter-sdk/testing";
import { createTestHost, defaultMockRegistration, type TestHost } from "./helpers/host-fixture.js";
import { waitUntil } from "../src/service/health.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let host: TestHost | undefined;
let state: string;
let release = () => {};
afterEach(async () => {
  release();
  if (host) {
    // Cleanup errors are asserted explicitly in the failure test.
    await host.runtime.close().catch(() => undefined);
    await rm(host.rootDir, { recursive: true, force: true });
  }
  if (state) await rm(state, { recursive: true, force: true });
  host = undefined;
});
async function start(registration: AdapterRegistration, additional: AdapterRegistration[] = []) {
  state = await mkdtemp(path.join(os.tmpdir(), "hb-shutdown-regression-"));
  host = await createTestHost({
    stateDir: state,
    config: { auth: { mode: "device" } },
    registrations: [registration, ...additional],
  });
  const address = await host.runtime.start();
  const base = `http://127.0.0.1:${address.port}`;
  const device = await host.runtime.devices!.add("Fixture phone");
  const headers = { cookie: `__Host-homebase-device=${device.credential}`, "x-homebase-client": "1" };
  const shutdown = async () => {
    const response = await fetch(`${base}/api/v1/admin/shutdown`, {
      method: "POST",
      headers: { "x-homebase-admin": host!.runtime.devices!.adminKey },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
  };
  return { base, headers, shutdown };
}
describe("HTTP quiescence before provider disposal", () => {
  it("fully flushes 202, closes the listener before slow disposal, and rejects late adapter calls", async () => {
    const gate = deferred();
    const begun = deferred();
    release = gate.resolve;
    const registration = defaultMockRegistration();
    const create = registration.create;
    let adapter!: AgentAdapter;
    registration.create = (config) => {
      adapter = create(config);
      const dispose = adapter.dispose?.bind(adapter);
      adapter.dispose = async () => {
        begun.resolve();
        await gate.promise;
        await dispose?.();
      };
      return adapter;
    };
    const f = await start(registration);
    const list = vi.spyOn(adapter, "listSessions");
    const detect = vi.spyOn(adapter, "detect");
    await f.shutdown();
    await begun.promise;
    // This fails on the previous ordering: the listener remained alive during dispose.
    await expect(
      fetch(`${f.base}/api/v1/projects/${host!.runtime.projects.list()[0]!.id}/sessions`, {
        headers: f.headers,
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toThrow();
    expect(
      (await host!.runtime.app.request("/api/v1/providers/refresh", { method: "POST", headers: f.headers })).status,
    ).toBe(503);
    expect(list).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
    await expect(host!.runtime.providers.refresh()).rejects.toThrow("shutting down");
    gate.resolve();
    await host!.runtime.closed;
    await expect(fetch(`${f.base}/api/v1/health`)).rejects.toThrow();
    await expect(host!.runtime.start()).rejects.toThrow("shutting down");
  });
  it("terminates a real SSE connection without hanging shutdown or truncating admin 202", async () => {
    const f = await start(defaultMockRegistration());
    const response = await fetch(`${f.base}/api/v1/events`, { headers: f.headers });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    const ended = (async () => {
      try {
        while (!(await reader.read()).done) {
          /* drain */
        }
      } catch {
        /* socket destroyed */
      }
    })();
    await f.shutdown();
    await host!.runtime.closed;
    await ended;
    await expect(fetch(`${f.base}/api/v1/health`)).rejects.toThrow();
  });
  it("does not advance an already suspended session-list request to another provider after shutdown", async () => {
    const listing = deferred();
    const listBegun = deferred();
    const disposal = deferred();
    const disposeBegun = deferred();
    release = () => {
      listing.resolve();
      disposal.resolve();
    };
    const first: AgentAdapter = new MockAdapter();
    first.listSessions = async () => {
      listBegun.resolve();
      await listing.promise;
      return { items: [], nextCursor: null, previousCursor: null };
    };
    first.dispose = async () => {
      disposeBegun.resolve();
      await disposal.promise;
    };
    const second = new MockAdapter({ id: "second" });
    const next = vi.spyOn(second, "listSessions");
    const f = await start({ id: "mock", displayName: "First fixture", create: () => first }, [
      { id: "second", displayName: "Second fixture", create: () => second },
    ]);
    const pending = fetch(`${f.base}/api/v1/projects/${host!.runtime.projects.list()[0]!.id}/sessions`, {
      headers: f.headers,
    }).catch(() => null);
    await listBegun.promise;
    await f.shutdown();
    await disposeBegun.promise;
    // Closing a socket doesn't cancel a suspended JavaScript continuation.
    listing.resolve();
    await pending;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(next).not.toHaveBeenCalled();
    disposal.resolve();
    await host!.runtime.closed;
  });
  it("disposes managed OpenCode with no opportunity for a late request to respawn it", async () => {
    const fixture = fileURLToPath(
      new URL("../../../packages/adapter-opencode/test/fixtures/fake-opencode.mjs", import.meta.url),
    );
    const children: ChildProcess[] = [];
    const gate = deferred();
    const begun = deferred();
    release = gate.resolve;
    const adapter = new OpenCodeAdapter({
      config: { serverMode: "managed", managedPort: 0, shutdownTimeoutMs: 1000 },
      startEventStream: false,
      runFn: (_command, args, options) => runExecutable(process.execPath, [fixture, ...args], options),
      spawnFn: (_command, args, options) => {
        const child = spawnExecutable(process.execPath, [fixture, ...args], options);
        children.push(child);
        return child;
      },
    });
    const original = adapter.dispose.bind(adapter);
    adapter.dispose = async () => {
      begun.resolve();
      await gate.promise;
      await original();
    };
    const f = await start({ id: "opencode", displayName: "OpenCode", create: () => adapter });
    expect(host!.runtime.providers.getProvider("opencode").installed).toBe(true);
    expect(children).toHaveLength(1);
    const detect = vi.spyOn(adapter, "detect");
    await f.shutdown();
    await begun.promise;
    await expect(fetch(`${f.base}/api/v1/providers/refresh`, { method: "POST", headers: f.headers })).rejects.toThrow();
    expect(detect).not.toHaveBeenCalled();
    gate.resolve();
    await host!.runtime.closed;
    expect(children).toHaveLength(1);
    expect(
      await waitUntil(
        async () => children.every((child) => child.exitCode !== null || child.signalCode !== null),
        3000,
      ),
    ).toBe(true);
  });
  it("attempts attachments cleanup and settles closed even when provider cleanup throws", async () => {
    const f = await start(defaultMockRegistration());
    const dispose = host!.runtime.providers.dispose.bind(host!.runtime.providers);
    const providers = vi.spyOn(host!.runtime.providers, "dispose").mockImplementation(async () => {
      await dispose();
      throw new Error("fixture cleanup failure");
    });
    const attachments = vi.spyOn(host!.runtime.attachments, "dispose");
    const closing = host!.runtime.close();
    expect(host!.runtime.close()).toBe(closing);
    await expect(closing).rejects.toThrow("cleanup failed");
    await host!.runtime.closed;
    expect(providers).toHaveBeenCalledOnce();
    expect(attachments).toHaveBeenCalledOnce();
    await expect(fetch(`${f.base}/api/v1/health`)).rejects.toThrow();
  });
});
