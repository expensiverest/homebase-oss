import { describe, expect, it } from "vitest";

import {
  AGENT_EVENT_TYPES,
  agentEventSchema,
  agentMessageSchema,
  agentModelSchema,
  agentProjectSchema,
  agentProviderSchema,
  agentSessionSchema,
  apiErrorSchema,
  approvalResultSchema,
  createSessionInputSchema,
  defineCapabilities,
  noCapabilities,
  nowTimestamp,
  pageRequestSchema,
  questionAnswerSchema,
  sendMessageInputSchema,
  sequencedAgentEventSchema,
  timestampSchema,
  toAgentPage,
  type AgentEventType,
} from "../src/index.js";

const provider = {
  id: "mock",
  name: "Mock Provider",
  installed: true,
  authenticated: true,
  compatible: true,
  capabilities: defineCapabilities({ streaming: true, interrupt: true, approvals: true, questions: true }),
};

const session = {
  id: "ses_1",
  provider: "mock",
  projectId: "prj_1",
  title: "Test session",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  state: "idle" as const,
};

const message = {
  id: "msg_1",
  sessionId: "ses_1",
  role: "assistant" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  state: "completed" as const,
  parts: [
    { type: "text" as const, id: "part_1", text: "hello" },
    {
      type: "tool_call" as const,
      id: "tool_1",
      toolCall: { id: "tool_1", name: "bash", status: "completed" as const, output: { stdout: "ok" } },
    },
  ],
};

