import { createServer } from "node:net";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";

import { defineAdapterComplianceSuite } from "@homebase/adapter-sdk/compliance";
import { createTestAdapterContext } from "@homebase/adapter-sdk/testing";
import type { AgentProject } from "@homebase/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../src/index.js";
import { askApprovalChannel, encodeChannelLine, type ApprovalDecision } from "../src/permissions/channel-protocol.js";

const fakeCli = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

function createFakeAdapter(): { adapter: ClaudeAdapter; configDir: string } {
  const configDir = mkdtempSync(path.join(tmpdir(), "hb-claude-fake-"));
  const adapter = new ClaudeAdapter({
    config: {
      executable: process.execPath,
      configDir,
      idleTimeoutMs: 60_000,
      startupTimeoutMs: 20_000,
      controlTimeoutMs: 5_000,
      approvalTimeoutMs: 10_000,
    },
    launchPrefix: [fakeCli],
    extraEnv: { CLAUDE_CONFIG_DIR: configDir },
    mcpServerPath: fakeCli,
  });
  return { adapter, configDir };
}

const projectDir = mkdtempSync(path.join(tmpdir(), "hb-claude-project-"));
const project: AgentProject = { id: "prj_claude", name: "demo", path: projectDir, providersAvailable: ["claude"] };

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

defineAdapterComplianceSuite({
  providerName: "Claude (fake CLI)",
  createAdapter: () => createFakeAdapter().adapter,
  createProject: () => project,
  live: true,
  timeoutMs: 30_000,
});

describe("Claude adapter against the fake CLI", () => {
  it("detects the fake CLI version and authentication", async () => {
    const { adapter } = createFakeAdapter();
    const detection = await adapter.detect();
    expect(detection.installed).toBe(true);
    expect(detection.compatible).toBe(true);
    await adapter.dispose();
  });

  it("streams a turn and reloads history from the transcript", async () => {
    const { adapter } = createFakeAdapter();
    const context = createTestAdapterContext({ projectPath: projectDir, projectId: project.id });
    adapter.init(context);
    const session = await adapter.createSession({ provider: "claude", projectId: project.id, title: "fake" }, project);
    await adapter.send(session.id, { text: "hello there" });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 20_000);

    const history = await adapter.listMessages(session.id, { limit: 20 });
    expect(history.items.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(history.items)).toContain("fake reply to: hello there");
    expect(history.items.every((message) => message.sessionId === session.id)).toBe(true);

    const listed = await adapter.listSessions(project, { limit: 10 });
    expect(listed.items.some((entry) => entry.id === session.id)).toBe(true);
    await adapter.dispose();
  });

  it("interrupts a slow run and keeps the session resumable", async () => {
    const { adapter } = createFakeAdapter();
    const context = createTestAdapterContext({ projectPath: projectDir, projectId: project.id });
    adapter.init(context);
    const session = await adapter.createSession(
      { provider: "claude", projectId: project.id, title: "interrupt" },
      project,
    );
    await adapter.send(session.id, { text: "slow counting task" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await adapter.interrupt(session.id);
    const terminal = await Promise.race([
      context
        .waitForEvent("turn.interrupted", undefined, 10_000)
        .then(() => "interrupted" as const)
        .catch(() => "timeout" as const),
      context
        .waitForEvent("turn.completed", undefined, 10_000)
        .then(() => "completed" as const)
        .catch(() => "timeout" as const),
    ]);
    expect(["interrupted", "completed"]).toContain(terminal);

    await adapter.send(session.id, { text: "follow-up after interrupt" });
    await context.waitForEvent("turn.completed", (event) => event.sessionId === session.id, 20_000);
    await adapter.dispose();
  });

  it("rejects foreign and malformed session ids", async () => {
    const { adapter } = createFakeAdapter();
    const context = createTestAdapterContext({ projectPath: projectDir, projectId: project.id });
    adapter.init(context);
    await expect(adapter.getSession("hb1~opencode~c2FtZQ")).rejects.toMatchObject({ code: "session_not_found" });
    await expect(adapter.getSession("not-a-public-id")).rejects.toMatchObject({ code: "session_not_found" });
    await adapter.dispose();
  });

  it("round-trips approvals through the loopback channel", async () => {
    // A stand-in for the MCP server side: connect, ask, receive a decision.
    const decisions: ApprovalDecision[] = [{ behavior: "allow", updatedInput: { file_path: "a.ts" } }];
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const index = buffer.indexOf("\n");
        if (index < 0) return;
        socket.end(
          encodeChannelLine({ type: "decision", decision: decisions[0] ?? { behavior: "deny", message: "none" } }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const decision = await askApprovalChannel(
      port,
      "token",
      { sessionId: "session", toolName: "Write", input: { file_path: "a.ts" }, toolUseId: "toolu_1" },
      5_000,
    );
    expect(decision).toEqual({ behavior: "allow", updatedInput: { file_path: "a.ts" } });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("times out and denies when the channel never answers", async () => {
    const serverSockets = new Set<Socket>();
    const stalled = createServer((socket) => {
      serverSockets.add(socket);
    });
    await new Promise<void>((resolve) => stalled.listen(0, "127.0.0.1", resolve));
    const address = stalled.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await expect(
      askApprovalChannel(port, "token", { sessionId: "s", toolName: "Write", input: {}, toolUseId: null }, 300),
    ).rejects.toThrowError(/timed out/i);
    for (const socket of serverSockets) socket.destroy();
    await new Promise<void>((resolve) => stalled.close(() => resolve()));
  });
});
