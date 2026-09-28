import { createRecordingLogger } from "@homebase/adapter-sdk";
import { nowTimestamp, type AgentEvent, type AgentSession } from "@homebase/protocol";
import { describe, expect, it } from "vitest";

import { SessionEventTracker } from "../src/events.js";
import { event, nativeForm, nativePermission } from "./fixtures.js";

function createTracker() {
  const emitted: AgentEvent[] = [];
  const patched: Array<{ sessionId: string; patch: Record<string, unknown> }> = [];
  const session: AgentSession = {
    id: "ses_1",
    provider: "opencode",
    projectId: "prj_1",
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
    state: "idle",
  };
  const sessions = new Map<string, AgentSession>([["ses_1", session]]);
  const tracker = new SessionEventTracker({
    emit: (emittedEvent) => emitted.push(emittedEvent),
    sessionSnapshot: (sessionId) => sessions.get(sessionId),
    patchSession: (sessionId, patch) => {
      patched.push({ sessionId, patch: patch as Record<string, unknown> });
      const current = sessions.get(sessionId);
      if (current) sessions.set(sessionId, { ...current, ...patch });
    },
    logger: createRecordingLogger().logger,
  });
  return { tracker, emitted, patched, sessions };
}

const types = (emitted: AgentEvent[]) => emitted.map((entry) => entry.type);

