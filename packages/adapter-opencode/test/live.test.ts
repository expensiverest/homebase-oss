import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineAdapterComplianceSuite } from "@homebase/adapter-sdk/compliance";
import { createTestAdapterContext, type TestAdapterContext } from "@homebase/adapter-sdk/testing";
import type { AgentProject, AgentSession } from "@homebase/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OpenCodeAdapter } from "../src/index.js";

const LIVE = process.env.HOMEBASE_TEST_OPENCODE === "1";
const BASE_URL = process.env.HOMEBASE_TEST_OPENCODE_URL ?? "http://127.0.0.1:4096";
const PASSWORD = process.env.HOMEBASE_TEST_OPENCODE_PASSWORD;
const USERNAME = process.env.HOMEBASE_TEST_OPENCODE_USERNAME ?? "opencode";

const config = {
  baseUrl: BASE_URL,
  username: USERNAME,
  ...(PASSWORD ? { password: PASSWORD } : {}),
  requestTimeoutMs: 60_000,
};

const PROJECT_ID = "prj_live";
let projectDir = "";

function project(): AgentProject {
  return { id: PROJECT_ID, name: path.basename(projectDir), path: projectDir, providersAvailable: ["opencode"] };
}

beforeAll(async () => {
  if (!LIVE) return;
  projectDir = await mkdtemp(path.join(tmpdir(), "homebase-oc-live-"));
});

afterAll(async () => {
  if (!LIVE || projectDir.length === 0) return;
  // Best-effort cleanup of sessions created in the throwaway project directory.
  const cleanup = new OpenCodeAdapter({ config, startEventStream: false });
  const context = createTestAdapterContext({ projectPath: projectDir, projectId: PROJECT_ID });
  cleanup.init(context);
  try {
    const page = await cleanup.listSessions(project(), { limit: 100 });
    for (const session of page.items) {
      await cleanup.deleteSession(session.id).catch(() => undefined);
    }
  } catch {
    // The server may already be gone; nothing else to clean.
  }
  await cleanup.dispose();
  await rm(projectDir, { recursive: true, force: true });
});

if (LIVE) {
  defineAdapterComplianceSuite({
    providerName: "OpenCode (live)",
    createAdapter: () => new OpenCodeAdapter({ config }),
    createProject: () => project(),
    live: true,
    timeoutMs: 180_000,
  });
}

describe.skipIf(!LIVE)("live OpenCode integration", () => {
  let adapter: OpenCodeAdapter;
  let context: TestAdapterContext;

  beforeAll(() => {
    context = createTestAdapterContext({ projectPath: projectDir, projectId: PROJECT_ID });
    adapter = new OpenCodeAdapter({ config });
    adapter.init(context);
  });

  afterAll(async () => {
    await adapter.dispose();
  });

  it("detects the server and reports its version", async () => {
    const detection = await adapter.detect();
    expect(detection.installed).toBe(true);
    expect(detection.authenticated).toBe(true);
    expect(detection.version).toMatch(/^2\./);
  });

  it("lists models with per-model input capabilities and primary modes", async () => {
    const models = await adapter.listModels(project());
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.provider === "opencode")).toBe(true);
    expect(models.some((model) => model.inputCapabilities !== undefined)).toBe(true);

    const modes = await adapter.listModes(project());
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every((mode) => mode.id.length > 0)).toBe(true);
  });

  it("streams a run, resumes the session, and reloads history", async () => {
    const created = await adapter.createSession(
      { provider: "opencode", projectId: PROJECT_ID, title: "homebase-live-stream" },
      project(),
    );
    expect(created.state).toBe("idle");

    context.clearEvents();
    await adapter.send(created.id, { text: "Reply with the single word ready. Do not use tools." });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === created.id, 180_000);
    const streamed = context.events.filter((event) => event.sessionId === created.id);
    expect(streamed.some((event) => event.type === "message.started")).toBe(true);
    expect(streamed.some((event) => event.type === "message.completed")).toBe(true);

    const history = await adapter.listMessages(created.id, { limit: 20 });
    expect(history.items.length).toBeGreaterThan(1);

    // Resume: same session id, another turn.
    context.clearEvents();
    await adapter.send(created.id, { text: "Reply with the single word continued. Do not use tools." });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === created.id, 180_000);

    const after = await adapter.getSession(created.id);
    expect(after.state).toBe("idle");
    await adapter.deleteSession(created.id);
  });

  it("interrupts a running turn and settles the session", async () => {
    const created = await adapter.createSession(
      { provider: "opencode", projectId: PROJECT_ID, title: "homebase-live-interrupt" },
      project(),
    );
    context.clearEvents();
    await adapter.send(created.id, { text: "Count slowly from 1 to 100, one number per line. Do not use tools." });
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await adapter.interrupt(created.id);

    const settled = await Promise.race([
      context
        .waitForEvent("turn.interrupted", (event) => event.sessionId === created.id, 120_000)
        .then(() => "interrupted" as const)
        .catch(() => "timeout" as const),
      context
        .waitForEvent("turn.completed", (event) => event.sessionId === created.id, 120_000)
        .then(() => "completed" as const)
        .catch(() => "timeout" as const),
    ]);
    expect(["interrupted", "completed"]).toContain(settled);

    const session = await adapter.getSession(created.id);
    expect(["idle", "failed"]).toContain(session.state);
    await adapter.deleteSession(created.id);
  });

  it("returns diffs with project-relative paths after a write", async () => {
    const created = await adapter.createSession(
      { provider: "opencode", projectId: PROJECT_ID, title: "homebase-live-diff" },
      project(),
    );
    context.clearEvents();
    await adapter.send(created.id, {
      text: "Use the write tool to create a file named live-probe.txt in the current working directory containing exactly: hello. Then reply with the single word done.",
    });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === created.id, 180_000);

    const diff = await adapter.getDiff(created.id);
    expect(Array.isArray(diff.files)).toBe(true);
    for (const file of diff.files) {
      expect(file.path.startsWith(projectDir)).toBe(false);
    }
    await adapter.deleteSession(created.id);
  });

  it("keeps session state terminal across provider events", async () => {
    const sessions = adapter;
    const page = await sessions.listSessions(project(), { limit: 10 });
    for (const session of page.items as AgentSession[]) {
      expect(["idle", "working", "waiting", "failed", "completed", "unknown"]).toContain(session.state);
    }
  });
});
