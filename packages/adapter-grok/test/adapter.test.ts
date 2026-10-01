import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  AdapterError,
  ExecutableFailure,
  createPublicId,
  createRecordingLogger,
  runExecutable,
  spawnExecutable,
  type RunExecutable,
  type SpawnExecutable,
} from "@homebase/adapter-sdk";
import { createTestAdapterContext } from "@homebase/adapter-sdk/testing";
import type { AgentEvent, AgentEventType } from "@homebase/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { GrokAdapter } from "../src/adapter.js";
import { parseGrokConfig } from "../src/config.js";
import { parseGrokVersion, versionCompatibility } from "../src/errors.js";

const FIXTURE = fileURLToPath(new URL("../../transport-acp/test/fixtures/fake-agent.mjs", import.meta.url));
const PROJECT_PATH = "/home/example/projects/demo";
const PROJECT_ID = "prj_demo";
const OTHER_PATH = "/home/example/projects/other";
const OTHER_ID = "prj_other";

describe("explicit consumption and account-limit support", () => {
  it("maps stable ACP context usage without synthesizing token consumption", async () => {
    const { adapter, context, project } = createHarness({
      auth: "cached",
      extraEnv: {
        FAKE_ACP_USAGE_UPDATE: JSON.stringify({
          sessionUpdate: "usage_update",
          used: 42,
          size: 100,
          cost: { amount: 0.02, currency: "USD" },
        }),
      },
    });
    try {
      await detectReady(adapter);
      const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
      await adapter.send(session.id, { text: "fake fixture only" });
      await context.waitForEvent("turn.completed");
      expect(await adapter.getSessionUsage(session.id)).toMatchObject({
        provider: "grok",
        sessionId: session.id,
        tokens: {},
        contextTokens: 42,
        contextWindow: 100,
        costUsd: 0.02,
        partial: true,
      });
      expect(eventsOf(context.events, "session.usage.updated")).toHaveLength(1);
      expect(await adapter.getProviderUsage()).toBeNull();
    } finally {
      await adapter.dispose();
    }
  });

  it.each([false, true])("queries only the advertised x.ai extension family (advertised=%s)", async (advertised) => {
    const { adapter, project } = createHarness({
      auth: "cached",
      extraEnv: {
        FAKE_ACP_META: JSON.stringify({ grokShell: advertised }),
        FAKE_ACP_EXTENSION_METHOD: "_x.ai/session/usage",
        FAKE_ACP_EXTENSION_RESULT: JSON.stringify({
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedReadTokens: 3, costUsdTicks: 800000000 },
        }),
      },
    });
    try {
      await detectReady(adapter);
      const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
      const usage = await adapter.getSessionUsage(session.id);
      if (advertised)
        expect(usage).toMatchObject({
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 3 },
          costUsd: 0.08,
          partial: true,
        });
      else expect(usage).toBeNull();
    } finally {
      await adapter.dispose();
    }
  });

  it("ignores unknown extension shapes and reports usage unavailable", async () => {
    const { adapter, project } = createHarness({
      auth: "cached",
      extraEnv: {
        FAKE_ACP_META: '{"grokShell":true}',
        FAKE_ACP_EXTENSION_METHOD: "_x.ai/session/usage",
        FAKE_ACP_EXTENSION_RESULT: '{"futureShape":{"secret":"not forwarded"}}',
      },
    });
    try {
      await detectReady(adapter);
      const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
      expect(await adapter.getSessionUsage(session.id)).toBeNull();
    } finally {
      await adapter.dispose();
    }
  });
});

interface HarnessOptions {
  mode?: string;
  auth?: string;
  versionOutput?: string;
  extraEnv?: Record<string, string>;
  config?: Record<string, unknown>;
  projects?: Record<string, string>;
  runFn?: RunExecutable;
  /** Override the default fixture spawner (for mutable auth-state tests). */
  spawnFn?: SpawnExecutable;
}

