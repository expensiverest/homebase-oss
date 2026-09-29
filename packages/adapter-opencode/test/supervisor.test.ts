import type { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRecordingLogger,
  runExecutable,
  spawnExecutable,
  ExecutableFailure,
  type RunExecutable,
  type SpawnExecutable,
} from "@homebase/adapter-sdk";
import { createTestAdapterContext } from "@homebase/adapter-sdk/testing";
import { describe, expect, it } from "vitest";

import { OpenCodeAdapter } from "../src/adapter.js";
import { parseOpenCodeConfig } from "../src/config.js";
import { OpenCodeSupervisor, parseOpenCodeVersion } from "../src/supervisor.js";
import { createFakeFetch, jsonResponse } from "./helpers.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-opencode.mjs", import.meta.url));

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface FixtureControl {
  mode: string;
  startDelayMs?: number;
  spawned: ChildProcess[];
  envs: Array<Record<string, string | undefined>>;
  /** Resolves when every spawned child has exited. */
  waitForExit(child: ChildProcess): Promise<void>;
}

function createControl(mode = "normal"): FixtureControl {
  const control: FixtureControl = {
    mode,
    spawned: [],
    envs: [],
    waitForExit(child) {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
      return new Promise((resolve) => child.once("close", () => resolve()));
    },
  };
  return control;
}

function fixtureSpawner(control: FixtureControl): SpawnExecutable {
  return (_command, args, options) => {
    const env = { ...(options?.env ?? {}) };
    env.FAKE_OPENCODE_MODE = control.mode;
    if (control.startDelayMs !== undefined) env.FAKE_OPENCODE_START_DELAY_MS = String(control.startDelayMs);
    control.envs.push(env);
    const child = spawnExecutable(process.execPath, [FIXTURE, ...args], { ...options, env });
    control.spawned.push(child);
    return child;
  };
}

function fixtureRunner(control: FixtureControl): RunExecutable {
  return (_command, args, options) => {
    if (control.mode === "missing") {
      return Promise.reject(new ExecutableFailure("not_found", "opencode was not found."));
    }
    const env = { ...process.env, FAKE_OPENCODE_MODE: control.mode };
    return runExecutable(process.execPath, [FIXTURE, ...args], { ...options, env });
  };
}

function makeSupervisor(options: {
  control: FixtureControl;
  config?: Record<string, unknown>;
  fetchFn?: typeof fetch;
}) {
  const recording = createRecordingLogger();
  const config = parseOpenCodeConfig({
    serverMode: "auto",
    executable: "opencode",
    managedPort: 0,
    startupTimeoutMs: 8_000,
    shutdownTimeoutMs: 1_000,
    requestTimeoutMs: 2_000,
    ...options.config,
  });
  const supervisor = new OpenCodeSupervisor({
    config,
    logger: recording.logger,
    spawnFn: fixtureSpawner(options.control),
    runFn: fixtureRunner(options.control),
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
  });
  return { supervisor, config, logs: recording.entries };
}

const unreachableFetch = (async () => {
  throw new TypeError("fetch failed");
}) as typeof fetch;

const healthyExternalFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const { fetchFn } = createFakeFetch([
    { method: "GET", path: "/api/info", handler: () => jsonResponse({ version: "2.0.18", paths: {} }) },
  ]);
  return fetchFn(input, init);
}) as typeof fetch;

const authRejectingFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const { fetchFn } = createFakeFetch([
    {
      method: "GET",
      path: "/api/info",
      handler: () => new Response(JSON.stringify({ _tag: "UnauthorizedError" }), { status: 401 }),
    },
  ]);
  return fetchFn(input, init);
}) as typeof fetch;

describe("parseOpenCodeVersion", () => {
  it("parses v2 and v1 version output", () => {
    expect(parseOpenCodeVersion("opencode v2.0.18")).toBe("2.0.18");
    expect(parseOpenCodeVersion("1.18.33")).toBe("1.18.33");
    expect(parseOpenCodeVersion("no version here")).toBeNull();
  });
});

