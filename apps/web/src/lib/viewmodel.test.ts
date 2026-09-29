import { defineCapabilities, type AgentMessage, type AgentProvider, type AgentToolCall } from "@homebase/protocol";
import { describe, expect, it } from "vitest";

import {
  activeRunView,
  attachmentRules,
  buildTrace,
  currentSubagents,
  foldTimeline,
  providerStatus,
  resolveThinkingLevel,
  safeHref,
  sessionStatus,
  subagentsOf,
  subagentSummary,
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

function userMessage(id: string, text: string): AgentMessage {
  return {
    id,
    sessionId: "s",
    role: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    state: "completed",
    parts: [{ type: "text", id: `${id}:t`, text }],
  };
}

function call(
  id: string,
  name: string,
  status: AgentToolCall["status"],
  input?: Record<string, string>,
): AgentToolCall {
  return { id, name, status, input: input ?? null };
}

describe("execution trace", () => {
  it("keeps reasoning, tools and interim text in order and the answer out", () => {
    const run = [
      assistant("a1", [{ type: "reasoning", id: "r1", text: "Plan the change." }]),
      assistant("a2", [
        { type: "text", id: "t1", text: "Reading first." },
        { type: "tool_call", id: "c1", toolCall: call("c1", "read", "running") },
      ]),
      assistant("a3", [
        { type: "tool_call", id: "c1", toolCall: call("c1", "read", "completed") },
        { type: "text", id: "t2", text: "Done." },
      ]),
    ];
    const { steps } = buildTrace(run);
    expect(steps.map((step) => step.kind)).toEqual(["reasoning", "text", "tool"]);
    // A tool call reported twice keeps its latest state at its first position.
    const toolStep = steps[2];
    expect(toolStep?.kind === "tool" ? toolStep.tool.status : null).toBe("completed");
    // The last message's text is the answer, not a trace step.
    expect(steps.some((step) => step.kind === "text" && step.text === "Done.")).toBe(false);
  });

  it("never invents a reasoning step for a provider that sends none", () => {
    const { steps } = buildTrace([assistant("a1", [{ type: "text", id: "t", text: "Hi" }])]);
    expect(steps).toEqual([]);
  });
});

describe("active run presentation", () => {
  it("is quiet when nothing is running", () => {
    expect(activeRunView(foldTimeline([userMessage("u1", "Hi")]), false)).toEqual({ mode: "none" });
  });

  it("shows the orbit only until something substantive is visible", () => {
    const prompt = userMessage("u1", "Go");
    expect(activeRunView(foldTimeline([prompt]), true)).toEqual({ mode: "orbit", label: "Starting…" });

    const empty = assistant("a1", [{ type: "text", id: "t", text: "" }], "streaming");
    expect(activeRunView(foldTimeline([prompt, empty]), true)).toEqual({ mode: "orbit", label: "Working…" });

    const thinking = assistant("a1", [{ type: "reasoning", id: "r", text: "Hmm" }], "streaming");
    expect(activeRunView(foldTimeline([prompt, thinking]), true).mode).toBe("trace");

    const tools = assistant(
      "a1",
      [{ type: "tool_call", id: "c", toolCall: call("c", "bash", "running") }],
      "streaming",
    );
    expect(activeRunView(foldTimeline([prompt, tools]), true).mode).toBe("trace");

    const text = assistant("a1", [{ type: "text", id: "t", text: "Here" }], "streaming");
    expect(activeRunView(foldTimeline([prompt, text]), true).mode).toBe("trace");
  });
});

describe("tool presentation for future tools", () => {
  it("renders unknown tool names generically", () => {
    const presentation = toolPresentation(call("x", "mcp__linear__search_issues", "completed", { query: "cursor" }));
    expect(presentation.verb).toBe("Mcp Linear Search Issues");
    expect(presentation.detail).toBe("cursor");
  });

  it("describes a search by its pattern rather than its path", () => {
    expect(toolPresentation(call("g", "grep", "completed", { pattern: "nextCursor", path: "src" })).detail).toBe(
      "nextCursor",
    );
  });
});

describe("sub-agents", () => {
  const spawn = (id: string, name: string, status: AgentToolCall["status"], extra: Partial<AgentToolCall> = {}) =>
    ({
      id,
      name,
      status,
      input: { description: `Review ${id}`, prompt: `Look at ${id} closely`, subagent_type: "explore" },
      ...extra,
    }) satisfies AgentToolCall;

  it("recognises task-style tool calls from any provider and ignores ordinary tools", () => {
    const agents = subagentsOf([
      spawn("routes", "Task", "running"),
      spawn("docs", "task", "completed", { output: { type: "text", text: "Docs are stale." } }),
      spawn("deps", "agent", "failed", { error: "registry timed out" }),
      tool("plain", "bash"),
    ]);
    expect(agents.map((agent) => agent.id)).toEqual(["routes", "docs", "deps"]);
    expect(agents[0]).toMatchObject({ title: "Review routes", kind: "explore", prompt: "Look at routes closely" });
    expect(agents[1]?.result).toBe("Docs are stale.");
    expect(agents[2]?.error).toBe("registry timed out");
  });

  it("carries the sub-agent's own thread when the provider exposes one", () => {
    const [linked, unlinked] = subagentsOf([
      spawn("a", "task", "running", { childSessionId: "hb1~opencode~child" }),
      spawn("b", "task", "running"),
    ]);
    expect(linked?.threadId).toBe("hb1~opencode~child");
    expect(unlinked?.threadId).toBeNull();
  });

  it("falls back to a generic title and survives odd inputs", () => {
    const [agent] = subagentsOf([{ id: "x", name: "task", status: "running", input: "just a string" }]);
    expect(agent).toMatchObject({ title: "Sub-agent", kind: null, prompt: null, result: null });
  });

  it("summarises how many are working, done and failed", () => {
    const summary = subagentSummary(
      subagentsOf([
        spawn("a", "task", "running"),
        spawn("b", "task", "running"),
        spawn("c", "task", "completed"),
        spawn("d", "task", "failed"),
        spawn("e", "task", "denied"),
      ]),
    );
    expect(summary).toEqual({ total: 5, working: 2, done: 1, failed: 2 });
  });

  it("only watches the run after the newest prompt", () => {
    const timeline = foldTimeline([
      user("u1", "first"),
      assistant("a1", [{ type: "tool_call", id: "t1", toolCall: spawn("old", "task", "completed") }]),
      assistant("a2", [{ type: "text", id: "a2:t", text: "Done." }]),
      user("u2", "second"),
      assistant(
        "a3",
        [
          { type: "tool_call", id: "t2", toolCall: spawn("new1", "task", "running") },
          { type: "tool_call", id: "t3", toolCall: spawn("new2", "task", "completed") },
        ],
        "streaming",
      ),
    ]);
    expect(currentSubagents(timeline).map((agent) => agent.id)).toEqual(["new1", "new2"]);
    expect(currentSubagents(foldTimeline([user("u", "hi")]))).toEqual([]);
  });
});
