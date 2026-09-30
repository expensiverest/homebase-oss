import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { uninstallHomebase, validatePurgeTarget } from "../src/setup/uninstall.js";
import { upgradeService } from "../src/setup/upgrade.js";
import { fakeManager, fakePrompts, captureIo } from "./helpers/service-fixture.js";
import type { ServiceDefinition } from "../src/service/types.js";
import { ServiceController } from "../src/service/service.js";
import { writeServiceMetadata, readServiceMetadata } from "../src/service/metadata.js";
import { goodHealth } from "./helpers/service-fixture.js";
let dir: string;
let state: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "hb-uninstall-"));
  state = path.join(dir, "state");
  await mkdir(state);
  await writeFile(
    path.join(state, "state-owner.json"),
    JSON.stringify({ version: 1, product: "homebase", stateDir: state }),
  );
  await writeFile(path.join(state, "config.json"), "{}");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe("safe uninstall", () => {
  it("refuses provider-owned directories even with a Homebase marker", async () => {
    const fakeHome = path.join(dir, "home");
    const provider = path.join(fakeHome, ".claude");
    await mkdir(provider, { recursive: true });
    await writeFile(
      path.join(provider, "state-owner.json"),
      JSON.stringify({ version: 1, product: "homebase", stateDir: provider }),
    );
    await expect(validatePurgeTarget(provider, { home: fakeHome })).rejects.toThrow("provider or Tailscale");
  });
  it("calls graceful service orchestrator and preserves state by default", async () => {
    const service = { uninstall: vi.fn(async () => undefined) };
    await uninstallHomebase({ stateDir: state, io: captureIo(), purge: false, service });
    expect(service.uninstall).toHaveBeenCalledOnce();
    expect(await readFile(path.join(state, "config.json"), "utf8")).toBe("{}");
  });
  it("purges verified state after explicit confirmation and leaves provider/repo data alone", async () => {
    await mkdir(path.join(dir, "provider"));
    await writeFile(path.join(dir, "provider", "login"), "provider-owned");
    await uninstallHomebase({
      stateDir: state,
      io: captureIo(),
      purge: true,
      prompts: fakePrompts([true]),
      service: { uninstall: async () => undefined },
    });
    await expect(readFile(path.join(state, "config.json"))).rejects.toThrow();
    expect(await readFile(path.join(dir, "provider", "login"), "utf8")).toBe("provider-owned");
  });
  it("declining purge causes no deletion or service stop", async () => {
    const service = { uninstall: vi.fn(async () => undefined) };
    await expect(
      uninstallHomebase({ stateDir: state, io: captureIo(), purge: true, prompts: fakePrompts([false]), service }),
    ).rejects.toThrow("cancelled");
    expect(service.uninstall).not.toHaveBeenCalled();
  });
  it.each(["", ".", "..", path.parse(process.cwd()).root, os.homedir(), process.cwd()])(
    "rejects dangerous purge %j",
    async (target) => await expect(validatePurgeTarget(target)).rejects.toThrow(),
  );
  it("rejects repository or project ancestors", async () => {
    await expect(validatePurgeTarget(state, { repository: state })).rejects.toThrow();
    await expect(validatePurgeTarget(state, { projectRoots: [path.join(state, "project")] })).rejects.toThrow();
  });
  it("rejects directories with unowned contents", async () => {
    await writeFile(path.join(state, "unrelated"), "data");
    await expect(validatePurgeTarget(state)).rejects.toThrow("does not own");
  });
  it("rejects missing ownership marker", async () => {
    await rm(path.join(state, "state-owner.json"));
    await expect(validatePurgeTarget(state)).rejects.toThrow("ownership marker");
  });
  it("rejects repository inside state", async () => {
    await mkdir(path.join(state, ".git"));
    await expect(validatePurgeTarget(state)).rejects.toThrow();
  });
  it("preserves Tailscale and prints only explicit mapping-removal guidance", async () => {
    const io = captureIo();
    await uninstallHomebase({ stateDir: state, io, purge: false, service: { uninstall: async () => undefined } });
    expect(io.lines.join("\n")).toContain("Tailscale Serve was left unchanged");
    expect(io.lines.join("\n")).not.toContain("serve reset");
  });
  it("repeated uninstall preserves state safely", async () => {
    const service = { uninstall: vi.fn(async () => undefined) };
    const options = { stateDir: state, io: captureIo(), purge: false, service };
    await uninstallHomebase(options);
    await uninstallHomebase(options);
    expect(service.uninstall).toHaveBeenCalledTimes(2);
  });
});
describe("source upgrade handoff", () => {
  function fixture() {
    const current: ServiceDefinition = {
      nodePath: process.execPath,
      entryPath: path.join(dir, "index.js"),
      configPath: path.join(state, "config.json"),
      stateDir: state,
      path: "",
      homebaseVersion: "0.0.1",
    };
    const manager = fakeManager();
    manager.state.installed = true;
    manager.state.enabled = true;
    manager.matches.mockReturnValue(true);
    return {
      current,
      installed: { ...current },
      manager,
      io: captureIo(),
      service: { install: vi.fn(async () => undefined), restart: vi.fn(async () => undefined) },
    };
  }
  it("equal versions/paths leave service current", async () => {
    const f = fixture();
    await upgradeService(f);
    expect(f.service.install).not.toHaveBeenCalled();
    expect(f.io.lines.join("\n")).toContain("definition is current");
  });
  it("older metadata reinstalls and restarts", async () => {
    const f = fixture();
    f.installed.homebaseVersion = "0.0.0";
    await upgradeService(f);
    expect(f.service.install).toHaveBeenCalledOnce();
    expect(f.service.restart).toHaveBeenCalledOnce();
  });
  it("changed entrypoint refreshes service", async () => {
    const f = fixture();
    f.installed.entryPath = path.join(dir, "old-entry.js");
    await upgradeService(f);
    expect(f.service.install).toHaveBeenCalledOnce();
  });
  it("native definition mismatch refreshes even when metadata matches", async () => {
    const f = fixture();
    f.manager.matches.mockReturnValue(false);
    await upgradeService(f);
    expect(f.service.restart).toHaveBeenCalledOnce();
  });
  it("failed version/health verification propagates", async () => {
    const f = fixture();
    f.installed.homebaseVersion = "old";
    f.service.restart.mockRejectedValue(new Error("wrong Host version"));
    await expect(upgradeService(f)).rejects.toThrow("wrong Host version");
  });
  it("no service prints setup guidance and never invokes network or git", async () => {
    const f = fixture();
    f.manager.state.installed = false;
    await upgradeService(f);
    expect(f.service.install).not.toHaveBeenCalled();
    expect(f.io.lines.join("\n")).toContain("Fetching new source remains manual");
  });
  it.each([true, false])(
    "a real controller upgrades running=%s with exactly one start and no double restart",
    async (running) => {
      const f = fixture();
      const manager = fakeManager();
      const old = { ...f.current, entryPath: path.join(dir, "old.js") };
      await manager.install(old);
      await writeServiceMetadata(manager, old);
      manager.state.running = running;
      manager.install.mockClear();
      const shutdown = vi.fn(async () => {
        manager.state.running = false;
        return true;
      });
      const service = new ServiceController({
        manager,
        definition: f.current,
        port: 49150,
        health: async () => (manager.state.running ? { ...goodHealth, version: f.current.homebaseVersion } : null),
        shutdown,
        availablePort: async () => true,
      });
      await upgradeService({ ...f, installed: old, manager, service });
      expect(manager.install).toHaveBeenCalledOnce();
      expect(manager.start).toHaveBeenCalledOnce();
      expect(shutdown).toHaveBeenCalledTimes(running ? 1 : 0);
      expect(await readServiceMetadata(state)).toMatchObject(f.current);
    },
  );
  it("refreshes an older running Host once when its native executable command is unchanged", async () => {
    const f = fixture();
    const manager = fakeManager();
    const old = { ...f.current, homebaseVersion: "old" };
    await manager.install(old);
    await writeServiceMetadata(manager, old);
    // Windows action ownership hashes the command, rather than package version.
    manager.matches.mockReturnValue(true);
    manager.state.running = true;
    let version = "old";
    manager.start.mockImplementation(async () => {
      manager.state.running = true;
      version = f.current.homebaseVersion;
    });
    manager.install.mockClear();
    const shutdown = vi.fn(async () => {
      manager.state.running = false;
      return true;
    });
    const service = new ServiceController({
      manager,
      definition: f.current,
      port: 49150,
      health: async () => (manager.state.running ? { ...goodHealth, version } : null),
      shutdown,
      availablePort: async () => true,
    });
    await upgradeService({ ...f, installed: old, manager, service });
    expect(manager.install).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(manager.start).toHaveBeenCalledOnce();
    expect(version).toBe(f.current.homebaseVersion);
  });
});