function createHarness(options: HarnessOptions = {}) {
  const recording = createRecordingLogger();
  const projects = options.projects ?? { [PROJECT_PATH]: PROJECT_ID, [OTHER_PATH]: OTHER_ID };
  const context = createTestAdapterContext({
    projectPath: PROJECT_PATH,
    projectId: PROJECT_ID,
    logger: recording.logger,
  });
  context.findProjectByPath = async (candidate: string) => projects[candidate] ?? null;

  const spawnFn: SpawnExecutable =
    options.spawnFn ??
    ((_command, args, spawnOptions) => {
      const env = {
        ...(spawnOptions?.env ?? {}),
        ...(options.mode !== undefined ? { FAKE_ACP_MODE: options.mode } : {}),
        ...(options.auth !== undefined ? { FAKE_ACP_AUTH: options.auth } : {}),
        ...(options.extraEnv ?? {}),
      };
      return spawnExecutable(process.execPath, [FIXTURE, ...args], { ...spawnOptions, env });
    });

  const runFn: RunExecutable = (command, args, runOptions) => {
    if (options.runFn) return options.runFn(command, args, runOptions);
    return runExecutable(process.execPath, [FIXTURE, ...args], {
      ...runOptions,
      env: {
        ...process.env,
        ...(options.versionOutput !== undefined ? { FAKE_ACP_VERSION_OUTPUT: options.versionOutput } : {}),
      },
    });
  };

  const adapter = new GrokAdapter({
    config: {
      executable: "grok",
      startupTimeoutMs: 8_000,
      controlTimeoutMs: 5_000,
      shutdownTimeoutMs: 1_000,
      ...options.config,
    },
    spawnFn,
    runFn,
  });
  adapter.init(context);
  const project = { id: PROJECT_ID, name: "demo", path: PROJECT_PATH, providersAvailable: ["grok"] };
  const otherProject = { id: OTHER_ID, name: "other", path: OTHER_PATH, providersAvailable: ["grok"] };
  return { adapter, context, recording, project, otherProject };
}

async function detectReady(adapter: GrokAdapter) {
  const detection = await adapter.detect();
  expect(detection.installed).toBe(true);
  return detection;
}

function eventsOf<T extends AgentEventType>(events: AgentEvent[], type: T): Array<Extract<AgentEvent, { type: T }>> {
  return events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("close", () => resolve()));
}

interface MutableGrokFixture {
  auth: string;
  mode: string;
  suppressInit: boolean;
  children: ChildProcess[];
  spawn: SpawnExecutable;
}

