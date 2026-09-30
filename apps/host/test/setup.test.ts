import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runSetup, type SetupOptions } from "../src/setup/setup.js";
import { SetupCancelled } from "../src/setup/prompts.js";
import { fakeManager, fakePrompts, captureIo, goodHealth, goodTailscale } from "./helpers/service-fixture.js";
import type { TailscaleStatus } from "../src/remote/tailscale.js";
let base: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "hb-setup-"));
  await mkdir(path.join(base, "project folder"));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function fixture(overrides: Partial<SetupOptions> = {}) {
  const stateDir = path.join(base, "custom state");
  const configPath = path.join(stateDir, "config.json");
  const manager = fakeManager();
  const io = captureIo();
  const prompts = fakePrompts([false, true, false]);
  const definition = vi.fn(async () => ({
    nodePath: process.execPath,
    entryPath: path.join(base, "built index.js"),
    stateDir,
    configPath,
    path: "",
    homebaseVersion: goodHealth.version,
  }));
  const service = {
    install: vi.fn(async () => {
      await manager.install(await definition());
    }),
    start: vi.fn(async () => {
      await manager.start();
    }),
    restart: vi.fn(async () => {
      await manager.stop();
      await manager.start();
    }),
  };
  const tailscale = {
    inspect: vi.fn(async () => ({ ...goodTailscale })),
    configure: vi.fn(async () => ({ ...goodTailscale })),
  };
  const pair = vi.fn(async () => undefined);
  const options: SetupOptions = {
    configPath,
    stateDir,
    cwd: path.join(base, "project folder"),
    io,
    prompts,
    manager,
    definition,
    controller: () => service,
    health: async () => (manager.state.running ? goodHealth : null),
    portAvailable: async () => true,
    providers: vi.fn(async () => [
      {
        id: "claude",
        name: "Claude Code",
        installed: true,
        authenticated: true,
        compatible: true,
        version: "2.1.0",
        warning: null,
      },
    ]),
    tailscale,
    pair,
    status: async () => null,
    doctor: async () => ({ ok: true, checks: [] }),
    ...overrides,
  };
  return { options, manager, io, prompts, service, tailscale, pair };
}
describe("setup engine", () => {
  it("migrates validated legacy raw config without persisting shell overrides", async () => {
    const f = fixture();
    await writeFile(
      path.join(f.options.cwd, "homebase.config.json"),
      JSON.stringify({ projectRoots: [f.options.cwd], customSetting: "preserve" }),
    );
    vi.stubEnv("HOMEBASE_DEV_TOKEN", "a".repeat(40));
    await runSetup(f.options);
    const saved = await readFile(f.options.configPath, "utf8");
    expect(saved).toContain("customSetting");
    expect(saved).not.toContain("a".repeat(40));
    expect(await readFile(path.join(f.options.cwd, "homebase.config.json"), "utf8")).toContain("customSetting");
  });
  it("repairs disabled autostart without making a duplicate service", async () => {
    const f = fixture();
    await runSetup(f.options);
    f.manager.state.enabled = false;
    f.service.install.mockClear();
    await runSetup({ ...f.options, prompts: fakePrompts([false, true, false]) });
    expect(f.service.install).toHaveBeenCalledOnce();
    expect(f.manager.state.enabled).toBe(true);
  });
  it("clean first run creates compact config, root, service and healthy result", async () => {
    const f = fixture();
    expect(await runSetup(f.options)).toBe(0);
    const raw = JSON.parse(await readFile(f.options.configPath, "utf8"));
    expect(Object.keys(raw)).toEqual(["projectRoots"]);
    expect(raw.projectRoots).toHaveLength(1);
    expect(f.service.install).toHaveBeenCalledOnce();
    expect(f.service.start).toHaveBeenCalledOnce();
    expect(f.io.lines).toContain("\nHomebase is ready.");
  });
  it("preserves existing config, custom settings and device state", async () => {
    const f = fixture();
    await mkdir(f.options.stateDir);
    const config = {
      projectRoots: [f.options.cwd],
      host: { port: 41234 },
      providers: { grok: { enabled: false } },
      futureSetting: { keep: true },
    };
    await writeFile(f.options.configPath, JSON.stringify(config));
    await writeFile(path.join(f.options.stateDir, "security.json"), "device-state-byte-for-byte");
    await runSetup(f.options);
    expect(JSON.parse(await readFile(f.options.configPath, "utf8"))).toEqual(config);
    expect(await readFile(path.join(f.options.stateDir, "security.json"), "utf8")).toBe("device-state-byte-for-byte");
  });
  it("adds multiple canonical roots", async () => {
    const second = path.join(base, "second");
    await mkdir(second);
    const f = fixture({
      prompts: fakePrompts([true, false, true, false], [path.join(base, "project folder"), second]),
    });
    await runSetup(f.options);
    expect(JSON.parse(await readFile(f.options.configPath, "utf8")).projectRoots).toHaveLength(2);
  });
  it("duplicate root selection does not rewrite roots", async () => {
    const f = fixture({
      prompts: fakePrompts(
        [true, false, true, false],
        [path.join(base, "project folder"), path.join(base, "project folder")],
      ),
    });
    await runSetup(f.options);
    expect(JSON.parse(await readFile(f.options.configPath, "utf8")).projectRoots).toHaveLength(1);
  });
  it("rerunning setup does not reinstall, duplicate roots or reset devices", async () => {
    const f = fixture();
    await runSetup(f.options);
    f.options.prompts = fakePrompts([false, true, false]);
    await runSetup(f.options);
    expect(f.service.install).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(f.options.configPath, "utf8")).projectRoots).toHaveLength(1);
  });
  it("shows installed provider version", async () => {
    const f = fixture();
    await runSetup(f.options);
    expect(f.io.lines.join("\n")).toContain("✓ Claude Code 2.1.0");
  });
  it("shows signed-out provider guidance", async () => {
    const f = fixture({
      providers: async () => [
        {
          id: "grok",
          name: "Grok Build",
          installed: true,
          compatible: true,
          authenticated: false,
          version: "1.0.1",
          warning: "Run `grok login`",
        },
      ],
    });
    await runSetup(f.options);
    expect(f.io.lines.join("\n")).toContain("! Grok Build 1.0.1 — Run `grok login`");
  });
  it.each([
    { label: "missing", state: { installed: false, connected: false, serve: "missing" } },
    { label: "disconnected", state: { installed: true, connected: false, serve: "missing" } },
    { label: "conflict", state: { installed: true, connected: true, serve: "conflict" } },
    { label: "funnel", state: { installed: true, connected: true, serve: "funnel" } },
    { label: "ambiguous", state: { installed: true, connected: true, serve: "ambiguous" } },
  ] as const)("handles Tailscale $label without mutations", async ({ state }) => {
    const f = fixture();
    f.tailscale.inspect.mockResolvedValue({ ...goodTailscale, ...state, url: null });
    await runSetup(f.options);
    expect(f.tailscale.configure).not.toHaveBeenCalled();
    expect(f.pair).not.toHaveBeenCalled();
    expect(f.service.start).toHaveBeenCalledOnce();
  });
  it("recognizes correct Serve without reconfiguring", async () => {
    const f = fixture();
    await runSetup(f.options);
    expect(f.tailscale.configure).not.toHaveBeenCalled();
  });
  it("configures missing Serve after confirmation", async () => {
    const f = fixture({ prompts: fakePrompts([false, true, true, false]) });
    f.tailscale.inspect.mockResolvedValue({ ...goodTailscale, serve: "missing", url: null });
    await runSetup(f.options);
    expect(f.tailscale.configure).toHaveBeenCalledWith(8787);
  });
  it("skips missing Serve when declined", async () => {
    const f = fixture({ prompts: fakePrompts([false, true, false]) });
    f.tailscale.inspect.mockResolvedValue({ ...goodTailscale, serve: "missing", url: null });
    await runSetup(f.options);
    expect(f.tailscale.configure).not.toHaveBeenCalled();
  });
  it("keeps working service when Serve fails", async () => {
    const f = fixture({ prompts: fakePrompts([false, true, true, false]) });
    f.tailscale.inspect.mockResolvedValue({ ...goodTailscale, serve: "missing", url: null });
    f.tailscale.configure.mockRejectedValue(new Error("Serve failed"));
    expect(await runSetup(f.options)).toBe(0);
    expect(f.service.start).toHaveBeenCalledOnce();
    expect(f.io.lines.join("\n")).toContain("Serve failed");
  });
  it("keeps config when service install fails", async () => {
    const f = fixture();
    f.service.install.mockRejectedValue(new Error("Install failed"));
    expect(await runSetup(f.options)).toBe(1);
    expect(await readFile(f.options.configPath, "utf8")).toContain("projectRoots");
  });
  it("keeps service/config when start fails", async () => {
    const f = fixture();
    f.service.start.mockRejectedValue(new Error("Start failed"));
    expect(await runSetup(f.options)).toBe(1);
    expect(f.service.install).toHaveBeenCalledOnce();
  });
  it("reports Host health timeout without rollback", async () => {
    const f = fixture();
    f.service.start.mockRejectedValue(new Error("Host health timeout; run doctor"));
    await runSetup(f.options);
    expect(f.io.lines.join("\n")).toContain("Host health timeout");
  });
  it("reuses pairing when available and accepted", async () => {
    const f = fixture({ prompts: fakePrompts([false, true, true]) });
    await runSetup(f.options);
    expect(f.pair).toHaveBeenCalledWith(f.io, { port: 8787, stateDir: f.options.stateDir, url: goodTailscale.url });
  });
  it("pairing skipped does not generate invitation", async () => {
    const f = fixture();
    await runSetup(f.options);
    expect(f.pair).not.toHaveBeenCalled();
  });
  it("pairing failure does not uninstall service", async () => {
    const f = fixture({ prompts: fakePrompts([false, true, true]) });
    f.pair.mockRejectedValue(new Error("Pair later"));
    await runSetup(f.options);
    expect(f.manager.uninstall).not.toHaveBeenCalled();
  });
  it("preserves explicit custom config/state with spaces", async () => {
    const configPath = path.join(base, "explicit config.json");
    const f = fixture({ configPath });
    await runSetup(f.options);
    expect(f.options.definition).toHaveBeenCalledWith(configPath, f.options.stateDir);
    expect(JSON.parse(await readFile(configPath, "utf8")).projectRoots).toHaveLength(1);
  });
  it("does not serialize shell keys, auth mode or project overrides", async () => {
    vi.stubEnv("HOMEBASE_DEV_TOKEN", "secret".repeat(10));
    vi.stubEnv("XAI_API_KEY", "private-key");
    vi.stubEnv("HOMEBASE_AUTH_MODE", "none");
    const f = fixture();
    await runSetup(f.options);
    const stored = await readFile(f.options.configPath, "utf8");
    expect(stored).not.toMatch(/secret|private-key|devToken|none/);
  });
  it("changes ephemeral port to selected fixed port", async () => {
    const f = fixture({ prompts: fakePrompts([false, true, false], ["43123"]) });
    await mkdir(f.options.stateDir);
    await writeFile(f.options.configPath, JSON.stringify({ projectRoots: [f.options.cwd], host: { port: 0 } }));
    await runSetup(f.options);
    expect(JSON.parse(await readFile(f.options.configPath, "utf8")).host.port).toBe(43123);
  });
  it("occupied default asks for another port and kills nothing", async () => {
    const f = fixture({
      prompts: fakePrompts([false, true, false], [path.join(base, "project folder"), "43124"]),
      portAvailable: async (port) => port !== 8787,
    });
    await runSetup(f.options);
    expect(JSON.parse(await readFile(f.options.configPath, "utf8")).host.port).toBe(43124);
    expect(f.manager.stop).not.toHaveBeenCalled();
  });
  it("explicit none auth never configures Serve or pairs", async () => {
    const f = fixture();
    await mkdir(f.options.stateDir);
    await writeFile(f.options.configPath, JSON.stringify({ projectRoots: [f.options.cwd], auth: { mode: "none" } }));
    f.tailscale.inspect.mockResolvedValue({ ...goodTailscale, serve: "missing", url: null });
    await runSetup(f.options);
    expect(f.tailscale.configure).not.toHaveBeenCalled();
    expect(f.pair).not.toHaveBeenCalled();
  });
  it("degrades gracefully without service manager", async () => {
    const f = fixture();
    f.manager.isAvailable.mockResolvedValue(false);
    expect(await runSetup(f.options)).toBe(1);
    expect(f.io.lines.join("\n")).toContain("Run `homebase` manually");
    expect(f.service.install).not.toHaveBeenCalled();
  });
  it("cancellation preserves completed atomic config", async () => {
    const f = fixture();
    vi.mocked(f.prompts.input).mockRejectedValue(new SetupCancelled());
    await expect(runSetup(f.options)).rejects.toBeInstanceOf(SetupCancelled);
    expect(await readFile(f.options.configPath, "utf8")).toBe("{}\n");
    expect(f.service.install).not.toHaveBeenCalled();
  });
  it("invalid existing configuration is not overwritten", async () => {
    const f = fixture();
    await mkdir(f.options.stateDir);
    await writeFile(f.options.configPath, "invalid JSON");
    await expect(runSetup(f.options)).rejects.toThrow();
    expect(await readFile(f.options.configPath, "utf8")).toBe("invalid JSON");
  });
  it("fixed healthy existing Host is recognized without conflict prompt", async () => {
    const f = fixture({ health: async () => goodHealth, portAvailable: async () => false });
    await runSetup(f.options);
    expect(f.io.lines.join("\n")).not.toContain("occupied");
  });
  it("safe missing Serve typed state has no private identity payload", () => {
    const status: TailscaleStatus = { ...goodTailscale, url: null, serve: "missing" };
    expect(Object.keys(status)).toEqual(["installed", "connected", "serve", "url", "message"]);
  });
});
