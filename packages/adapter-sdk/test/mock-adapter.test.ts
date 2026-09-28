import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProject } from "@homebase/protocol";

import { AdapterError } from "../src/errors.js";
import { MockAdapter } from "../src/testing/mock-adapter.js";
import { createTestAdapterContext, type TestAdapterContext } from "../src/testing/context.js";

const PROJECT: AgentProject = {
  id: "prj_test",
  name: "test-project",
  path: "/tmp/homebase-test-project",
  providersAvailable: ["mock"],
};

describe("MockAdapter", () => {
  let adapter: MockAdapter;
  let context: TestAdapterContext;

  beforeEach(async () => {
    adapter = new MockAdapter({ stepDelayMs: 0 });
    context = createTestAdapterContext({ projectPath: PROJECT.path });
    adapter.init(context);
  });

  it("reports detection and capabilities", async () => {
    const detection = await adapter.detect();
    expect(detection).toMatchObject({ installed: true, authenticated: true, compatible: true });

    const capabilities = await adapter.getCapabilities();
    expect(capabilities.streaming).toBe(true);
    expect(capabilities.approvals).toBe(true);
    expect(capabilities.slashCommands).toBe(false);
  });

  it("creates sessions scoped to a project and emits session.created", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id, title: "hello" }, PROJECT);
    expect(session.state).toBe("idle");
    expect(session.projectId).toBe(PROJECT.id);

    const created = context.events.find((event) => event.type === "session.created");
    expect(created).toBeDefined();

    const listed = await adapter.listSessions(PROJECT);
    expect(listed.map((entry) => entry.id)).toContain(session.id);
  });

  it("streams a full turn as normalized events", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    context.clearEvents();
    await adapter.send(session.id, { text: "hello there" });
    await context.waitForEvent("turn.completed");

    const types = context.events.map((event) => event.type);
    expect(types).toContain("turn.started");
    expect(types).toContain("message.started");
    expect(types).toContain("message.delta");
    expect(types).toContain("tool.started");
    expect(types).toContain("tool.completed");
    expect(types).toContain("message.completed");
    expect(types).toContain("session.updated");

    const finalMessage = context.events.find((event) => event.type === "message.completed");
    expect(finalMessage?.type).toBe("message.completed");
    if (finalMessage?.type === "message.completed") {
      expect(finalMessage.data.message.state).toBe("completed");
      const text = finalMessage.data.message.parts.find((part) => part.type === "text");
      expect(text?.type === "text" ? text.text : "").toContain("Mock reply");
    }

    const idle = await adapter.getSession(session.id);
    expect(idle.state).toBe("idle");
  });

  it("streams reasoning for prompts that mention think", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    context.clearEvents();
    await adapter.send(session.id, { text: "think about this" });
    await context.waitForEvent("turn.completed");

    const types = context.events.map((event) => event.type);
    expect(types).toContain("reasoning.started");
    expect(types).toContain("reasoning.delta");
    expect(types).toContain("reasoning.completed");
  });

  it("blocks on approval and resolves it", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    context.clearEvents();
    await adapter.send(session.id, { text: "approve this action" });

    const requested = await context.waitForEvent("approval.requested");
    expect(requested.data.approval.sessionId).toBe(session.id);
    expect(requested.data.approval.options.map((option) => option.id)).toEqual(["allow", "always", "deny"]);

    await adapter.resolveApproval(requested.data.approval.id, { optionId: "allow" });
    const completed = await context.waitForEvent("turn.completed");
    expect(completed.type).toBe("turn.completed");

    const resolution = context.events.find((event) => event.type === "approval.resolved");
    expect(resolution?.type === "approval.resolved" ? resolution.data.resolution.optionId : "").toBe("allow");
  });

  it("treats a denied approval as a completed turn with a denial note", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    context.clearEvents();
    await adapter.send(session.id, { text: "approve this action" });
    const requested = await context.waitForEvent("approval.requested");
    await adapter.resolveApproval(requested.data.approval.id, { optionId: "deny" });

    const message = await context.waitForEvent("message.completed");
    const text = message.data.message.parts.find((part) => part.type === "text");
    expect(text?.type === "text" ? text.text : "").toContain("denied");
  });

  it("asks structured questions and records the answer", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    context.clearEvents();
    await adapter.send(session.id, { text: "ask me something" });

    const requested = await context.waitForEvent("question.requested");
    await adapter.answerQuestion(requested.data.question.id, {
      answers: [{ questionId: "q0", selectedOptionIds: ["second"] }],
    });

    const message = await context.waitForEvent("message.completed");
    const text = message.data.message.parts.find((part) => part.type === "text");
    expect(text?.type === "text" ? text.text : "").toContain("second");
  });

  it("interrupts a running turn", async () => {
    const slow = new MockAdapter({ stepDelayMs: 5 });
    slow.init(context);
    const session = await slow.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    context.clearEvents();
    await slow.send(session.id, { text: "a long streamed answer to interrupt" });
    await slow.interrupt(session.id);

    const interrupted = await context.waitForEvent("turn.interrupted");
    expect(interrupted.sessionId).toBe(session.id);
    const idle = await slow.getSession(session.id);
    expect(idle.state).toBe("idle");
  });

  it("queues messages while a turn is running", async () => {
    const slow = new MockAdapter({ stepDelayMs: 5 });
    slow.init(context);
    const session = await slow.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    context.clearEvents();
    await slow.send(session.id, { text: "first" });
    await slow.send(session.id, { text: "second" });

    await vi.waitFor(() => {
      const completed = context.events.filter((event) => event.type === "turn.completed");
      expect(completed.length).toBeGreaterThanOrEqual(2);
    });
    const turns = context.events.filter((event) => event.type === "turn.started");
    expect(turns.length).toBeGreaterThanOrEqual(2);
  });

  it("steers only while working", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    await expect(adapter.steer(session.id, { text: "steer" })).rejects.toMatchObject({
      code: "session_not_active",
    });
  });

  it("updates model and mode with normalized events", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    context.clearEvents();
    await adapter.setModel(session.id, { modelId: "mock-beta" });
    await adapter.setMode(session.id, { mode: "plan" });

    const updated = await adapter.getSession(session.id);
    expect(updated.model?.modelId).toBe("mock-beta");
    expect(updated.mode).toBe("plan");
    expect(context.events.filter((event) => event.type === "session.updated")).toHaveLength(2);
  });

  it("returns diffs and usage", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    const diff = await adapter.getDiff(session.id);
    expect(diff.files.length).toBeGreaterThan(0);
    expect(diff.sessionId).toBe(session.id);

    const usage = await adapter.getUsage();
    expect(usage?.provider).toBe("mock");
  });

  it("rejects operations on unknown sessions with stable errors", async () => {
    await expect(adapter.getSession("ses_missing")).rejects.toBeInstanceOf(AdapterError);
    await expect(adapter.getSession("ses_missing")).rejects.toMatchObject({ code: "session_not_found" });
    await expect(adapter.resolveApproval("apr_missing", { optionId: "allow" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("deletes sessions and emits session.deleted", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    context.clearEvents();
    await adapter.deleteSession(session.id);
    await expect(adapter.getSession(session.id)).rejects.toMatchObject({ code: "session_not_found" });
    expect(context.events.some((event) => event.type === "session.deleted")).toBe(true);
  });

  it("emits events with the provider id and JSON-serializable payloads", async () => {
    const session = await adapter.createSession({ provider: "mock", projectId: PROJECT.id }, PROJECT);
    await adapter.send(session.id, { text: "hello" });
    await context.waitForEvent("turn.completed");

    for (const event of context.events) {
      expect(event.provider).toBe("mock");
      expect(() => JSON.stringify(event)).not.toThrow();
    }
  });
});
