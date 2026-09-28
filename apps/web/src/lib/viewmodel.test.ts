import { defineCapabilities, type AgentMessage, type AgentProvider, type AgentToolCall } from "@homebase/protocol";
import { describe, expect, it } from "vitest";

import {
  attachmentRules,
  foldTimeline,
  providerStatus,
  resolveThinkingLevel,
  safeHref,
  sessionStatus,
  toolPresentation,
} from "./viewmodel.js";

function provider(capabilities: Partial<ReturnType<typeof defineCapabilities>>): AgentProvider {
  return {
    id: "p",
    name: "P",
    installed: true,
    authenticated: true,
    compatible: true,
    capabilities: defineCapabilities(capabilities),
  };
}

function assistant(id: string, parts: AgentMessage["parts"], state: AgentMessage["state"] = "completed"): AgentMessage {
  return {
    id,
    sessionId: "s",
    role: "assistant",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    state,
    parts,
  };
}

function user(id: string, text: string): AgentMessage {
  return {
    id,
    sessionId: "s",
    role: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    state: "completed",
    parts: [{ type: "text", id: `${id}:t`, text }],
  };
}

function tool(id: string, name: string): AgentToolCall {
  return { id, name, status: "completed", input: { command: "npm test" } };
}

describe("foldTimeline", () => {
  it("folds finished work into a Worked row and keeps the final answer", () => {
    const messages = [
      user("u1", "do the thing"),
      assistant("a1", [{ type: "tool_call", id: "t1", toolCall: tool("tc1", "bash") }]),
      assistant("a2", [{ type: "text", id: "a2:t", text: "Done." }]),
      user("u2", "again"),
      assistant("a3", [{ type: "text", id: "a3:t", text: "Working on it" }], "streaming"),
    ];
    const items = foldTimeline(messages);
    expect(items.map((item) => item.kind)).toEqual(["user", "work", "final", "user", "final"]);
    const work = items[1];
    expect(work?.kind === "work" && work.tools).toHaveLength(1);
    const final = items[2];
    expect(final?.kind === "final" && final.message.id).toBe("a2");
    // The active run stays expanded: its tools render inside the message parts.
    const active = items[4];
    expect(active?.kind === "final" && active.message.state).toBe("streaming");
  });

  it("does not fold a simple single answer", () => {
    const items = foldTimeline([user("u1", "hi"), assistant("a1", [{ type: "text", id: "a1:t", text: "Hello" }])]);
    expect(items.map((item) => item.kind)).toEqual(["user", "final"]);
  });
});

describe("toolPresentation", () => {
  it("maps common tool names to human verbs without provider identity", () => {
    expect(toolPresentation({ id: "t", name: "bash", status: "completed", input: { command: "npm test" } }).verb).toBe(
      "Run",
    );
    expect(
      toolPresentation({ id: "t", name: "Read", status: "completed", input: { file_path: "src/foo.ts" } }).verb,
    ).toBe("Read");
    expect(
      toolPresentation({ id: "t", name: "webfetch", status: "completed", input: { url: "https://example.com" } }).verb,
    ).toBe("Fetch");
  });

  it("falls back for unknown future tools and flags denied calls", () => {
    const unknown = toolPresentation({ id: "t", name: "future_tool", status: "denied", input: null });
    expect(unknown.verb).toBe("Future Tool");
    expect(unknown.tone).toBe("failed");
  });
});

describe("capability-driven attachment rules", () => {
  it("allows images when the provider supports them and the model does not reject them", () => {
    const claudeLike = provider({ imageInput: true });
    const model = { id: "m", provider: "p", name: "M", inputCapabilities: { text: true, image: true, file: false } };
    expect(attachmentRules(claudeLike, model)).toEqual({ images: true, files: false });
  });

  it("disables images when the selected model rejects them", () => {
    const rules = attachmentRules(provider({ imageInput: true, attachments: true }), {
      id: "m",
      provider: "p",
      name: "M",
      inputCapabilities: { text: true, image: false, file: false },
    });
    expect(rules).toEqual({ images: false, files: false });
  });

  it("keeps generic files off when the provider does not support attachments", () => {
    expect(attachmentRules(provider({ imageInput: true }), undefined).files).toBe(false);
  });
});

describe("thinking levels and links", () => {
  it("resets an invalid thinking level to the model default", () => {
    const model = {
      id: "m",
      provider: "p",
      name: "M",
      thinkingLevels: [
        { id: "low", name: "Low" },
        { id: "high", name: "High" },
      ],
      defaultThinkingLevel: "low",
    };
    expect(resolveThinkingLevel(model, "high")).toBe("high");
    expect(resolveThinkingLevel(model, "bogus")).toBe("low");
    expect(resolveThinkingLevel({ id: "m", provider: "p", name: "M" }, "high")).toBeNull();
  });

  it("only accepts safe link schemes", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
  });
});

describe("provider-neutral status language", () => {
  it("labels session states consistently", () => {
    expect(sessionStatus("waiting").label).toBe("Needs you");
    expect(sessionStatus("working").label).toBe("Working");
    expect(sessionStatus("unknown").label).toBe("Status unknown");
  });

  it("describes provider readiness without raw errors", () => {
    expect(providerStatus({ ...provider({}), installed: false } as AgentProvider).label).toBe("Unavailable");
    expect(providerStatus({ ...provider({}), authenticated: false } as AgentProvider).label).toBe("Sign in required");
    expect(providerStatus({ ...provider({}), compatible: false } as AgentProvider).label).toBe("Incompatible version");
  });
});