/** Mutable fake-auth fixture so a test can simulate `grok login` in place. */
function grokFixture(options: { auth?: string; mode?: string; holdFirst?: boolean } = {}): MutableGrokFixture {
  let holdNext = options.holdFirst ?? false;
  const fixture: MutableGrokFixture = {
    auth: options.auth ?? "interactive",
    mode: options.mode ?? "normal",
    suppressInit: false,
    children: [],
    spawn: (_command, args, spawnOptions) => {
      const env: NodeJS.ProcessEnv = {
        ...(spawnOptions?.env ?? {}),
        FAKE_ACP_MODE: fixture.mode,
        FAKE_ACP_AUTH: fixture.auth,
      };
      if (holdNext) env.FAKE_ACP_HOLD_ALIVE = "1";
      if (fixture.suppressInit) env.FAKE_ACP_SUPPRESS_INIT = "1";
      holdNext = false;
      const child = spawnExecutable(process.execPath, [FIXTURE, ...args], { ...spawnOptions, env });
      fixture.children.push(child);
      return child;
    },
  };
  return fixture;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function harness(options: HarnessOptions = {}) {
  const created = createHarness(options);
  cleanups.push(async () => created.adapter.dispose?.());
  return created;
}

describe("Grok detection", () => {
  it("reports a missing executable as not installed", async () => {
    const runFn: RunExecutable = () => Promise.reject(new ExecutableFailure("not_found", "missing"));
    const { adapter } = await harness({ runFn });
    const detection = await adapter.detect();
    expect(detection).toMatchObject({ installed: false, compatible: false });
    expect(detection.warning).toContain("Grok CLI was not found");
  });

  it("reports version, compatibility, and cached authentication", async () => {
    const { adapter } = await harness({ versionOutput: "grok 1.0.41 (abc) [alpha]", auth: "cached" });
    const detection = await adapter.detect();
    expect(detection).toMatchObject({ installed: true, authenticated: true, compatible: true, version: "1.0.41" });
    expect(JSON.stringify(detection)).not.toContain("@");
  });

  it("warns about newer-than-tested versions without failing", async () => {
    const { adapter } = await harness({ versionOutput: "grok 9.9.9 (abc) [alpha]" });
    const detection = await adapter.detect();
    expect(detection.compatible).toBe(true);
    expect(detection.warning).toContain("newer than the tested 1.0.41");
  });

  it("fails compatibility for pre-1.x releases", async () => {
    const { adapter } = await harness({ versionOutput: "grok 0.9.0 (abc)" });
    const detection = await adapter.detect();
    expect(detection).toMatchObject({ installed: true, compatible: false, version: "0.9.0" });
    expect(detection.warning).toContain("predates");
  });

  it("reports installed-but-signed-out with an actionable warning", async () => {
    const { adapter } = await harness({ auth: "interactive" });
    const detection = await adapter.detect();
    expect(detection).toMatchObject({ installed: true, authenticated: false });
    expect(detection.warning).toContain("grok login");
  });

  it("parses version output and applies the compatibility policy", () => {
    expect(parseGrokVersion("grok 1.0.41 (4220f3b224a6) [alpha]")).toBe("1.0.41");
    expect(parseGrokVersion("no version")).toBeNull();
    expect(versionCompatibility("1.0.41")).toEqual({ compatible: true });
    expect(versionCompatibility("1.1.0").warning).toContain("newer");
  });

  it("rejects unknown credential fields in provider configuration", () => {
    expect(() => parseGrokConfig({ xaiApiKey: "secret-value" })).toThrow(AdapterError);
    expect(() => parseGrokConfig({ executable: "grok" })).not.toThrow();
  });
});

describe("Grok capabilities", () => {
  it("maps ACP capabilities honestly", async () => {
    const { adapter } = await harness({ auth: "cached" });
    await detectReady(adapter);
    const capabilities = await adapter.getCapabilities();
    expect(capabilities).toMatchObject({
      streaming: true,
      interrupt: true,
      tools: true,
      approvals: true,
      plans: true,
      resume: true,
      deleteSession: true,
      models: true,
      modelSwitching: true,
      thinkingLevels: true,
      modes: true,
      steer: false,
      queue: false,
      questions: false,
      attachments: false,
      imageInput: false,
      diffs: false,
      providerUsage: false,
      slashCommands: false,
    });
  });

  it("lists the model and mode catalogs from the agent", async () => {
    const { adapter, project } = await harness({ auth: "cached" });
    await detectReady(adapter);
    const models = await adapter.listModels(project);
    expect(models.map((model) => model.id)).toEqual(["grok-4", "grok-4-mini"]);
    expect(models[0]?.thinkingLevels?.map((level) => level.id)).toEqual(["low", "high"]);
    const modes = await adapter.listModes(project);
    expect(modes.map((mode) => mode.id)).toEqual(["default", "plan"]);
  });
});

describe("Grok sessions", () => {
  it("creates sessions with provider-scoped public ids and scopes listing by project", async () => {
    const { adapter, project, otherProject } = await harness({ auth: "cached" });
    await detectReady(adapter);
    const created = await adapter.createSession({ provider: "grok", projectId: project.id, title: "hello" }, project);
    expect(created.id).toContain("hb1~grok~");
    expect(created.projectId).toBe(project.id);

    const other = await adapter.createSession({ provider: "grok", projectId: otherProject.id }, otherProject);
    const listed = await adapter.listSessions(project);
    expect(listed.items.map((session) => session.id)).toEqual([created.id]);
    expect(listed.items.some((session) => session.id === other.id)).toBe(false);

    const otherListed = await adapter.listSessions(otherProject);
    expect(otherListed.items.map((session) => session.id)).toEqual([other.id]);
  });

  it("rejects foreign provider ids and unknown sessions", async () => {
    const { adapter } = await harness({ auth: "cached" });
    await detectReady(adapter);
    await expect(adapter.getSession(createPublicId("opencode", "ses_1"))).rejects.toMatchObject({
      code: "session_not_found",
    });
    await expect(adapter.listMessages(createPublicId("grok", "ses_unknown"))).rejects.toMatchObject({
      code: "session_not_found",
    });
  });

  it("lists only sessions inside configured roots", async () => {
    const { adapter, project } = await harness({
      auth: "cached",
      extraEnv: { FAKE_ACP_SEED_SESSION_CWD: PROJECT_PATH, FAKE_ACP_SEED_OUTSIDE_CWD: "/outside/root" },
    });
    await detectReady(adapter);
    const listed = await adapter.listSessions(project);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.title).toBe("Seeded session");
  });

  it("replays history on load without emitting a live turn", async () => {
    const { adapter, context, project } = await harness({
      auth: "cached",
      extraEnv: { FAKE_ACP_SEED_SESSION_CWD: PROJECT_PATH },
    });
    await detectReady(adapter);
    const listed = await adapter.listSessions(project);
    const seeded = listed.items[0];
    expect(seeded).toBeDefined();
    context.clearEvents();

    const page = await adapter.listMessages(seeded!.id, { limit: 10 });
    const roles = page.items.map((message) => message.role);
    expect(roles).toEqual(["assistant", "user"]);
    const assistant = page.items[0];
    expect(assistant?.parts.some((part) => part.type === "reasoning")).toBe(true);
    expect(assistant?.parts.some((part) => part.type === "text")).toBe(true);
    const replayedUser = page.items[1];
    expect(replayedUser?.state).toBe("completed");
    expect(replayedUser?.parts).toEqual([{ type: "text", id: "p0", text: "Earlier question." }]);
    expect(eventsOf(context.events, "turn.started")).toHaveLength(0);
    expect(eventsOf(context.events, "message.delta")).toHaveLength(0);

    // Second read must not duplicate replayed history.
    const second = await adapter.listMessages(seeded!.id, { limit: 10 });
    expect(second.items).toHaveLength(2);
  });

  it("pages history with an opaque cursor", async () => {
    const { adapter, project } = await harness({
      auth: "cached",
      extraEnv: { FAKE_ACP_SEED_SESSION_CWD: PROJECT_PATH },
    });
    await detectReady(adapter);
    const seeded = (await adapter.listSessions(project)).items[0];
    const first = await adapter.listMessages(seeded!.id, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await adapter.listMessages(seeded!.id, { limit: 1, cursor: first.nextCursor ?? undefined });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });
});

describe("Grok turns", () => {
  it("streams text, reasoning, tools, and completes the turn", async () => {
    const { adapter, context, project } = await harness({ auth: "cached", mode: "tools" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "hello" });

    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 8_000);
    const events = context.events;
    expect(eventsOf(events, "turn.started").length).toBeGreaterThan(0);
    expect(eventsOf(events, "reasoning.delta").length).toBeGreaterThan(0);
    const textDeltas = eventsOf(events, "message.delta").map((event) => event.data.delta);
    expect(textDeltas.join("")).toContain("Echo: hello");
    const toolStarted = eventsOf(events, "tool.started")[0];
    expect(toolStarted?.data.toolCall.title).toBe("Run the test suite");
    expect(eventsOf(events, "tool.completed")).toHaveLength(1);
    const planEvents = eventsOf(events, "plan.updated");
    expect(planEvents[0]?.data.plan.steps.map((step) => step.status)).toEqual(["completed", "in_progress"]);
    expect(eventsOf(events, "message.completed").length).toBeGreaterThan(0);

    // listMessages reflects the finished turn.
    const page = await adapter.listMessages(session.id, { limit: 10 });
    expect(page.items.length).toBeGreaterThan(0);
    const assistant = page.items.find((message) => message.role === "assistant");
    expect(assistant?.parts.some((part) => part.type === "tool_call")).toBe(true);
  });

  it("rejects a second concurrent send for the same session", async () => {
    const { adapter, project, context } = await harness({ auth: "cached", mode: "long" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "first" });
    await expect(adapter.send(session.id, { text: "second" })).rejects.toMatchObject({ code: "conflict" });
    await adapter.interrupt(session.id);
    await context.waitForEvent("turn.interrupted", (event) => event.sessionId === session.id, 8_000);
  });

  it("fails the turn when the provider rejects the prompt", async () => {
    const { adapter, context, project } = await harness({ auth: "cached", mode: "fail" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "boom" });
    const failed = await context.waitForEvent("turn.failed", (event) => event.sessionId === session.id, 8_000);
    expect(failed.data.error.code).toBe("provider_error");
  });

  it("marks a crashed provider turn failed and never leaves the session working", async () => {
    const { adapter, context, project } = await harness({ auth: "cached", mode: "crash" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "die" });
    await context.waitForEvent("turn.failed", (event) => event.sessionId === session.id, 8_000);
    const current = await adapter.getSession(session.id);
    expect(current.state).not.toBe("working");
  });

  it("keeps the session usable after an interruption", async () => {
    const { adapter, context, project } = await harness({ auth: "cached", mode: "long" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "long" });
    await context.waitForEvent("turn.started", (event) => event.sessionId === session.id, 8_000);
    await adapter.interrupt(session.id);
    await context.waitForEvent("turn.interrupted", (event) => event.sessionId === session.id, 8_000);
    expect((await adapter.getSession(session.id)).state).not.toBe("working");

    context.clearEvents();
    await adapter.send(session.id, { text: "again" });
    await context.waitForEvent("turn.started", (event) => event.sessionId === session.id, 8_000);
    await adapter.interrupt(session.id);
  });
});

