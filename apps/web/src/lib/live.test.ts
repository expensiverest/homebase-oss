import { sequencedAgentEventSchema, type AgentMessage, type SequencedAgentEvent } from "@homebase/protocol";
import { beforeEach, describe, expect, it } from "vitest";

import { createOverlayState, reduceOverlay, useLive } from "./live.js";

function event(input: Record<string, unknown>): SequencedAgentEvent {
  return sequencedAgentEventSchema.parse(input);
}

function base(
  sequence: number,
  type: string,
  data: Record<string, unknown>,
  sessionId: string | null = "ses_1",
): SequencedAgentEvent {
  return event({
    type,
    provider: "mock",
    projectId: "prj_1",
    sessionId,
    occurredAt: "2026-01-01T00:00:00.000Z",
    data,
    id: `evt_${sequence}`,
    sequence,
  });
}

function message(partial: Partial<AgentMessage> & { id: string }): AgentMessage {
  return {
    sessionId: "ses_1",
    role: "assistant",
    createdAt: "2026-01-01T00:00:00.000Z",
    state: "streaming",
    parts: [],
    ...partial,
  };
}

beforeEach(() => {
  useLive.setState(createOverlayState());
});

describe("reduceOverlay", () => {
  it("de-duplicates by global sequence", () => {
    const started = base(1, "message.started", {
      message: message({ id: "m1", parts: [{ type: "text", id: "p1", text: "" }] }),
    });
    const first = reduceOverlay(createOverlayState(), started);
    expect(first?.sessions.ses_1?.messages).toHaveLength(1);
    expect(reduceOverlay(first as never, started)).toBeNull();
    expect(
      reduceOverlay(first as never, base(0, "message.delta", { messageId: "m1", partId: "p1", delta: "old" })),
    ).toBeNull();
  });

  it("appends deltas and lets the completed snapshot take over", () => {
    let state = createOverlayState();
    state = reduceOverlay(
      state,
      base(1, "message.started", { message: message({ id: "m1", parts: [{ type: "text", id: "p1", text: "" }] }) }),
    ) as never;
    state = reduceOverlay(state, base(2, "message.delta", { messageId: "m1", partId: "p1", delta: "Hel" })) as never;
    state = reduceOverlay(state, base(3, "message.delta", { messageId: "m1", partId: "p1", delta: "lo" })) as never;
    expect((state.sessions.ses_1?.messages[0]?.parts[0] as { text: string }).text).toBe("Hello");
    state = reduceOverlay(
      state,
      base(4, "message.completed", {
        message: message({ id: "m1", state: "completed", parts: [{ type: "text", id: "p1", text: "Hello there" }] }),
      }),
    ) as never;
    expect((state.sessions.ses_1?.messages[0]?.parts[0] as { text: string }).text).toBe("Hello there");
  });

  it("creates a placeholder when a delta arrives before message.started", () => {
    const state = reduceOverlay(
      createOverlayState(),
      base(1, "message.delta", { messageId: "m9", partId: "p9", delta: "partial" }),
    );
    const message = state?.sessions.ses_1?.messages[0];
    expect(message?.id).toBe("m9");
    expect((message?.parts[0] as { text: string }).text).toBe("partial");
  });

  it("upserts tool calls by tool call id onto the streaming message", () => {
    let state = createOverlayState();
    state = reduceOverlay(state, base(1, "message.started", { message: message({ id: "m1" }) })) as never;
    state = reduceOverlay(
      state,
      base(2, "tool.started", { toolCall: { id: "t1", name: "read", status: "running" } }),
    ) as never;
    state = reduceOverlay(
      state,
      base(3, "tool.completed", { toolCall: { id: "t1", name: "read", status: "completed" } }),
    ) as never;
    const parts = state.sessions.ses_1?.messages[0]?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type === "tool_call" && parts[0].toolCall.status).toBe("completed");
  });

  it("marks finished runs and session deletion", () => {
    let state = createOverlayState();
    state = reduceOverlay(state, base(1, "turn.started", { turnId: "turn_1" })) as never;
    expect(state.sessions.ses_1?.running).toBe(true);
    state = reduceOverlay(state, base(2, "turn.interrupted", { turnId: "turn_1" })) as never;
    expect(state.sessions.ses_1?.running).toBe(false);
    expect(state.sessions.ses_1?.stale).toBe(true);
    state = reduceOverlay(state, base(3, "session.deleted", { sessionId: "ses_1" })) as never;
    expect(state.sessions.ses_1).toBeUndefined();
  });

  it("tracks provider and usage events without touching messages", () => {
    const state = reduceOverlay(
      createOverlayState(),
      base(1, "usage.updated", { usage: { provider: "mock", windows: [], fetchedAt: "2026-01-01T00:00:00.000Z" } }),
    );
    expect(state?.lastSequence).toBe(1);
    expect(Object.keys(state?.sessions ?? {})).toHaveLength(0);
  });
});

describe("live store helpers", () => {
  it("prunes overlay copies that fetched history already contains, including optimistic users", () => {
    const store = useLive.getState();
    store.addOptimisticUserMessage("ses_1", "hello world", []);
    store.addOptimisticUserMessage("ses_1", "second", []);
    expect(useLive.getState().sessions.ses_1?.messages).toHaveLength(2);
    const fetchedUser = message({
      id: "server_user_1",
      role: "user",
      state: "completed",
      parts: [{ type: "text", id: "up1", text: "hello world" }],
    });
    // Identity-bearing accepted echo anchors the pending user; text alone in
    // unrelated old history cannot safely deduplicate a repeated prompt.
    useLive.getState().apply(base(1, "message.completed", { message: fetchedUser }));
    useLive.getState().prune("ses_1", [fetchedUser]);
    const remaining = useLive.getState().sessions.ses_1?.messages ?? [];
    expect(remaining).toHaveLength(1);
    expect((remaining[0]?.parts[0] as { text: string }).text).toBe("second");
  });

  it("keeps id-matched live messages while running and prunes them after", () => {
    const streaming = message({
      id: "m_live",
      state: "streaming",
      parts: [{ type: "text", id: "p1", text: "partial" }],
    });
    useLive.setState({
      ...createOverlayState(),
      sessions: { ses_1: { messages: [streaming], running: true, stale: false } },
    });
    useLive
      .getState()
      .prune("ses_1", [
        message({ id: "m_live", state: "streaming", parts: [{ type: "text", id: "p1", text: "old fetch" }] }),
      ]);
    expect(useLive.getState().sessions.ses_1?.messages[0]?.parts[0]).toMatchObject({ text: "partial" });
    useLive.setState({
      ...createOverlayState(),
      sessions: { ses_1: { messages: [streaming], running: false, stale: true } },
    });
    useLive
      .getState()
      .prune("ses_1", [
        message({ id: "m_live", state: "completed", parts: [{ type: "text", id: "p1", text: "final" }] }),
      ]);
    expect(useLive.getState().sessions.ses_1?.messages).toHaveLength(0);
  });

  it("resets overlays and bumps resync count", () => {
    useLive.getState().addOptimisticUserMessage("ses_1", "hi", []);
    const before = useLive.getState().resyncCount;
    useLive.getState().resetOverlay();
    expect(useLive.getState().sessions).toEqual({});
    expect(useLive.getState().resyncCount).toBe(before + 1);
  });
});
