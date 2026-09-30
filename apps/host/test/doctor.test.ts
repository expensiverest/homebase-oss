import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDoctor, diagnosticReportSchema, formatDoctor, type DoctorOptions } from "../src/setup/diagnostics.js";
import { fakeManager, goodHealth, goodTailscale } from "./helpers/service-fixture.js";
import type { ServiceMetadata } from "../src/service/metadata.js";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "hb-doctor-"));
  await mkdir(path.join(dir, "state"), { mode: 0o700 });
  await mkdir(path.join(dir, "repo", ".git"), { recursive: true });
  await writeFile(path.join(dir, "config.json"), JSON.stringify({ projectRoots: [path.join(dir, "repo")] }), {
    mode: 0o600,
  });
  await writeFile(path.join(dir, "state", "admin-key"), "a".repeat(43), { mode: 0o600 });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
function fixture(overrides: Partial<DoctorOptions> = {}) {
  const manager = fakeManager();
  manager.state.installed = true;
  manager.state.running = true;
  manager.state.enabled = true;
  manager.matches.mockReturnValue(true);
  const metadata: ServiceMetadata = {
    version: 1,
    manager: "windows-task",
    installedAt: new Date().toISOString(),
    homebaseVersion: goodHealth.version,
    nodePath: process.execPath,
    entryPath: process.execPath,
    configPath: path.join(dir, "config.json"),
    stateDir: path.join(dir, "state"),
    path: "",
    serviceIdentifier: "Homebase Test",
  };
  const options: DoctorOptions = {
    configPath: metadata.configPath,
    stateDir: metadata.stateDir,
    manager,
    entryPath: process.execPath,
    env: { PATH: "" },
    health: async () => goodHealth,
    status: async () => ({
      version: goodHealth.version,
      uptimeSeconds: 1,
      config: { port: 8787, bindAddress: "127.0.0.1", authMode: "device" },
      projects: { count: 1 },
      providers: [
        {
          id: "claude",
          name: "Claude Code",
          installed: true,
          authenticated: true,
          compatible: true,
          version: "2.1.0",
          warning: null,
        },
      ],
      devices: { total: 1, active: 1 },
    }),
    tailscale: { inspect: async () => goodTailscale },
    metadata: async () => metadata,
    ...overrides,
  };
  return { options, manager, metadata };
}
describe("read-only doctor", () => {
  it("returns all-pass diagnostic schema in a healthy private installation", async () => {
    const f = fixture();
    const report = await runDoctor(f.options);
    expect(report.ok).toBe(true);
    expect(diagnosticReportSchema.safeParse(report).success).toBe(true);
    expect(report.checks.every((c) => c.status === "pass")).toBe(true);
  });
  it("warnings alone keep success exit semantics", async () => {
    const f = fixture();
    f.manager.state.installed = false;
    f.options.metadata = async () => null;
    const report = await runDoctor(f.options);
    expect(report.ok).toBe(true);
    expect(report.checks.some((c) => c.status === "warn")).toBe(true);
  });
  it("failure sets non-success semantics", async () => {
    const f = fixture({ health: async () => null });
    const report = await runDoctor(f.options);
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "host.health")?.status).toBe("fail");
  });
  it("human output uses compact status markers", async () => {
    const report = await runDoctor(fixture().options);
    expect(formatDoctor(report).every((line) => /^[✓!✕] /.test(line))).toBe(true);
  });
  it("has deterministic diagnostic IDs", async () => {
    const f = fixture();
    expect((await runDoctor(f.options)).checks.map((c) => c.id)).toEqual(
      (await runDoctor(f.options)).checks.map((c) => c.id),
    );
  });
  it("metadata version mismatch warns", async () => {
    const f = fixture();
    f.metadata.homebaseVersion = "0.0.0";
    expect((await runDoctor(f.options)).checks.find((c) => c.id === "service.version")?.status).toBe("warn");
  });
  it("wrong Host version warns", async () => {
    const f = fixture({ health: async () => ({ ...goodHealth, version: "0.0.0" }) });
    expect((await runDoctor(f.options)).checks.find((c) => c.id === "host.version")?.status).toBe("warn");
  });
  it("invalid config fails without showing its secret value", async () => {
    const f = fixture();
    await writeFile(f.options.configPath, '{"auth":{"mode":"unknown-secret"}}');
    const report = await runDoctor(f.options);
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain("unknown-secret");
  });
  it("missing root fails", async () => {
    const f = fixture();
    await writeFile(f.options.configPath, JSON.stringify({ projectRoots: [path.join(dir, "missing")] }));
    expect((await runDoctor(f.options)).checks.find((c) => c.id === "projects.root.0")?.status).toBe("fail");
  });
  it("missing Tailscale warns", async () => {
    const f = fixture({
      tailscale: {
        inspect: async () => ({
          ...goodTailscale,
          installed: false,
          url: null,
          connected: false,
          serve: "missing",
          message: "Install Tailscale.",
        }),
      },
    });
    expect((await runDoctor(f.options)).checks.find((c) => c.id === "tailscale.installed")?.status).toBe("warn");
  });
  it("Funnel fails", async () => {
    const f = fixture({
      tailscale: {
        inspect: async () => ({ ...goodTailscale, serve: "funnel", url: null, message: "Public Funnel is enabled." }),
      },
    });
    expect((await runDoctor(f.options)).checks.find((c) => c.id === "tailscale.serve")?.status).toBe("fail");
  });
  it("provider unavailable warns", async () => {
    const f = fixture();
    const status = await f.options.status!(8787, f.options.stateDir);
    status!.providers[0]!.installed = false;
    f.options.status = async () => status;
    expect((await runDoctor(f.options)).checks.find((c) => c.id === "providers.claude")?.status).toBe("warn");
  });
  it("unknown provider runtime does not detect or launch providers", async () => {
    const f = fixture({ status: async () => null });
    const report = await runDoctor(f.options);
    expect(report.checks.find((c) => c.id === "providers.runtime")?.status).toBe("warn");
    expect(f.manager.start).not.toHaveBeenCalled();
    expect(f.manager.install).not.toHaveBeenCalled();
  });
  it("service PATH mismatch warns", async () => {
    const f = fixture();
    const bin = path.join(dir, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, process.platform === "win32" ? "claude.exe" : "claude"), "fixture", { mode: 0o700 });
    f.options.env = { PATH: bin };
    expect((await runDoctor(f.options)).checks.find((c) => c.id === "service.path.claude")?.status).toBe("warn");
  });
  it("missing service executable fails and never substitutes PATH", async () => {
    const f = fixture();
    f.metadata.nodePath = path.join(dir, "missing-node");
    expect((await runDoctor(f.options)).checks.find((c) => c.id === "service.file.nodePath")?.status).toBe("fail");
    expect(f.manager.start).not.toHaveBeenCalled();
  });
  it("corrupt metadata warns without OS mutations", async () => {
    const f = fixture({
      metadata: async () => {
        throw new Error("bad secret metadata");
      },
    });
    const report = await runDoctor(f.options);
    expect(report.checks.find((c) => c.id === "service.metadata")?.status).toBe("warn");
    expect(JSON.stringify(report)).not.toContain("bad secret");
    expect(f.manager.uninstall).not.toHaveBeenCalled();
  });
  it("secret environment values and admin key never appear", async () => {
    const f = fixture({ env: { PATH: "", XAI_API_KEY: "sensitive-value", HOMEBASE_DEV_TOKEN: "secret-token" } });
    const text = JSON.stringify(await runDoctor(f.options));
    expect(text).not.toMatch(/sensitive-value|secret-token|a{43}/);
    expect(text).toContain("Shell-local credentials");
  });
  it("does not migrate legacy config or write state", async () => {
    const f = fixture();
    const before = await readFile(f.options.configPath, "utf8");
    await runDoctor(f.options);
    expect(await readFile(f.options.configPath, "utf8")).toBe(before);
    expect(f.manager.start).not.toHaveBeenCalled();
    expect(f.manager.stop).not.toHaveBeenCalled();
    expect(f.manager.install).not.toHaveBeenCalled();
  });
});
