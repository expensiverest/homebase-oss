import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@homebase/protocol";

import { classifyResultFrame, ClaudeStreamNormalizer } from "../src/stream/normalizer.js";
import type { NativeFrame } from "../src/native.js";

function track() {
  const events: AgentEvent[] = [];
  const normalizer = new ClaudeStreamNormalizer({
    emit: (type, sessionId, data) =>
      events.push({
        type,
        provider: "claude",
        projectId: "prj_1",
        sessionId,
        occurredAt: new Date().toISOString(),
        data,
      } as AgentEvent),
    markDenied: () => undefined,
    isDenied: () => false,
    onResult: () => undefined,
    onModelSeen: () => undefined,
    onUsage: () => undefined,
    onRateLimit: () => undefined,
    onInit: () => undefined,
    logDebug: () => undefined,
  });
  return { normalizer, events };
}

const SESSION = "0f0f0f0f-1111-2222-3333-444444444444";

function streamFrame(event: Record<string, unknown>): NativeFrame {
  return { type: "stream_event", session_id: SESSION, event };
}

describe("Claude stream normalizer", () => {
  it("merges assistant frames per message id and dedupes text", () => {
    const { normalizer, events } = track();
    normalizer.feed(
      streamFrame({ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5" } }),
      SESSION,
    );
    normalizer.feed(streamFrame({ type: "content_block_start", index: 0, content_block: { type: "text" } }), SESSION);
    normalizer.feed(
      streamFrame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } }),
      SESSION,
    );
    normalizer.feed(
      streamFrame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } }),
      SESSION,
    );
    normalizer.feed(streamFrame({ type: "message_stop" }), SESSION);
    // Two assistant frames for one message id: text then tool_use.
    normalizer.feed(
      {
        type: "assistant",
        session_id: SESSION,
        message: { id: "msg_1", model: "claude-sonnet-5", content: [{ type: "text", text: "Hello" }] },
      },
      SESSION,
    );
    normalizer.feed(
      {
        type: "assistant",
        session_id: SESSION,
        message: {
          id: "msg_1",
          model: "claude-sonnet-5",
          content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: "a.ts" } }],
        },
      },
      SESSION,
    );

    const deltas = events.filter((event) => event.type === "message.delta");
    expect(deltas.map((event) => (event.type === "message.delta" ? event.data.delta : "")).join("")).toBe("Hello");

    const completed = events.find((event) => event.type === "message.completed");
    expect(completed?.type).toBe("message.completed");
    if (completed?.type === "message.completed") {
      const texts = completed.data.message.parts.filter((part) => part.type === "text");
      expect(texts).toHaveLength(1);
      expect(texts[0]?.type === "text" ? texts[0].text : "").toBe("Hello");
      const tools = completed.data.message.parts.filter((part) => part.type === "tool_call");
      expect(tools).toHaveLength(1);
    }
  });

  it("binds tool results and marks denied tools", () => {
    const events: AgentEvent[] = [];
    const denied = new Set<string>(["toolu_deny"]);
    const normalizer = new ClaudeStreamNormalizer({
      emit: (type, sessionId, data) =>
        events.push({
          type,
          provider: "claude",
          projectId: "prj_1",
          sessionId,
          occurredAt: new Date().toISOString(),
          data,
        } as AgentEvent),
      markDenied: (_, toolUseId) => denied.add(toolUseId),
      isDenied: (_, toolUseId) => denied.has(toolUseId),
      onResult: () => undefined,
      onModelSeen: () => undefined,
      onUsage: () => undefined,
      onRateLimit: () => undefined,
      onInit: () => undefined,
      logDebug: () => undefined,
    });

    normalizer.feed(streamFrame({ type: "message_start", message: { id: "msg_1" } }), SESSION);
    normalizer.feed(
      streamFrame({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_deny", name: "Write" },
      }),
      SESSION,
    );
    normalizer.feed(streamFrame({ type: "message_stop" }), SESSION);
    normalizer.feed(
      {
        type: "assistant",
        session_id: SESSION,
        message: {
          id: "msg_1",
          content: [{ type: "tool_use", id: "toolu_deny", name: "Write", input: { file_path: "x" } }],
        },
      },
      SESSION,
    );
    expect(events.some((event) => event.type === "message.completed")).toBe(true);

    normalizer.feed(
      {
        type: "user",
        session_id: SESSION,
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_deny", content: "denied by operator", is_error: true }],
        },
      },
      SESSION,
    );
    const failed = events.find((event) => event.type === "tool.failed");
    expect(failed?.type === "tool.failed" ? failed.data.toolCall.status : "").toBe("denied");
  });

  it("classifies interrupted results before error flags", () => {
    const { normalizer, events } = track();
    normalizer.feed(streamFrame({ type: "message_start", message: { id: "msg_1" } }), SESSION);
    normalizer.feed(streamFrame({ type: "content_block_start", index: 0, content_block: { type: "text" } }), SESSION);
    normalizer.feed(
      streamFrame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "1" } }),
      SESSION,
    );
    normalizer.feed(streamFrame({ type: "message_stop" }), SESSION);
    normalizer.feed(
      { type: "assistant", session_id: SESSION, message: { id: "msg_1", content: [{ type: "text", text: "1" }] } },
      SESSION,
    );
    normalizer.feed(
      {
        type: "result",
        session_id: SESSION,
        subtype: "error_during_execution",
        is_error: true,
        terminal_reason: "aborted_streaming",
        permission_denials: [],
      },
      SESSION,
    );

    const completed = events.find((event) => event.type === "message.completed");
    expect(completed?.type === "message.completed" ? completed.data.message.state : "").toBe("completed");
    expect(normalizer.endTurn(SESSION)).toBeTypeOf("string");
    expect(normalizer.endTurn(SESSION)).toBeNull();
  });

  it("ignores unknown frames without throwing", () => {
    const { normalizer, events } = track();
    expect(() => normalizer.feed({ type: "totally.new.frame", session_id: SESSION }, SESSION)).not.toThrow();
    expect(events).toHaveLength(0);
  });

  it("exposes terminal classification", () => {
    expect(classifyResultFrame({ type: "result", terminal_reason: "aborted_tools", is_error: true })).toBe(
      "interrupted",
    );
    expect(classifyResultFrame({ type: "result", subtype: "error_max_turns", is_error: true })).toBe("failed");
    expect(classifyResultFrame({ type: "result", subtype: "success", is_error: false })).toBe("completed");
  });
});
