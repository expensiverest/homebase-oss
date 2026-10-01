import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createTestAdapterContext, type TestAdapterContext } from "@homebase/adapter-sdk/testing";
import type { AgentProject, AgentSession } from "@homebase/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fileURLToPath } from "node:url";
import { ClaudeAdapter, resolveClaudeConfigDir, encodeProjectDir } from "../src/index.js";

const LIVE = process.env.HOMEBASE_TEST_CLAUDE === "1";
const EXECUTABLE = process.env.HOMEBASE_TEST_CLAUDE_EXECUTABLE ?? "claude";
const configDir = resolveClaudeConfigDir(undefined);
const projectDir = LIVE ? mkdtempSync(path.join(tmpdir(), "homebase-claude-live-")) : "";

const project = (): AgentProject => ({
  id: "prj_claude_live",
  name: path.basename(projectDir),
  path: projectDir,
  providersAvailable: ["claude"],
});

describe.skipIf(!LIVE)("live Claude integration", { timeout: 300_000 }, () => {
  let adapter: ClaudeAdapter;
  let context: TestAdapterContext;

  beforeAll(() => {
    context = createTestAdapterContext({ projectPath: projectDir, projectId: "prj_claude_live" });
    adapter = new ClaudeAdapter({
      mcpServerPath: fileURLToPath(new URL("../dist/permissions/mcp-server.js", import.meta.url)),
      config: {
        executable: EXECUTABLE,
        idleTimeoutMs: 60_000,
        startupTimeoutMs: 30_000,
        controlTimeoutMs: 15_000,
        approvalTimeoutMs: 120_000,
      },
      extraEnv: process.env.HOMEBASE_TEST_CLAUDE_CONFIG_DIR
        ? { CLAUDE_CONFIG_DIR: process.env.HOMEBASE_TEST_CLAUDE_CONFIG_DIR }
        : {},
    });
    adapter.init(context);
  });

  afterAll(async () => {
    await adapter.dispose();
    // Children may still be releasing their cwd on Windows; best effort cleanup.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    try {
      rmSync(path.join(configDir, "projects", encodeProjectDir(projectDir)), { recursive: true, force: true });
    } catch {
      // best effort
    }
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("detects the installed CLI and never exposes account identity", async () => {
    const detection = await adapter.detect();
    expect(detection.installed).toBe(true);
    expect(detection.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof detection.authenticated).toBe("boolean");
    const serialized = JSON.stringify(detection).toLowerCase();
    for (const forbidden of ["email", "orgid", "organization", "token", "api_key", "@"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("lists models with real effort levels and safe modes", async () => {
    const models = await adapter.listModels(project());
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.provider === "claude")).toBe(true);

    const modes = await adapter.listModes(project());
    expect(modes.map((mode) => mode.id)).toEqual(["default", "acceptEdits", "plan", "auto"]);
  });

  it("streams a turn, reloads history, and resumes the session", async () => {
    const session = await adapter.createSession(
      { provider: "claude", projectId: "prj_claude_live", title: "homebase-live-stream" },
      project(),
    );

    context.clearEvents();
    await adapter.send(session.id, { text: "Reply with the single word ready. Do not use tools." });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 180_000);

    let historyText = "";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const history = await adapter.listMessages(session.id, { limit: 20 });
      historyText = JSON.stringify(history.items);
      if (/ready/i.test(historyText)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(historyText.toLowerCase()).toContain("ready");

    context.clearEvents();
    await adapter.send(session.id, { text: "Reply with the single word continued. Do not use tools." });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 180_000);
    const after = await adapter.getSession(session.id);
    expect(after.state).toBe("idle");
  });

  it("interrupts a slow run and recovers afterwards", async () => {
    const session = await adapter.createSession(
      { provider: "claude", projectId: "prj_claude_live", title: "homebase-live-interrupt" },
      project(),
    );
    context.clearEvents();
    await adapter.send(session.id, { text: "Count slowly from 1 to 50, one number per line. Do not use tools." });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await adapter.interrupt(session.id);

    const terminal = await Promise.race([
      context
        .waitForEvent("turn.interrupted", (event) => event.sessionId === session.id, 90_000)
        .then(() => "interrupted" as const)
        .catch(() => "timeout" as const),
      context
        .waitForEvent("turn.completed", (event) => event.sessionId === session.id, 90_000)
        .then(() => "completed" as const)
        .catch(() => "timeout" as const),
    ]);
    expect(["interrupted", "completed"]).toContain(terminal);

    context.clearEvents();
    await adapter.send(session.id, { text: "Reply with the single word recovered. Do not use tools." });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 180_000);
  });

  it("handles a Write approval through the MCP broker", async () => {
    const session = await adapter.createSession(
      { provider: "claude", projectId: "prj_claude_live", title: "homebase-live-approval" },
      project(),
    );
    context.clearEvents();
    await adapter.send(session.id, {
      text: "Use the Write tool to create a file named live-probe.txt in the current working directory containing exactly: hello. Then reply with the single word done.",
    });

    const approval = await context
      .waitForEvent("approval.requested", (event) => event.sessionId === session.id, 90_000)
      .catch(() => null);
    if (approval) {
      await adapter.resolveApproval(approval.data.approval.id, { optionId: "allow_once" });
    }
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 180_000);
    expect(existsSync(path.join(projectDir, "live-probe.txt"))).toBe(true);
  });

  it("answers an AskUserQuestion through the MCP broker", async () => {
    const session = await adapter.createSession(
      { provider: "claude", projectId: "prj_claude_live", title: "homebase-live-question" },
      project(),
    );
    context.clearEvents();
    await adapter.send(session.id, {
      text: "Use the AskUserQuestion tool to ask me to choose a color between 'red' and 'blue'. Then reply with the chosen color.",
    });

    const question = await context
      .waitForEvent("question.requested", (event) => event.sessionId === session.id, 90_000)
      .catch(() => null);
    if (!question) {
      // The user's permission configuration may disable the question tool.
      return;
    }
    const first = question.data.question.questions[0];
    const option = first?.options?.[0]?.id;
    await adapter.answerQuestion(question.data.question.id, {
      answers: [{ questionId: first?.id ?? "q0", ...(option ? { selectedOptionIds: [option] } : { text: "red" }) }],
    });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 180_000);
  });

  it("reports subscription usage windows from structured rate-limit data", async () => {
    const usage = await adapter.getProviderUsage();
    expect(usage).not.toBeNull();
    expect(usage?.provider).toBe("claude");
    expect(usage?.windows.length ?? 0).toBeGreaterThan(0);
    expect(usage?.windows[0]?.unit).toBe("percent");
  });

  it("keeps session listing scoped to the project", async () => {
    const page = await adapter.listSessions(project(), { limit: 10 });
    for (const session of page.items as AgentSession[]) {
      expect(session.provider).toBe("claude");
      expect(session.projectId).toBe("prj_claude_live");
    }
  });
});
