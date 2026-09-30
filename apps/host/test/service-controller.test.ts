import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ServiceController } from "../src/service/service.js";
import { readServiceMetadata } from "../src/service/metadata.js";
import { fakeManager, goodHealth } from "./helpers/service-fixture.js";
import type { ServiceDefinition } from "../src/service/types.js";
let dir: string;
let d: ServiceDefinition;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "hb-service-unit-"));
  await mkdir(path.join(dir, "state"));
  d = {
    nodePath: process.execPath,
    entryPath: path.join(dir, "entry.js"),
    configPath: path.join(dir, "config.json"),
    stateDir: path.join(dir, "state"),
    path: "",
    homebaseVersion: goodHealth.version,
  };
  await writeFile(d.configPath, "{}");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
function fixture(options: { ready?: boolean; graceful?: boolean } = {}) {
  const manager = fakeManager();
  const health = vi.fn(async () => (manager.state.running && options.ready !== false ? goodHealth : null));
  const shutdown = vi.fn(async () => {
    if (options.graceful !== false) manager.state.running = false;
    return options.graceful !== false;
  });
  const service = new ServiceController({
    manager,
    definition: d,
    port: 49150,
    health,
    shutdown,
    availablePort: async () => true,
    timeoutMs: 1,
    stopTimeoutMs: 1,
  });
  return { manager, health, shutdown, service };
}
describe("service lifecycle", () => {
  it("installs atomically with secret-free versioned metadata", async () => {
    const f = fixture();
    await f.service.install();
    expect(await readServiceMetadata(d.stateDir)).toMatchObject({ version: 1, entryPath: d.entryPath });
  });
  it("rejects unavailable manager", async () => {
    const f = fixture();
    f.manager.isAvailable.mockResolvedValue(false);
    await expect(f.service.install()).rejects.toThrow("unavailable");
    expect(f.manager.install).not.toHaveBeenCalled();
  });
  it("starts and verifies health", async () => {
    const f = fixture();
    await f.service.install();
    await f.service.start();
    expect(f.manager.start).toHaveBeenCalledOnce();
  });
  it("does not start an uninstalled service", async () => {
    const f = fixture();
    await expect(f.service.start()).rejects.toThrow("not installed");
  });
  it("reports bounded health timeout", async () => {
    const f = fixture({ ready: false });
    await f.service.install();
    await expect(f.service.start()).rejects.toThrow("did not become healthy");
  });
  it("rejects wrong running version", async () => {
    const f = fixture();
    await f.service.install();
    f.health.mockImplementation(async () => ({ ...goodHealth, version: "0.0.0" }));
    f.manager.state.running = true;
    await expect(f.service.start()).rejects.toThrow("did not become healthy");
  });
  it("gracefully stops before native fallback", async () => {
    const f = fixture();
    await f.service.install();
    await f.service.start();
    await f.service.stop();
    expect(f.shutdown).toHaveBeenCalledOnce();
    expect(f.manager.state.running).toBe(false);
    expect(f.shutdown.mock.invocationCallOrder[0]).toBeLessThan(f.manager.stop.mock.invocationCallOrder[0]!);
  });
  it("falls back when local shutdown is unavailable", async () => {
    const f = fixture({ graceful: false });
    await f.service.install();
    await f.service.start();
    await f.service.stop();
    expect(f.manager.stop).toHaveBeenCalledOnce();
  });
  it("falls back when shutdown throws", async () => {
    const f = fixture();
    await f.service.install();
    await f.service.start();
    f.shutdown.mockRejectedValue(new Error("wedged"));
    await f.service.stop();
    expect(f.manager.stop).toHaveBeenCalledOnce();
  });
  it("restart stops gracefully then starts once", async () => {
    const f = fixture();
    await f.service.install();
    await f.service.start();
    f.manager.start.mockClear();
    await f.service.restart();
    expect(f.shutdown).toHaveBeenCalledOnce();
    expect(f.manager.start).toHaveBeenCalledOnce();
  });
  it("repeated uninstall is safe", async () => {
    const f = fixture();
    await f.service.install();
    await f.service.start();
    await f.service.uninstall();
    await f.service.uninstall();
    expect(await readServiceMetadata(d.stateDir)).toBeNull();
  });
  it("port zero cannot be installed", async () => {
    const manager = fakeManager();
    await expect(new ServiceController({ manager, definition: d, port: 0 }).install()).rejects.toThrow("fixed port");
    expect(manager.install).not.toHaveBeenCalled();
  });
  it("leaves another application's port alone", async () => {
    const manager = fakeManager();
    await expect(
      new ServiceController({
        manager,
        definition: d,
        port: 49150,
        health: async () => null,
        availablePort: async () => false,
      }).install(),
    ).rejects.toThrow("occupied");
    expect(manager.stop).not.toHaveBeenCalled();
  });
  it("recognizes a manual healthy Homebase and refuses a second process", async () => {
    const manager = fakeManager();
    await manager.install(d);
    await expect(
      new ServiceController({ manager, definition: d, port: 49150, health: async () => goodHealth }).start(),
    ).rejects.toThrow("foreground");
    expect(manager.start).not.toHaveBeenCalled();
  });
  it("alternate state cannot stop, start, overwrite or remove another installation", async () => {
    const f = fixture();
    await f.manager.install({ ...d, stateDir: path.join(dir, "another-state") });
    f.manager.state.running = true;
    for (const action of [
      () => f.service.stop(),
      () => f.service.start(),
      () => f.service.install(),
      () => f.service.uninstall(),
    ])
      await expect(action()).rejects.toThrow("left unchanged");
    expect(f.shutdown).not.toHaveBeenCalled();
    expect(f.manager.stop).not.toHaveBeenCalled();
    expect(f.manager.uninstall).not.toHaveBeenCalled();
  });
});