describe("Grok authoritative history", () => {
  it("records the submitted prompt even when the provider never live-echoes it", async () => {
    const { adapter, context, project } = await harness({ auth: "cached" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "fix the failing test" });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 8_000);

    const page = await adapter.listMessages(session.id, { limit: 10 });
    const users = page.items.filter((message) => message.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]?.state).toBe("completed");
    expect(users[0]?.parts).toEqual([{ type: "text", id: "p0", text: "fix the failing test" }]);
    expect(page.items.some((message) => message.role === "assistant")).toBe(true);
  });

  it("merges a provider live echo instead of duplicating the prompt", async () => {
    const { adapter, context, project } = await harness({
      auth: "cached",
      mode: "tools",
      extraEnv: { FAKE_ACP_ECHO_USER: "1" },
    });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "hello" });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 8_000);

    const page = await adapter.listMessages(session.id, { limit: 10 });
    const users = page.items.filter((message) => message.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]?.parts).toEqual([{ type: "text", id: "p0", text: "hello" }]);
  });

  it("merges a multi-chunk echo that carries no ACP message id", async () => {
    const { adapter, context, project } = await harness({
      auth: "cached",
      mode: "tools",
      extraEnv: { FAKE_ACP_ECHO_USER: "1", FAKE_ACP_ECHO_USER_SPLIT: "1" },
    });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "hello there" });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 8_000);

    const page = await adapter.listMessages(session.id, { limit: 10 });
    const users = page.items.filter((message) => message.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]?.parts).toEqual([{ type: "text", id: "p0", text: "hello there" }]);
  });

  it("keeps repeated identical prompts as separate messages", async () => {
    const { adapter, context, project } = await harness({ auth: "cached" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "hello" });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 8_000);
    await adapter.send(session.id, { text: "hello" });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 8_000);

    const page = await adapter.listMessages(session.id, { limit: 10 });
    const users = page.items.filter((message) => message.role === "user");
    expect(users).toHaveLength(2);
    expect(new Set(users.map((message) => message.id)).size).toBe(2);
    expect(users.every((message) => message.parts.some((part) => part.type === "text" && part.text === "hello"))).toBe(
      true,
    );
  });
});