function sampleData(type: AgentEventType): unknown {
  switch (type) {
    case "provider.connected":
    case "provider.updated":
      return { provider };
    case "provider.disconnected":
      return { providerId: "mock", reason: "test" };
    case "session.created":
    case "session.updated":
      return { session };
    case "session.deleted":
      return { sessionId: "ses_1" };
    case "turn.started":
      return { turnId: "turn_1" };
    case "turn.completed":
      return { turnId: "turn_1", usage: null };
    case "turn.failed":
      return { turnId: "turn_1", error: { code: "provider_error", message: "boom" } };
    case "turn.interrupted":
      return { turnId: "turn_1" };
    case "message.started":
    case "message.updated":
    case "message.completed":
      return { message };
    case "message.delta":
      return { messageId: "msg_1", partId: "part_1", delta: "lo" };
    case "reasoning.started":
    case "reasoning.completed":
      return { messageId: "msg_1", partId: "part_r", text: "thinking" };
    case "reasoning.delta":
      return { messageId: "msg_1", partId: "part_r", delta: "more" };
    case "tool.started":
    case "tool.updated":
    case "tool.completed":
      return { toolCall: { id: "tool_1", name: "bash", status: "running" } };
    case "tool.failed":
      return { toolCall: { id: "tool_1", name: "bash", status: "failed", error: "exit 1" } };
    case "approval.requested":
      return {
        approval: {
          id: "apr_1",
          sessionId: "ses_1",
          provider: "mock",
          createdAt: "2026-01-01T00:00:00.000Z",
          kind: "tool",
          title: "Run bash",
          options: [{ id: "allow", label: "Allow", kind: "allow_once" }],
        },
      };
    case "approval.resolved":
      return {
        resolution: {
          requestId: "apr_1",
          optionId: "allow",
          resolvedAt: "2026-01-01T00:00:00.000Z",
          resolvedBy: "user",
        },
      };
    case "question.requested":
      return {
        question: {
          id: "qst_1",
          sessionId: "ses_1",
          provider: "mock",
          createdAt: "2026-01-01T00:00:00.000Z",
          questions: [{ id: "q0", question: "Which database?", kind: "single_select", options: [] }],
        },
      };
    case "question.resolved":
      return {
        resolution: {
          requestId: "qst_1",
          answers: [{ questionId: "q0", selectedOptionIds: ["postgres"] }],
          resolvedAt: "2026-01-01T00:00:00.000Z",
        },
      };
    case "plan.updated":
      return {
        plan: {
          id: "plan_1",
          steps: [{ id: "s1", title: "Inspect", status: "pending" }],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      };
    case "diff.updated":
      return {
        diff: {
          provider: "mock",
          sessionId: "ses_1",
          files: [{ path: "src/index.ts", status: "modified", additions: 3, deletions: 1 }],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      };
    case "usage.updated":
      return {
        usage: {
          provider: "mock",
          windows: [{ id: "five_hour", label: "5 hour", unit: "percent", usedPercent: 12 }],
          fetchedAt: "2026-01-01T00:00:00.000Z",
        },
      };
    case "provider.event":
      return { provider: "mock", nativeType: "something.native", data: { a: 1 } };
  }
}

describe("core entities", () => {
  it("parses provider, project, and session records", () => {
    expect(agentProviderSchema.parse(provider).id).toBe("mock");
    expect(
      agentProjectSchema.parse({
        id: "prj_1",
        name: "demo",
        path: "/home/user/demo",
        providersAvailable: ["mock"],
      }).name,
    ).toBe("demo");
    expect(agentSessionSchema.parse(session).state).toBe("idle");
  });

  it("rejects provider ids that are not lowercase slugs", () => {
    expect(agentProviderSchema.safeParse({ ...provider, id: "Mock Provider" }).success).toBe(false);
    expect(agentProviderSchema.safeParse({ ...provider, id: "OpenCode" }).success).toBe(false);
  });

  it("rejects unknown session states", () => {
    expect(agentSessionSchema.safeParse({ ...session, state: "thinking" }).success).toBe(false);
    expect(agentSessionSchema.safeParse({ ...session, state: "unknown" }).success).toBe(true);
  });

  it("accepts only ISO 8601 timestamps and produces them", () => {
    expect(timestampSchema.safeParse(nowTimestamp()).success).toBe(true);
    expect(timestampSchema.safeParse("yesterday").success).toBe(false);
  });

  it("round-trips rich messages through JSON", () => {
    const parsed = agentMessageSchema.parse(message);
    const roundTripped = agentMessageSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("allows model-specific input capabilities", () => {
    const model = {
      id: "example/model",
      provider: "mock",
      name: "Example",
      inputCapabilities: { text: true, image: true, file: false },
    };
    expect(agentModelSchema.parse(model).inputCapabilities?.image).toBe(true);
    expect(agentModelSchema.safeParse({ ...model, inputCapabilities: { text: true } }).success).toBe(false);
  });

  it("allows historical image/file parts without a resolvable attachment id", () => {
    const historical = {
      ...message,
      parts: [
        { type: "image" as const, id: "part_img", mimeType: "image/png", name: "screenshot.png" },
        { type: "file" as const, id: "part_file", name: "notes.pdf", mimeType: "application/pdf" },
      ],
    };
    expect(agentMessageSchema.safeParse(historical).success).toBe(true);
  });

  it("pages opaque cursors through the neutral page shape", () => {
    expect(pageRequestSchema.parse({ cursor: "abc", limit: 25 })).toEqual({ cursor: "abc", limit: 25 });
    expect(pageRequestSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(pageRequestSchema.safeParse({ limit: 5_000 }).success).toBe(false);

    const page = toAgentPage([1, 2], { next: "n1", previous: "p1" });
    expect(page).toEqual({ items: [1, 2], nextCursor: "n1", previousCursor: "p1" });
    expect(toAgentPage([]).nextCursor).toBeNull();
  });
});

describe("normalized events", () => {
  it("declares the documented event vocabulary", () => {
    const required = [
      "provider.connected",
      "provider.disconnected",
      "provider.updated",
      "session.created",
      "session.updated",
      "session.deleted",
      "turn.started",
      "turn.completed",
      "turn.failed",
      "turn.interrupted",
      "message.started",
      "message.updated",
      "message.delta",
      "message.completed",
      "reasoning.started",
      "reasoning.delta",
      "reasoning.completed",
      "tool.started",
      "tool.updated",
      "tool.completed",
      "tool.failed",
      "approval.requested",
      "approval.resolved",
      "question.requested",
      "question.resolved",
      "plan.updated",
      "diff.updated",
      "usage.updated",
      "provider.event",
    ];
    expect([...AGENT_EVENT_TYPES].sort()).toEqual(required.sort());
  });

  it("parses every declared event type with representative data", () => {
    for (const type of AGENT_EVENT_TYPES) {
      const result = agentEventSchema.safeParse({
        type,
        provider: "mock",
        projectId: "prj_1",
        sessionId: "ses_1",
        occurredAt: "2026-01-01T00:00:00.000Z",
        data: sampleData(type),
      });
      expect(result.success, `event ${type} failed to parse: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it("rejects unknown event types", () => {
    const result = agentEventSchema.safeParse({
      type: "oc.session.updated",
      provider: "mock",
      projectId: null,
      sessionId: null,
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("requires a sequence, id, and timestamp on Host-delivered events", () => {
    const event = {
      type: "turn.started",
      provider: "mock",
      projectId: "prj_1",
      sessionId: "ses_1",
      data: { turnId: "turn_1" },
    };

    expect(sequencedAgentEventSchema.safeParse(event).success).toBe(false);
    const sequenced = sequencedAgentEventSchema.parse({
      ...event,
      id: "evt_1",
      sequence: 1,
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(sequenced.sequence).toBe(1);
    if (sequenced.type === "turn.started") {
      expect(sequenced.data.turnId).toBe("turn_1");
    } else {
      throw new Error("unexpected event type");
    }
  });
});

describe("Host inputs", () => {
  it("rejects arbitrary filesystem paths supplied by a client", () => {
    const withPath = {
      provider: "mock",
      projectId: "prj_1",
      path: "C:\\Users\\someone\\secrets",
    };
    const result = createSessionInputSchema.safeParse(withPath);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
  });

  it("accepts a well-formed create-session input", () => {
    const result = createSessionInputSchema.parse({ provider: "mock", projectId: "prj_1", title: "Hello" });
    expect(result.provider).toBe("mock");
  });

  it("rejects empty or oversized prompts", () => {
    expect(sendMessageInputSchema.safeParse({ text: "" }).success).toBe(false);
    expect(sendMessageInputSchema.safeParse({ text: "x".repeat(200_001) }).success).toBe(false);
    expect(sendMessageInputSchema.safeParse({ text: "hello", attachments: [] }).success).toBe(true);
  });

  it("validates approval and question answers", () => {
    expect(approvalResultSchema.parse({ optionId: "allow" }).optionId).toBe("allow");
    expect(approvalResultSchema.safeParse({ optionId: "" }).success).toBe(false);

    const answers = { answers: [{ questionId: "q0", selectedOptionIds: ["postgres"] }] };
    expect(questionAnswerSchema.safeParse(answers).success).toBe(true);
    expect(questionAnswerSchema.safeParse({ answers: [] }).success).toBe(false);
  });
});

describe("capability independence", () => {
  it("keeps protocol entities free of provider-specific capability shortcuts", () => {
    // The protocol only knows capability flags; nothing in the shared schema
    // branches on a provider id. This test pins the baseline record.
    expect(noCapabilities.approvals).toBe(false);
    expect(Object.keys(noCapabilities)).toHaveLength(19);
  });
});

describe("error envelope", () => {
  it("parses the stable API error shape", () => {
    const body = apiErrorSchema.parse({
      error: { code: "project_not_allowed", message: "Path is outside configured project roots.", requestId: "req_1" },
    });
    expect(body.error.code).toBe("project_not_allowed");
  });

  it("rejects unknown error codes", () => {
    const result = apiErrorSchema.safeParse({ error: { code: "directory_not_allowed", message: "nope" } });
    expect(result.success).toBe(false);
  });
});
