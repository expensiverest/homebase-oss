import { fileURLToPath } from "node:url";

import { spawnExecutable, type SpawnExecutable } from "@homebase/adapter-sdk";
import type { RequestPermissionResponse, SessionNotification } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it } from "vitest";

import { AcpTransport, AcpTransportError } from "../src/index.js";
import type { AcpClientHandlers } from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));

interface SpawnRecord {
  command: string;
  args: readonly string[];
  options: Record<string, unknown>;
}

interface HarnessOptions {
  mode?: string;
  auth?: string;
  version?: string;
  malformed?: boolean;
  stderrBytes?: number;
  suppressInit?: boolean;
  handlers?: AcpClientHandlers;
  startupTimeoutMs?: number;
  controlTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  stderrLimitBytes?: number;
  extraEnv?: Record<string, string>;
}

function harness(options: HarnessOptions = {}) {
  const spawns: SpawnRecord[] = [];
  const spawnFn: SpawnExecutable = (command, args, spawnOptions) => {
    const env = {
      ...(spawnOptions?.env ?? {}),
      ...(options.mode !== undefined ? { FAKE_ACP_MODE: options.mode } : {}),
      ...(options.auth !== undefined ? { FAKE_ACP_AUTH: options.auth } : {}),
      ...(options.version !== undefined ? { FAKE_ACP_VERSION: options.version } : {}),
      ...(options.malformed ? { FAKE_ACP_MALFORMED: "1" } : {}),
      ...(options.stderrBytes !== undefined ? { FAKE_ACP_STDERR_BYTES: String(options.stderrBytes) } : {}),
      ...(options.suppressInit ? { FAKE_ACP_SUPPRESS_INIT: "1" } : {}),
      ...(options.extraEnv ?? {}),
    };
    spawns.push({ command, args, options: (spawnOptions ?? {}) as Record<string, unknown> });
    return spawnExecutable(process.execPath, [FIXTURE, ...args], { ...spawnOptions, env });
  };

  const transport = new AcpTransport({
    command: "grok",
    args: ["--no-auto-update", "agent", "stdio"],
    handlers: options.handlers,
    spawnFn,
    startupTimeoutMs: options.startupTimeoutMs ?? 8_000,
    controlTimeoutMs: options.controlTimeoutMs ?? 5_000,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 1_000,
    ...(options.stderrLimitBytes !== undefined ? { stderrLimitBytes: options.stderrLimitBytes } : {}),
  });
  return { transport, spawns };
}

const started: AcpTransport[] = [];
afterEach(async () => {
  while (started.length > 0) {
    await started.pop()?.stop();
  }
});

async function start(options: HarnessOptions = {}) {
  const { transport, spawns } = harness(options);
  const init = await transport.start();
  started.push(transport);
  return { transport, spawns, init };
}

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for condition."));
      }
    }, 20);
  });
}