describe("Grok approvals", () => {
  it("bridges permission requests with dynamic options and allow-once", async () => {
    const { adapter, context, project } = await harness({ auth: "cached", mode: "permission" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "run tests" });

    const requested = await context.waitForEvent(
      "approval.requested",
      (event) => event.sessionId === session.id,
      8_000,
    );
    const options = requested.data.approval.options;
    expect(options.map((option) => option.kind)).toEqual(["allow_once", "allow_always", "deny", "deny"]);
    expect(options.map((option) => option.id)).toEqual(["allow-once", "allow-always", "reject-once", "reject-always"]);

    await adapter.resolveApproval(requested.data.approval.id, { optionId: "allow-once" });
    await context.waitForEvent("approval.resolved", (event) => event.sessionId === session.id, 8_000);
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 8_000);
    expect(eventsOf(context.events, "tool.completed")).toHaveLength(1);
  });

  it("maps reject and allow-always choices exactly", async () => {
    for (const [choice, expected] of [
      ["reject-once", "fail"],
      ["allow-always", "complete"],
    ] as const) {
      const { adapter, context, project } = await harness({ auth: "cached", mode: "permission" });
      await detectReady(adapter);
      const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
      context.clearEvents();
      await adapter.send(session.id, { text: "run tests" });
      const requested = await context.waitForEvent(
        "approval.requested",
        (event) => event.sessionId === session.id,
        8_000,
      );
      await adapter.resolveApproval(requested.data.approval.id, { optionId: choice });
      await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 8_000);
      if (expected === "fail") {
        expect(eventsOf(context.events, "tool.failed")).toHaveLength(1);
      } else {
        expect(eventsOf(context.events, "tool.completed")).toHaveLength(1);
      }
    }
  });

  it("cancels pending approvals on interrupt", async () => {
    const { adapter, context, project } = await harness({ auth: "cached", mode: "permission-hold" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "hold" });
    const requested = await context.waitForEvent(
      "approval.requested",
      (event) => event.sessionId === session.id,
      8_000,
    );

    await adapter.interrupt(session.id);
    await context.waitForEvent("turn.interrupted", (event) => event.sessionId === session.id, 8_000);
    const resolved = await context.waitForEvent("approval.resolved", (event) => event.sessionId === session.id, 8_000);
    expect(resolved.data.resolution.resolvedBy).toBe("system");
    await expect(adapter.resolveApproval(requested.data.approval.id, { optionId: "allow-once" })).rejects.toMatchObject(
      { code: "not_found" },
    );
  });

  it("rejects unknown approval ids and options", async () => {
    const { adapter, context, project } = await harness({ auth: "cached", mode: "permission" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "run tests" });
    const requested = await context.waitForEvent(
      "approval.requested",
      (event) => event.sessionId === session.id,
      8_000,
    );
    await expect(
      adapter.resolveApproval(requested.data.approval.id, { optionId: "not-a-real-option" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(adapter.resolveApproval("hb1~grok~bWlzc2luZw", { optionId: "allow-once" })).rejects.toMatchObject({
      code: "not_found",
    });
    await adapter.resolveApproval(requested.data.approval.id, { optionId: "reject-once" });
  });
});

describe("Grok model and mode controls", () => {
  it("switches model, thinking level, and mode through ACP config options", async () => {
    const { adapter, context, project } = await harness({ auth: "cached" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    expect(session.model?.modelId).toBe("grok-4");

    await adapter.setModel(session.id, { modelId: "grok-4-mini", thinkingLevel: "high" });
    const updated = await adapter.getSession(session.id);
    expect(updated.model?.modelId).toBe("grok-4-mini");
    expect(updated.thinkingLevel).toBe("high");

    await adapter.setMode(session.id, { mode: "plan" });
    expect((await adapter.getSession(session.id)).mode).toBe("plan");
    expect(eventsOf(context.events, "session.updated").length).toBeGreaterThan(0);
  });
});

describe("Grok session state", () => {
  it("uses unknown for cold discovered sessions and idle for created ones", async () => {
    const { adapter, project } = await harness({
      auth: "cached",
      extraEnv: { FAKE_ACP_SEED_SESSION_CWD: PROJECT_PATH },
    });
    await detectReady(adapter);
    const listed = await adapter.listSessions(project);
    expect(listed.items[0]?.state).toBe("unknown");

    const created = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    expect(created.state).toBe("idle");
  });

  it("resolves a cold session's state only through Homebase's own turn lifecycle", async () => {
    const { adapter, context, project } = await harness({
      auth: "cached",
      extraEnv: { FAKE_ACP_SEED_SESSION_CWD: PROJECT_PATH },
    });
    await detectReady(adapter);
    const seeded = (await adapter.listSessions(project)).items[0];
    expect(seeded?.state).toBe("unknown");
    context.clearEvents();

    await adapter.send(seeded!.id, { text: "hello" });
    await context.waitForEvent("turn.started", (event) => event.sessionId === seeded!.id, 8_000);
    expect((await adapter.getSession(seeded!.id)).state).toBe("working");
    await context.waitForEvent("turn.completed", (event) => event.sessionId === seeded!.id, 8_000);
    expect((await adapter.getSession(seeded!.id)).state).toBe("idle");
  });

  it("reports waiting while an approval is pending, then idle after resolution", async () => {
    const { adapter, context, project } = await harness({ auth: "cached", mode: "permission" });
    await detectReady(adapter);
    const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
    context.clearEvents();
    await adapter.send(session.id, { text: "run tests" });
    const requested = await context.waitForEvent(
      "approval.requested",
      (event) => event.sessionId === session.id,
      8_000,
    );
    expect((await adapter.getSession(session.id)).state).toBe("waiting");

    await adapter.resolveApproval(requested.data.approval.id, { optionId: "allow-once" });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 8_000);
    expect((await adapter.getSession(session.id)).state).toBe("idle");
  });
});

describe("Grok authentication refresh", () => {
  async function signOut(adapter: GrokAdapter) {
    const signedOut = await adapter.detect();
    expect(signedOut).toMatchObject({ installed: true, authenticated: false });
    return signedOut;
  }

  it("recovers sequentially after `grok login` through one bounded recycle", async () => {
    const fixture = grokFixture();
    const { adapter } = await harness({ spawnFn: fixture.spawn });
    try {
      await signOut(adapter);
      expect(fixture.children).toHaveLength(1);

      // The user runs `grok login` on the Host; the next explicit refresh must
      // recycle the unauthenticated ACP process and re-initialize.
      fixture.auth = "cached";
      const recovered = await adapter.detect();
      expect(recovered).toMatchObject({ installed: true, authenticated: true });
      expect(fixture.children).toHaveLength(2);
      await waitForExit(fixture.children[0]!);

      // A healthy authenticated transport is not restarted by further refreshes.
      const stable = await adapter.detect();
      expect(stable.authenticated).toBe(true);
      expect(fixture.children).toHaveLength(2);
    } finally {
      await adapter.dispose();
      for (const child of fixture.children) await waitForExit(child);
      expect(fixture.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
    }
  });

  it("Host-style concurrent detect/getCapabilities starts exactly one replacement", async () => {
    const fixture = grokFixture({ holdFirst: true });
    const { adapter } = await harness({ spawnFn: fixture.spawn });
    try {
      await signOut(adapter);
      expect(fixture.children).toHaveLength(1);

      fixture.auth = "cached";
      // Exactly what ProviderRegistry.#probeProvider does.
      const [detection, capabilities] = await Promise.all([adapter.detect(), adapter.getCapabilities()]);

      expect(detection).toMatchObject({ installed: true, authenticated: true, compatible: true });
      expect(capabilities).toMatchObject({
        streaming: true,
        interrupt: true,
        tools: true,
        approvals: true,
        models: true,
        modes: true,
      });
      expect(fixture.children).toHaveLength(2);
    } finally {
      await adapter.dispose();
      for (const child of fixture.children) await waitForExit(child);
      expect(fixture.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
    }
  });

  it("a stale exit from the recycled process cannot clear the replacement", async () => {
    const fixture = grokFixture({ holdFirst: true });
    const { adapter, project } = await harness({ spawnFn: fixture.spawn });
    try {
      await signOut(adapter);
      fixture.auth = "cached";
      await Promise.all([adapter.detect(), adapter.getCapabilities()]);
      expect(fixture.children).toHaveLength(2);

      // Let the recycled process finish exiting, then verify the replacement
      // still owns the adapter's process-specific state.
      const oldProcess = fixture.children[0]!;
      await waitForExit(oldProcess);
      expect(oldProcess.exitCode !== null || oldProcess.signalCode !== null).toBe(true);

      const capabilities = await adapter.getCapabilities();
      expect(capabilities).toMatchObject({ streaming: true, models: true, modes: true });
      expect((await adapter.listModels(project)).map((model) => model.id)).toEqual(["grok-4", "grok-4-mini"]);
      expect((await adapter.listModes(project)).map((mode) => mode.id)).toEqual(["default", "plan"]);

      // A safe ACP control call still succeeds through the replacement and does
      // not force another reconnect.
      const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
      expect(session.provider).toBe("grok");
      expect((await adapter.getSession(session.id)).state).toBe("idle");
      expect(fixture.children).toHaveLength(2);

      const stable = await adapter.detect();
      expect(stable).toMatchObject({ installed: true, authenticated: true });
      expect(fixture.children).toHaveLength(2);
    } finally {
      await adapter.dispose();
      for (const child of fixture.children) await waitForExit(child);
      expect(fixture.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
    }
  });

  it("concurrent detect calls share one replacement process", async () => {
    const fixture = grokFixture();
    const { adapter } = await harness({ spawnFn: fixture.spawn });
    try {
      await signOut(adapter);
      fixture.auth = "cached";
      const [first, second] = await Promise.all([adapter.detect(), adapter.detect()]);
      expect(first.authenticated).toBe(true);
      expect(second.authenticated).toBe(true);
      expect(fixture.children).toHaveLength(2);

      const third = await adapter.detect();
      expect(third.authenticated).toBe(true);
      expect(fixture.children).toHaveLength(2);
    } finally {
      await adapter.dispose();
      for (const child of fixture.children) await waitForExit(child);
      expect(fixture.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
    }
  });

  it("keeps a coherent state when the replacement connection fails, and can retry later", async () => {
    const fixture = grokFixture();
    const { adapter } = await harness({ spawnFn: fixture.spawn, config: { startupTimeoutMs: 1_200 } });
    try {
      await signOut(adapter);
      expect(fixture.children).toHaveLength(1);

      fixture.auth = "cached";
      fixture.suppressInit = true;
      const failed = await adapter.detect();
      expect(failed).toMatchObject({ installed: true, authenticated: null, compatible: false });
      expect(failed.warning).toBeTruthy();
      expect(fixture.children).toHaveLength(2);

      // No zombie single-flight/refresh promises: a later explicit refresh may
      // establish a fresh connection.
      fixture.suppressInit = false;
      const recovered = await adapter.detect();
      expect(recovered).toMatchObject({ installed: true, authenticated: true, compatible: true });
      expect(fixture.children).toHaveLength(3);
    } finally {
      await adapter.dispose();
      for (const child of fixture.children) await waitForExit(child);
      expect(fixture.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
    }
  });

  it("dispose during an in-flight connection leaves no process", async () => {
    const fixture = grokFixture();
    fixture.suppressInit = true;
    const { adapter } = await harness({ spawnFn: fixture.spawn, config: { startupTimeoutMs: 1_200 } });

    // Start a connection that cannot complete, then dispose while it is busy.
    const inFlight = adapter.detect();
    const spawnDeadline = Date.now() + 5_000;
    while (fixture.children.length === 0 && Date.now() < spawnDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(fixture.children).toHaveLength(1);

    await adapter.dispose();
    await expect(inFlight).resolves.toMatchObject({ compatible: false });
    for (const child of fixture.children) await waitForExit(child);
    expect(fixture.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
  });

  it("never recycles the transport while a model turn is active", async () => {
    const fixture = grokFixture({ mode: "long" });
    const { adapter, context, project } = await harness({ spawnFn: fixture.spawn });
    try {
      const signedOut = await adapter.detect();
      expect(signedOut.authenticated).toBe(false);
      const session = await adapter.createSession({ provider: "grok", projectId: project.id }, project);
      context.clearEvents();
      await adapter.send(session.id, { text: "long" });
      await context.waitForEvent("turn.started", (event) => event.sessionId === session.id, 8_000);

      const duringTurn = await adapter.detect();
      expect(duringTurn.authenticated).toBe(false);
      expect(fixture.children).toHaveLength(1);

      await adapter.interrupt(session.id);
      await context.waitForEvent("turn.interrupted", (event) => event.sessionId === session.id, 8_000);
    } finally {
      await adapter.dispose();
      for (const child of fixture.children) await waitForExit(child);
    }
  });
});