describe("SessionEventTracker", () => {
  it("tracks the execution lifecycle and session state", () => {
    const { tracker, emitted, sessions } = createTracker();

    tracker.handle(event("session.execution.started", { sessionID: "ses_1" }), "ses_1");
    expect(types(emitted)).toContain("turn.started");
    expect(sessions.get("ses_1")?.state).toBe("working");

    tracker.handle(event("session.execution.succeeded", { sessionID: "ses_1" }, 1_760_000_001_000), "ses_1");
    expect(types(emitted)).toContain("turn.completed");
    expect(sessions.get("ses_1")?.state).toBe("idle");
  });

  it("assembles streamed text messages from deltas", () => {
    const { tracker, emitted } = createTracker();

    tracker.handle(event("session.execution.started", { sessionID: "ses_1" }), "ses_1");
    tracker.handle(event("session.step.started", { sessionID: "ses_1", assistantMessageID: "msg_a1" }), "ses_1");
    tracker.handle(
      event("session.text.started", { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0 }),
      "ses_1",
    );
    tracker.handle(
      event("session.text.delta", { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0, delta: "Hel" }),
      "ses_1",
    );
    tracker.handle(
      event("session.text.delta", { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0, delta: "lo" }),
      "ses_1",
    );
    tracker.handle(
      event("session.text.ended", { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0, text: "Hello" }),
      "ses_1",
    );
    tracker.handle(event("session.step.ended", { sessionID: "ses_1", assistantMessageID: "msg_a1" }), "ses_1");

    const deltas = emitted.filter((entry) => entry.type === "message.delta");
    expect(deltas.map((entry) => (entry.type === "message.delta" ? entry.data.delta : "")).join("")).toBe("Hello");

    const completed = emitted.find((entry) => entry.type === "message.completed");
    expect(completed?.type).toBe("message.completed");
    if (completed?.type === "message.completed") {
      const text = completed.data.message.parts.find((part) => part.type === "text");
      expect(text?.type === "text" ? text.text : "").toBe("Hello");
      expect(completed.data.message.state).toBe("completed");
    }
  });

  it("emits reasoning lifecycle events", () => {
    const { tracker, emitted } = createTracker();
    tracker.handle(event("session.step.started", { sessionID: "ses_1", assistantMessageID: "msg_a1" }), "ses_1");
    tracker.handle(
      event("session.reasoning.started", { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0 }),
      "ses_1",
    );
    tracker.handle(
      event("session.reasoning.delta", { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0, delta: "hm" }),
      "ses_1",
    );
    tracker.handle(
      event("session.reasoning.ended", { sessionID: "ses_1", assistantMessageID: "msg_a1", ordinal: 0, text: "hmm" }),
      "ses_1",
    );

    expect(types(emitted)).toContain("reasoning.started");
    expect(types(emitted)).toContain("reasoning.delta");
    const completed = emitted.find((entry) => entry.type === "reasoning.completed");
    expect(completed?.type === "reasoning.completed" ? completed.data.text : "").toBe("hmm");
  });

  it("tracks tools through their lifecycle and sanitizes output", () => {
    const { tracker, emitted } = createTracker();
    tracker.handle(event("session.step.started", { sessionID: "ses_1", assistantMessageID: "msg_a1" }), "ses_1");
    tracker.handle(
      event("session.tool.input.started", {
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        id: "call_1",
        name: "write",
      }),
      "ses_1",
    );
    tracker.handle(
      event("session.tool.called", {
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        id: "call_1",
        input: { path: "README.md" },
      }),
      "ses_1",
    );
    tracker.handle(
      event("session.tool.success", {
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        id: "call_1",
        content: [{ type: "file", uri: "/home/example/demo/README.md", mime: "text/markdown", name: "README.md" }],
      }),
      "ses_1",
    );

    expect(types(emitted)).toContain("tool.started");
    expect(types(emitted)).toContain("tool.updated");
    const completed = emitted.find((entry) => entry.type === "tool.completed");
    expect(completed?.type === "tool.completed" ? completed.data.toolCall.status : "").toBe("completed");
    expect(JSON.stringify(completed)).not.toContain("/home/example");
  });

  it("marks a tool denied after its approval is rejected", () => {
    const { tracker, emitted } = createTracker();
    tracker.handle(event("session.step.started", { sessionID: "ses_1", assistantMessageID: "msg_a1" }), "ses_1");
    tracker.handle(
      event("session.tool.input.started", {
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        id: "call_1",
        name: "write",
      }),
      "ses_1",
    );
    tracker.handle(event("permission.asked", nativePermission), "ses_1");

    const requested = emitted.find((entry) => entry.type === "approval.requested");
    expect(requested?.type).toBe("approval.requested");
    if (requested?.type === "approval.requested") {
      expect(requested.data.approval.options.map((option) => option.id)).toEqual([
        "allow_once",
        "allow_always",
        "deny",
      ]);
    }

    tracker.handle(
      event("permission.replied", { sessionID: "ses_1", requestID: "per_example1", reply: "reject" }),
      "ses_1",
    );
    expect(types(emitted)).toContain("approval.resolved");

    tracker.handle(
      event("session.tool.failed", {
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        id: "call_1",
        error: { type: "denied", message: "denied" },
      }),
      "ses_1",
    );
    const failed = emitted.find((entry) => entry.type === "tool.failed");
    expect(failed?.type === "tool.failed" ? failed.data.toolCall.status : "").toBe("denied");
  });

  it("maps forms to questions and back", () => {
    const { tracker, emitted } = createTracker();
    tracker.handle(event("form.created", { form: nativeForm }), "ses_1");
    const requested = emitted.find((entry) => entry.type === "question.requested");
    expect(requested?.type === "question.requested" ? requested.data.question.questions[0]?.kind : "").toBe(
      "single_select",
    );

    tracker.handle(event("form.replied", { id: "frm_example1", sessionID: "ses_1", answer: { q0: "Blue" } }), "ses_1");
    const resolved = emitted.find((entry) => entry.type === "question.resolved");
    expect(
      resolved?.type === "question.resolved" ? resolved.data.resolution.answers[0]?.selectedOptionIds?.[0] : "",
    ).toBe("Blue");
  });

  it("settles failed and interrupted runs", () => {
    const { tracker, emitted, sessions } = createTracker();
    tracker.handle(event("session.execution.started", { sessionID: "ses_1" }), "ses_1");
    tracker.handle(
      event("session.step.failed", {
        sessionID: "ses_1",
        assistantMessageID: "msg_a1",
        error: { type: "aborted", message: "Step interrupted" },
      }),
      "ses_1",
    );
    tracker.handle(event("session.execution.interrupted", { sessionID: "ses_1", reason: "user" }), "ses_1");

    expect(types(emitted)).toContain("turn.interrupted");
    expect(sessions.get("ses_1")?.state).toBe("idle");
  });

  it("ignores unknown event types without throwing", () => {
    const { tracker, emitted } = createTracker();
    expect(() => tracker.handle(event("model.updated", { anything: true }), "ses_1")).not.toThrow();
    expect(emitted).toHaveLength(0);
  });
});