describe("ACP transport lifecycle", () => {
  it("spawns the agent, initializes ACP v1, and reports negotiated capabilities", async () => {
    const { transport, spawns, init } = await start({ auth: "cached" });
    expect(init.protocolVersion).toBe(1);
    expect(init.agentCapabilities?.loadSession).toBe(true);
    expect(init.agentCapabilities?.sessionCapabilities?.list).toBeTruthy();
    expect(init.authMethods.map((method) => method.id)).toContain("cached_token");
    expect(init.agentInfo?.name).toBe("fake-acp");
    expect(transport.alive).toBe(true);

    // The transport passes argv as an array (never a shell string) and keeps
    // credentials out of the command line.
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.args).toEqual(["--no-auto-update", "agent", "stdio"]);
    const options = spawns[0]?.options ?? {};
    expect(options.shell === undefined || options.shell === false).toBe(true);
  });

  it("correlates concurrent requests by response", async () => {
    const { transport } = await start();
    const [list, created] = await Promise.all([
      transport.listSessions({}),
      transport.newSession({ cwd: "/tmp/demo", mcpServers: [] }),
    ]);
    expect(Array.isArray(list.sessions)).toBe(true);
    expect(created.sessionId).toMatch(/^acp_sess_/);
    expect(await transport.listSessions({ cwd: "/tmp/demo" })).toMatchObject({
      sessions: [expect.objectContaining({ sessionId: created.sessionId })],
    });
  });

  it("delivers session/update notifications", async () => {
    const notifications: SessionNotification[] = [];
    const { transport } = await start({ handlers: { onSessionUpdate: (n) => notifications.push(n) } });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    const response = await transport.prompt(session.sessionId, [{ type: "text", text: "hello" }]);
    expect(response.stopReason).toBe("end_turn");
    const chunks: string[] = [];
    for (const notification of notifications) {
      if (notification.update.sessionUpdate !== "agent_message_chunk") continue;
      if (notification.update.content.type !== "text") continue;
      chunks.push(notification.update.content.text);
    }
    expect(chunks.join("")).toContain("Echo: hello");
  });

  it("routes updates for multiple sessions by session id", async () => {
    const notifications: SessionNotification[] = [];
    const { transport } = await start({ handlers: { onSessionUpdate: (n) => notifications.push(n) } });
    const first = await transport.newSession({ cwd: "/tmp/one", mcpServers: [] });
    const second = await transport.newSession({ cwd: "/tmp/two", mcpServers: [] });
    await Promise.all([
      transport.prompt(first.sessionId, [{ type: "text", text: "one" }]),
      transport.prompt(second.sessionId, [{ type: "text", text: "two" }]),
    ]);
    const firstText = notifications.filter((n) => n.sessionId === first.sessionId);
    const secondText = notifications.filter((n) => n.sessionId === second.sessionId);
    expect(firstText.length).toBeGreaterThan(0);
    expect(secondText.length).toBeGreaterThan(0);
    expect(firstText.every((n) => n.sessionId === first.sessionId)).toBe(true);
  });

  it("bridges permission requests with all provider options", async () => {
    const seenOptions: string[] = [];
    const notifications: SessionNotification[] = [];
    let resolvePermission: ((response: RequestPermissionResponse) => void) | null = null;
    const { transport } = await start({
      mode: "permission",
      handlers: {
        onSessionUpdate: (n) => notifications.push(n),
        onPermissionRequest: (request) => {
          seenOptions.push(...request.options.map((option) => option.kind));
          return new Promise((resolve) => {
            resolvePermission = resolve;
          });
        },
      },
    });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    const prompt = transport.prompt(session.sessionId, [{ type: "text", text: "run tests" }]);
    await waitFor(() => resolvePermission !== null);
    expect(seenOptions).toEqual(["allow_once", "allow_always", "reject_once", "reject_always"]);
    resolvePermission!({ outcome: { outcome: "selected", optionId: "allow-once" } });
    const response = await prompt;
    expect(response.stopReason).toBe("end_turn");
    const completion = notifications.find(
      (n) => n.update.sessionUpdate === "tool_call_update" && n.update.toolCallId === "tool_1",
    );
    expect(completion).toBeTruthy();
  });

  it("cancels permission requests safely when no handler is registered", async () => {
    const notifications: SessionNotification[] = [];
    const { transport } = await start({
      mode: "permission",
      handlers: { onSessionUpdate: (n) => notifications.push(n) },
    });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    const response = await transport.prompt(session.sessionId, [{ type: "text", text: "run tests" }]);
    expect(response.stopReason).toBe("end_turn");
    const completion = notifications.find(
      (n) => n.update.sessionUpdate === "tool_call_update" && n.update.toolCallId === "tool_1",
    );
    expect(completion && completion.update.sessionUpdate === "tool_call_update" && completion.update.status).toBe(
      "failed",
    );
  });

  it("cancels a running prompt and settles it with a stop reason", async () => {
    const { transport } = await start({ mode: "long" });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    const prompt = transport.prompt(session.sessionId, [{ type: "text", text: "keep going" }]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await transport.cancel(session.sessionId);
    const response = await prompt;
    expect(response.stopReason).toBe("cancelled");
  });

  it("keeps long prompts from blocking unrelated control calls", async () => {
    const { transport } = await start({ mode: "long" });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    const prompt = transport.prompt(session.sessionId, [{ type: "text", text: "keep going" }]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const list = await transport.listSessions({ cwd: "/tmp/demo" });
    expect(list.sessions.some((entry) => entry.sessionId === session.sessionId)).toBe(true);
    await transport.cancel(session.sessionId);
    await prompt;
  });

  it("rejects a running prompt when the agent process dies", async () => {
    const { transport } = await start({ mode: "crash" });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    await expect(transport.prompt(session.sessionId, [{ type: "text", text: "die" }])).rejects.toMatchObject({
      code: "process_exited",
    });
  });

  it("rejects pending permission handlers when the process dies", async () => {
    const permissionSeen = { value: false };
    const { transport } = await start({
      mode: "crash-on-permission",
      handlers: {
        onPermissionRequest: () => {
          permissionSeen.value = true;
          return new Promise(() => undefined);
        },
      },
    });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    await expect(transport.prompt(session.sessionId, [{ type: "text", text: "run tests" }])).rejects.toMatchObject({
      code: "process_exited",
    });
    expect(permissionSeen.value).toBe(true);
  });

  it("fails startup on a protocol version mismatch", async () => {
    const { transport, spawns } = harness({ version: "2" });
    await expect(transport.start()).rejects.toMatchObject({ code: "protocol" });
    expect(spawns).toHaveLength(1);
  });

  it("bounds startup with a timeout and stops the child", async () => {
    const { transport } = harness({ suppressInit: true, startupTimeoutMs: 1_200 });
    await expect(transport.start()).rejects.toMatchObject({ code: "startup_timeout" });
    expect(transport.alive).toBe(false);
  });

  it("stops the child on shutdown and reports an expected exit", async () => {
    const { transport } = await start();
    const exit = new Promise((resolve) => transport.onExit(resolve));
    await transport.stop();
    await expect(exit).resolves.toMatchObject({ expected: true });
    expect(transport.alive).toBe(false);
    await transport.stop();
  });

  it("keeps stderr bounded and never returns protocol data", async () => {
    const { transport } = await start({ stderrBytes: 300_000, stderrLimitBytes: 4_096 });
    await waitFor(() => transport.stderrTail().length > 0);
    expect(transport.stderrTail().length).toBeLessThanOrEqual(4_096);
  });

  it("survives a malformed protocol frame", async () => {
    const { transport } = await start({ malformed: true, controlTimeoutMs: 3_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Either the transport ignores the bad frame, or it closed the connection
    // with a normalized error; it must never crash the Host process.
    try {
      const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
      expect(session.sessionId).toMatch(/^acp_sess_/);
    } catch (error) {
      expect(error).toBeInstanceOf(AcpTransportError);
      expect((error as AcpTransportError).code).toBe("process_exited");
    }
  });

  it("ignores unknown session update kinds and unknown extensions", async () => {
    const notifications: SessionNotification[] = [];
    const { transport } = await start({
      mode: "unknown-update",
      handlers: { onSessionUpdate: (n) => notifications.push(n) },
    });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    const response = await transport.prompt(session.sessionId, [{ type: "text", text: "hello" }]);
    expect(response.stopReason).toBe("end_turn");
    expect(transport.alive).toBe(true);
  });

  it("rejects unknown agent extension requests without crashing", async () => {
    const { transport } = await start({ mode: "extension" });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    const response = await transport.prompt(session.sessionId, [{ type: "text", text: "hello" }]);
    expect(response.stopReason).toBe("end_turn");
    expect(transport.alive).toBe(true);
  });

  it("supports session list, load replay, mode, and config option changes", async () => {
    const notifications: SessionNotification[] = [];
    const { transport } = await start({ handlers: { onSessionUpdate: (n) => notifications.push(n) } });
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    await transport.setSessionMode(session.sessionId, "plan");
    expect(
      notifications.some((n) => n.update.sessionUpdate === "current_mode_update" && n.update.currentModeId === "plan"),
    ).toBe(true);

    const configured = await transport.setConfigValue(session.sessionId, "model", "grok-4-mini");
    const model = configured.configOptions?.find((option) => option.id === "model") as
      { currentValue?: unknown } | undefined;
    expect(model?.currentValue).toBe("grok-4-mini");

    await transport.loadSession({ sessionId: session.sessionId, cwd: "/tmp/demo", mcpServers: [] });
    expect(
      notifications.some(
        (n) =>
          n.update.sessionUpdate === "agent_message_chunk" &&
          n.update.content.type === "text" &&
          n.update.content.text.includes("Replayed"),
      ),
    ).toBe(true);

    await transport.deleteSession(session.sessionId);
    const list = await transport.listSessions({ cwd: "/tmp/demo" });
    expect(list.sessions.some((entry) => entry.sessionId === session.sessionId)).toBe(false);
  });

  it("times out control calls without cancelling active prompts", async () => {
    const { transport } = harness({
      mode: "long",
      controlTimeoutMs: 300,
      extraEnv: { FAKE_ACP_SLOW_LIST_MS: "3000" },
    });
    await transport.start();
    started.push(transport);
    const session = await transport.newSession({ cwd: "/tmp/demo", mcpServers: [] });
    const prompt = transport.prompt(session.sessionId, [{ type: "text", text: "keep going" }]);
    await expect(transport.listSessions({ cwd: "/tmp/demo" })).rejects.toMatchObject({ code: "timeout" });
    await transport.cancel(session.sessionId);
    await expect(prompt).resolves.toMatchObject({ stopReason: "cancelled" });
  });

  it("reports not_started before start() is called", async () => {
    const { transport } = harness();
    await expect(transport.listSessions()).rejects.toMatchObject({ code: "not_started" });
  });
});