describe("OpenCode managed lifecycle", () => {
  it("reports a missing CLI distinctly from an unreachable external server", async () => {
    const control = createControl("missing");
    const { supervisor, logs } = makeSupervisor({ control, fetchFn: unreachableFetch });
    const detection = await supervisor.detect();
    expect(detection.status).toBe("cli_missing");
    expect(detection.warning).toContain("was not found on PATH");
    expect(detection.warning).toContain("http://127.0.0.1:4096");
    expect(control.spawned).toHaveLength(0);
    expect(JSON.stringify(logs)).toContain("not found on PATH");
  });

  it("reports an installed CLI that is too old without spawning a server", async () => {
    const control = createControl("v1");
    const { supervisor } = makeSupervisor({ control, fetchFn: unreachableFetch });
    const detection = await supervisor.detect();
    expect(detection.status).toBe("incompatible_cli");
    expect(detection.cliVersion).toBe("1.18.33");
    expect(control.spawned).toHaveLength(0);
  });

  it("uses a healthy external server in auto mode and never spawns", async () => {
    const control = createControl();
    const { supervisor } = makeSupervisor({ control, fetchFn: healthyExternalFetch });
    const detection = await supervisor.detect();
    expect(detection.status).toBe("ready");
    expect(detection.connection?.source).toBe("external");
    expect(control.spawned).toHaveLength(0);
  });

  it("does not spawn in external mode even when the server is unreachable", async () => {
    const control = createControl();
    const { supervisor } = makeSupervisor({
      control,
      fetchFn: unreachableFetch,
      config: { serverMode: "external" },
    });
    const detection = await supervisor.detect();
    expect(detection.status).toBe("external_unreachable");
    expect(control.spawned).toHaveLength(0);
  });

  it("reports rejected external credentials without spawning", async () => {
    const control = createControl();
    const { supervisor } = makeSupervisor({ control, fetchFn: authRejectingFetch });
    const detection = await supervisor.detect();
    expect(detection.status).toBe("auth_rejected");
    expect(detection.connection?.source).toBe("external");
    expect(control.spawned).toHaveLength(0);
  });

  it("starts a Homebase-managed server in auto mode and connects with the generated credentials", async () => {
    const control = createControl();
    const { supervisor, logs } = makeSupervisor({ control, fetchFn: unreachableFetch });
    try {
      const detection = await supervisor.detect();
      expect(detection.status).toBe("ready");
      expect(detection.connection?.source).toBe("managed");
      expect(detection.connection?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(detection.connection?.username).toBe("opencode");
      expect(detection.connection?.password).toBeTruthy();
      expect(control.spawned).toHaveLength(1);
      expect(supervisor.managedRunning).toBe(true);

      // The generated secret is passed to the child through the environment and
      // never appears in logs or diagnostics.
      const password = control.envs[0]?.OPENCODE_PASSWORD ?? "";
      expect(password.length).toBeGreaterThanOrEqual(32);
      expect(JSON.stringify(logs)).not.toContain(password);
    } finally {
      const child = control.spawned[0];
      await supervisor.stop();
      if (child) await control.waitForExit(child);
    }
  });

  it("handles a managed server that reports starting (503) before it is healthy", async () => {
    const control = createControl();
    control.startDelayMs = 600;
    const { supervisor } = makeSupervisor({ control, fetchFn: unreachableFetch });
    try {
      const detection = await supervisor.detect();
      expect(detection.status).toBe("ready");
    } finally {
      const child = control.spawned[0];
      await supervisor.stop();
      if (child) await control.waitForExit(child);
    }
  });

  it("fails clearly when the managed child exits early", async () => {
    const control = createControl("exit");
    const { supervisor } = makeSupervisor({ control, fetchFn: unreachableFetch });
    const detection = await supervisor.detect();
    expect(detection.status).toBe("managed_start_failed");
    expect(detection.warning).toContain("exited before it was reachable");
    expect(supervisor.managedRunning).toBe(false);
  });

  it("explains a managed port conflict", async () => {
    const control = createControl("port-busy");
    const { supervisor } = makeSupervisor({ control, fetchFn: unreachableFetch });
    const detection = await supervisor.detect();
    expect(detection.status).toBe("managed_start_failed");
    expect(detection.warning).toMatch(/already in use/i);
  });

  it("bounds managed startup with a timeout and kills the child", async () => {
    const control = createControl("hang");
    const { supervisor } = makeSupervisor({ control, fetchFn: unreachableFetch, config: { startupTimeoutMs: 1_200 } });
    const detection = await supervisor.detect();
    expect(detection.status).toBe("managed_start_failed");
    expect(detection.warning).toContain("did not become reachable");
    const child = control.spawned[0];
    expect(child).toBeDefined();
    if (child) {
      await control.waitForExit(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    }
  });

  it("does not restart a failed managed server until an explicit refresh", async () => {
    const control = createControl("exit");
    const { supervisor } = makeSupervisor({ control, fetchFn: unreachableFetch });
    await expect(supervisor.resolveConnection()).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(supervisor.resolveConnection()).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(control.spawned.length).toBeLessThanOrEqual(1);

    // Provider refresh (detect) may make one bounded new attempt.
    control.mode = "normal";
    const detection = await supervisor.detect();
    expect(detection.status).toBe("ready");
    expect(control.spawned.length).toBe(2);
    const child = control.spawned[1];
    await supervisor.stop();
    if (child) await control.waitForExit(child);
  });

  it("never kills an external server on stop", async () => {
    const control = createControl();
    const { supervisor } = makeSupervisor({ control, fetchFn: healthyExternalFetch });
    await supervisor.detect();
    await supervisor.stop();
    expect(control.spawned).toHaveLength(0);
  });

  it(
    "stops a real Windows npm-style .cmd wrapper without orphaning the server process",
    { timeout: 30_000 },
    async ({ skip }) => {
      if (process.platform !== "win32") return skip("Windows-only process-tree behavior");
      const treeDir = await mkdtemp(path.join(tmpdir(), "homebase-opencode-tree-"));
      let serverPid: number | null = null;
      try {
        const pidFile = path.join(treeDir, "server.pid");
        const wrapper = path.join(treeDir, "opencode.cmd");
        await writeFile(
          wrapper,
          `@echo off\r\nset FAKE_OPENCODE_PID_FILE=${pidFile}\r\n"${process.execPath}" "${FIXTURE}" %*\r\n`,
          "utf8",
        );
        const recording = createRecordingLogger();
        const config = parseOpenCodeConfig({
          serverMode: "managed",
          executable: wrapper,
          managedPort: 0,
          startupTimeoutMs: 8_000,
          shutdownTimeoutMs: 1_000,
        });
        const supervisor = new OpenCodeSupervisor({ config, logger: recording.logger, fetchFn: unreachableFetch });

        const detection = await supervisor.detect();
        expect(detection.status).toBe("ready");
        expect(detection.connection?.source).toBe("managed");

        const deadline = Date.now() + 10_000;
        while (serverPid === null && Date.now() < deadline) {
          try {
            serverPid = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
        expect(serverPid, "managed server pid file").toBeTruthy();
        expect(processAlive(serverPid!)).toBe(true);

        await supervisor.stop();
        const goneBy = Date.now() + 5_000;
        while (processAlive(serverPid!) && Date.now() < goneBy) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(processAlive(serverPid!), "managed server descendant must be dead").toBe(false);
      } finally {
        if (serverPid !== null && processAlive(serverPid)) {
          try {
            process.kill(serverPid, "SIGKILL");
          } catch {
            // best effort cleanup
          }
        }
        await rm(treeDir, { recursive: true, force: true });
      }
    },
  );
});

describe("OpenCodeAdapter managed lifecycle", () => {
  it("starts and stops its own server, and refreshes recover after failure", async () => {
    const control = createControl("exit");
    const adapter = new OpenCodeAdapter({
      config: { serverMode: "auto", managedPort: 0, startupTimeoutMs: 8_000, shutdownTimeoutMs: 1_000 },
      fetchFn: unreachableFetch,
      startEventStream: false,
      spawnFn: fixtureSpawner(control),
      runFn: fixtureRunner(control),
    });
    const context = createTestAdapterContext({ projectPath: "/tmp/demo", projectId: "prj_1" });
    adapter.init(context);

    const failed = await adapter.detect();
    expect(failed).toMatchObject({ installed: true, compatible: false });
    expect(failed.warning).toContain("exited before it was reachable");

    // Provider refresh: the same adapter can recover once the CLI works.
    control.mode = "normal";
    const recovered = await adapter.detect();
    expect(recovered).toMatchObject({ installed: true, authenticated: true, compatible: true });

    const child = control.spawned[0];
    await adapter.dispose();
    if (child) {
      await control.waitForExit(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    }
  });
});
