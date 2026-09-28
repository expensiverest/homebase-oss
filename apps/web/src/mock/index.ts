import {
  defineCapabilities,
  nowTimestamp,
  type AgentApprovalRequest,
  type AgentAttachmentRef,
  type AgentEventType,
  type AgentMessage,
  type AgentModel,
  type AgentMode,
  type AgentProject,
  type AgentProvider,
  type AgentQuestionRequest,
  type AgentSession,
  type AgentToolCall,
  type AgentUsage,
  type SequencedAgentEvent,
} from "@homebase/protocol";

import { setTransport, type Transport } from "../lib/transport.js";

/**
 * Deterministic development/test scenarios.
 *
 * Mock mode replaces the transport (REST + SSE) with in-memory fixtures and a
 * scripted event emitter. It is loaded dynamically only in development or when
 * `VITE_MOCK=1`, so scenario payloads never reach the production bundle.
 */

export const SCENARIOS = [
  "normal",
  "empty",
  "many-sessions",
  "active-stream",
  "approval",
  "question",
  "failed",
  "provider-down",
  "signed-out",
  "reconnecting",
  "resync",
  "models-large",
  "attachments",
  "diff",
  "reasoning",
  "claude-image-only",
  "long-conversation",
  "host-error",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

const SCENARIO_KEY = "hb.mockScenario";

export function readScenario(): Scenario | null {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("mock");
    if (fromQuery && (SCENARIOS as readonly string[]).includes(fromQuery)) {
      sessionStorage.setItem(SCENARIO_KEY, fromQuery);
      return fromQuery as Scenario;
    }
    const stored = sessionStorage.getItem(SCENARIO_KEY);
    if (stored && (SCENARIOS as readonly string[]).includes(stored)) return stored as Scenario;
    // Explicit mock mode (`VITE_MOCK=1`) defaults to the normal scenario so a
    // plain dev/tunnel URL works without query parameters.
    return import.meta.env.VITE_MOCK === "1" ? "normal" : null;
  } catch {
    return null;
  }
}

export function shouldMock(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_MOCK === "1";
}

// --- fixture data -----------------------------------------------------------

const PROJECTS: AgentProject[] = [
  {
    id: "prj_aurora",
    name: "aurora-api",
    path: "/home/example/projects/aurora-api",
    gitRoot: "/home/example/projects/aurora-api",
    gitRemote: "https://example.com/example/aurora-api.git",
    branch: "main",
    providersAvailable: ["opencode", "claude"],
  },
  {
    id: "prj_beacon",
    name: "beacon-web",
    path: "/home/example/projects/beacon-web",
    branch: "feat/onboarding",
    providersAvailable: ["opencode", "claude"],
  },
  {
    id: "prj_cedar",
    name: "cedar-tools",
    path: "/home/example/projects/cedar-tools",
    branch: "main",
    providersAvailable: ["opencode"],
  },
];

interface MockState {
  scenario: Scenario;
  sequence: number;
  providers: AgentProvider[];
  projects: AgentProject[];
  sessions: AgentSession[];
  messages: Map<string, AgentMessage[]>;
  approvals: Map<string, AgentApprovalRequest[]>;
  questions: Map<string, AgentQuestionRequest[]>;
  attachments: Map<string, { mimeType: string; name: string; bytes: Uint8Array }>;
  subscribers: Set<(event: SequencedAgentEvent) => void>;
  buffers: SequencedAgentEvent[];
  streamFailures: number;
  timers: Set<ReturnType<typeof setTimeout>>;
}

const MODES: AgentMode[] = [
  { id: "default", name: "Ask", description: "Ask before risky tool calls" },
  { id: "acceptEdits", name: "Auto-edit", description: "Apply file edits without asking" },
  { id: "plan", name: "Plan", description: "Explore and propose; make no changes" },
];

const CLAUDE_MODES: AgentMode[] = [
  { id: "default", name: "Ask", description: "Ask before risky tool calls (CLI: manual)" },
  { id: "acceptEdits", name: "Auto-edit", description: "Apply file edits without asking" },
  { id: "plan", name: "Plan", description: "Explore and propose; make no changes" },
  { id: "auto", name: "Auto", description: "Classifier approves most actions" },
];

function models(provider: string, scenario: Scenario): AgentModel[] {
  if (provider === "claude") {
    return [
      {
        id: "sonnet",
        provider: "claude",
        name: "Claude Sonnet",
        thinkingLevels: ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id, name: id })),
        inputCapabilities: { text: true, image: true, file: false },
      },
      {
        id: "opus",
        provider: "claude",
        name: "Claude Opus",
        thinkingLevels: ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id, name: id })),
        inputCapabilities: { text: true, image: true, file: false },
      },
      {
        id: "haiku",
        provider: "claude",
        name: "Claude Haiku",
        inputCapabilities: { text: true, image: scenario !== "claude-image-only", file: false },
      },
      {
        id: "fable",
        provider: "claude",
        name: "Claude Fable",
        thinkingLevels: ["low", "medium", "high"].map((id) => ({ id, name: id })),
        inputCapabilities: { text: true, image: true, file: false },
      },
    ];
  }
  const base: AgentModel[] = [
    {
      id: "example-provider/aurora-1",
      provider: "opencode",
      name: "Aurora 1",
      description: "General purpose",
      contextWindow: 200000,
      maxOutputTokens: 32000,
      thinkingLevels: [
        { id: "low", name: "Low" },
        { id: "medium", name: "Medium" },
        { id: "high", name: "High" },
      ],
      defaultThinkingLevel: "medium",
      inputCapabilities: { text: true, image: true, file: true },
    },
    {
      id: "example-provider/comet-7",
      provider: "opencode",
      name: "Comet 7",
      inputCapabilities: { text: true, image: false, file: true },
    },
    {
      id: "example-provider/nano-fast",
      provider: "opencode",
      name: "Nano Fast",
      inputCapabilities: { text: true, image: true, file: false },
    },
  ];
  if (scenario === "models-large") {
    for (let index = 0; index < 380; index += 1) {
      base.push({
        id: `example-provider/catalog-${index}`,
        provider: "opencode",
        name: `Catalog Model ${String(index + 1).padStart(3, "0")}`,
        inputCapabilities: { text: true, image: index % 3 === 0, file: index % 5 === 0 },
      });
    }
  }
  return base;
}

function makeSession(
  provider: string,
  projectId: string,
  id: string,
  title: string,
  state: AgentSession["state"],
  minutesAgo: number,
  modelId?: string,
): AgentSession {
  const timestamp = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    provider,
    projectId,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    state,
    model: { provider, modelId: modelId ?? (provider === "claude" ? "sonnet" : "example-provider/aurora-1") },
    mode: provider === "claude" ? "default" : "default",
    thinkingLevel: provider === "claude" ? "high" : "medium",
  };
}

function textMessage(
  sessionId: string,
  role: "user" | "assistant",
  text: string,
  id: string,
  minutesAgo = 0,
): AgentMessage {
  return {
    id,
    sessionId,
    role,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    state: "completed",
    parts: [{ type: "text", id: `${id}:text:0`, text }],
  };
}

function toolMessage(
  sessionId: string,
  tool: AgentToolCall,
  state: AgentToolCall["status"],
  minutesAgo = 0,
): AgentMessage {
  return {
    id: `msg_tool_${tool.id}`,
    sessionId,
    role: "assistant",
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    state: "completed",
    parts: [{ type: "tool_call", id: tool.id, toolCall: { ...tool, status: state } }],
  };
}

/** Stores a user prompt (with attachments) so refetched history matches it. */
function appendUserMessage(session: AgentSession, text: string, attachments?: unknown): AgentMessage {
  const id = `msg_user_${Date.now()}_${state.messages.get(session.id)?.length ?? 0}`;
  const parts: AgentMessage["parts"] = [{ type: "text", id: `${id}:text`, text }];
  if (Array.isArray(attachments)) {
    attachments.forEach((entry, index) => {
      const ref = entry as Partial<AgentAttachmentRef>;
      if (!ref || typeof ref.id !== "string") return;
      if (ref.kind === "image") {
        parts.push({
          type: "image",
          id: `${id}:att:${index}`,
          attachmentId: ref.id,
          mimeType: ref.mimeType ?? "image/png",
          name: ref.name ?? "image",
        });
      } else {
        parts.push({
          type: "file",
          id: `${id}:att:${index}`,
          attachmentId: ref.id,
          name: ref.name ?? "file",
          mimeType: ref.mimeType ?? "application/octet-stream",
          sizeBytes: ref.sizeBytes ?? undefined,
        });
      }
    });
  }
  const message: AgentMessage = {
    id,
    sessionId: session.id,
    role: "user",
    createdAt: nowTimestamp(),
    state: "completed",
    parts,
  };
  state.messages.set(session.id, [...(state.messages.get(session.id) ?? []), message]);
  return message;
}

function buildState(scenario: Scenario): MockState {
  const providers: AgentProvider[] = [
    {
      id: "opencode",
      name: "OpenCode",
      version: "2.0.18",
      installed: scenario !== "provider-down",
      authenticated: true,
      compatible: true,
      capabilities: defineCapabilities({
        resume: true,
        deleteSession: true,
        streaming: true,
        interrupt: true,
        steer: true,
        queue: true,
        models: true,
        modelSwitching: true,
        thinkingLevels: true,
        modes: true,
        attachments: true,
        imageInput: true,
        tools: true,
        approvals: true,
        questions: true,
        diffs: true,
      }),
      warning: scenario === "provider-down" ? "The OpenCode server is unreachable." : null,
    },
    {
      id: "claude",
      name: "Claude Code",
      version: "2.1.268",
      installed: true,
      authenticated: scenario === "signed-out" ? false : true,
      compatible: true,
      capabilities: defineCapabilities({
        resume: true,
        streaming: true,
        interrupt: true,
        steer: true,
        queue: true,
        models: true,
        modelSwitching: true,
        thinkingLevels: true,
        modes: true,
        imageInput: true,
        tools: true,
        approvals: true,
        questions: true,
        usage: true,
      }),
      warning:
        scenario === "signed-out" ? "Claude Code is not signed in; run `claude` on this machine to sign in." : null,
    },
  ];

  const projects = scenario === "empty" ? [] : PROJECTS;
  const sessions: AgentSession[] = [];
  const messages = new Map<string, AgentMessage[]>();
  const approvals = new Map<string, AgentApprovalRequest[]>();
  const questions = new Map<string, AgentQuestionRequest[]>();

  if (scenario !== "empty") {
    sessions.push(
      makeSession("opencode", "prj_aurora", "ses_aurora_docs", "Document the gateway endpoints", "working", 4),
      makeSession("claude", "prj_aurora", "ses_aurora_fix", "Fix the flaky auth test", "waiting", 12),
      makeSession("claude", "prj_aurora", "ses_aurora_refactor", "Refactor session storage", "idle", 180),
      makeSession("opencode", "prj_beacon", "ses_beacon_ui", "Polish the onboarding empty state", "idle", 42),
      makeSession("claude", "prj_beacon", "ses_beacon_api", "Add cursor pagination to the audit log", "completed", 500),
      makeSession("opencode", "prj_cedar", "ses_cedar_release", "Prepare the 0.4 release notes", "failed", 90),
    );
  }
  if (scenario === "many-sessions") {
    for (let index = 0; index < 30; index += 1) {
      sessions.push(
        makeSession(
          index % 2 === 0 ? "opencode" : "claude",
          "prj_aurora",
          `ses_many_${index}`,
          `Routine task ${index + 1}`,
          index % 7 === 0 ? "working" : "idle",
          index * 17 + 5,
        ),
      );
    }
  }

  messages.set(
    "ses_aurora_docs",
    scenario === "long-conversation"
      ? Array.from({ length: 60 }, (_, index) =>
          index % 2 === 0
            ? textMessage(
                "ses_aurora_docs",
                "user",
                `Follow-up request ${index / 2 + 1}`,
                `msg_long_u_${index}`,
                (60 - index) * 3,
              )
            : textMessage(
                "ses_aurora_docs",
                "assistant",
                `Handled request ${(index + 1) / 2}.`,
                `msg_long_a_${index}`,
                (60 - index) * 3,
              ),
        )
      : [
          textMessage(
            "ses_aurora_docs",
            "user",
            "Document the gateway endpoints so the mobile client can use them.",
            "msg_aurora_u1",
            30,
          ),
          textMessage(
            "ses_aurora_docs",
            "assistant",
            "I'll first read the existing routes, then write up the endpoints.",
            "msg_aurora_a1",
            29,
          ),
          toolMessage(
            "ses_aurora_docs",
            {
              id: "tool_1",
              name: "read",
              status: "completed",
              input: { file_path: "src/routes/gateway.ts" },
              output: { type: "text", text: "export const routes = []" },
              startedAt: new Date(Date.now() - 29 * 60000).toISOString(),
            },
            "completed",
            29,
          ),
          textMessage(
            "ses_aurora_docs",
            "assistant",
            "Found two endpoints (`/sessions`, `/sessions/:id/messages`) plus the global event stream. Writing docs now.",
            "msg_aurora_a2",
            25,
          ),
        ],
  );
  messages.set("ses_aurora_fix", [
    textMessage(
      "ses_aurora_fix",
      "user",
      "The auth test fails intermittently on CI. Find and fix the race.",
      "msg_fix_u1",
      40,
    ),
    textMessage("ses_aurora_fix", "assistant", "Looking at the test's token setup...", "msg_fix_a1", 39),
    toolMessage(
      "ses_aurora_fix",
      {
        id: "tool_edit_1",
        name: "edit",
        status: "completed",
        input: { file_path: "test/auth.test.ts" },
        startedAt: new Date(Date.now() - 39 * 60000).toISOString(),
      },
      "completed",
      39,
    ),
    textMessage(
      "ses_aurora_fix",
      "assistant",
      "I found the race: the token cache is populated asynchronously while the first request asserts. I can fix it by awaiting readiness.",
      "msg_fix_a2",
      38,
    ),
  ]);
  messages.set("ses_aurora_refactor", [
    textMessage("ses_aurora_refactor", "user", "Move session storage behind a small interface.", "msg_ref_u1", 200),
    textMessage(
      "ses_aurora_refactor",
      "assistant",
      "Done. The store now has list/get/delete with no transport knowledge.",
      "msg_ref_a1",
      190,
    ),
  ]);
  messages.set("ses_beacon_ui", [
    textMessage("ses_beacon_ui", "user", "Polish the empty state for the onboarding list.", "msg_ui_u1", 60),
    textMessage(
      "ses_beacon_ui",
      "assistant",
      "Added a calm empty state with a single primary action.",
      "msg_ui_a1",
      58,
    ),
  ]);
  messages.set("ses_cedar_release", [
    textMessage("ses_cedar_release", "user", "Prepare the 0.4 release notes.", "msg_rel_u1", 95),
    textMessage("ses_cedar_release", "assistant", "Collecting merged PRs...", "msg_rel_a1", 94),
  ]);

  if (scenario === "approval") {
    approvals.set("ses_aurora_fix", [
      {
        id: "hb1~claude~YXBwcl9kZW1v",
        sessionId: "ses_aurora_fix",
        provider: "claude",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        kind: "command",
        title: "Bash: npm test -- auth",
        detail: "npm test -- auth",
        toolCallId: "tool_bash_1",
        options: [
          { id: "allow_once", label: "Allow once", kind: "allow_once" },
          { id: "allow_always", label: "Always allow (this session)", kind: "allow_always" },
          { id: "deny", label: "Deny", kind: "deny" },
        ],
      },
    ]);
  }
  if (scenario === "question") {
    questions.set("ses_beacon_ui", [
      {
        id: "hb1~opencode~cXN0X2RlbW8",
        sessionId: "ses_beacon_ui",
        provider: "opencode",
        createdAt: new Date(Date.now() - 45_000).toISOString(),
        title: "Questions",
        questions: [
          {
            id: "q0",
            header: "Storage",
            question: "Which storage should the settings screen use?",
            kind: "single_select",
            options: [
              { id: "sqlite", label: "SQLite" },
              { id: "json", label: "JSON file" },
            ],
            allowFreeform: true,
          },
          {
            id: "q1",
            header: "Scope",
            question: "Which platforms are in scope?",
            kind: "multi_select",
            options: [
              { id: "ios", label: "iOS" },
              { id: "android", label: "Android" },
              { id: "desktop", label: "Desktop" },
            ],
          },
        ],
      },
    ]);
  }

  return {
    scenario,
    sequence: 0,
    providers,
    projects,
    sessions,
    messages,
    approvals,
    questions,
    attachments: new Map(),
    subscribers: new Set(),
    buffers: [],
    streamFailures: scenario === "reconnecting" ? 1 : 0,
    timers: new Set(),
  };
}

// --- event emission ---------------------------------------------------------

let state: MockState;

function emit(
  type: AgentEventType,
  data: Record<string, unknown>,
  context: { provider?: string; projectId?: string | null; sessionId?: string | null } = {},
): void {
  state.sequence += 1;
  const event = {
    type,
    provider: context.provider ?? "opencode",
    projectId: context.projectId ?? null,
    sessionId: context.sessionId ?? null,
    occurredAt: nowTimestamp(),
    data,
    id: `mock_evt_${state.sequence}`,
    sequence: state.sequence,
  } as unknown as SequencedAgentEvent;
  state.buffers.push(event);
  if (state.buffers.length > 500) state.buffers.splice(0, state.buffers.length - 500);
  for (const subscriber of [...state.subscribers]) subscriber(event);
}

function later(ms: number, action: () => void): void {
  const timer = setTimeout(() => {
    state.timers.delete(timer);
    action();
  }, ms);
  state.timers.add(timer);
}

// --- streaming simulation ---------------------------------------------------

function streamReply(session: AgentSession, prompt: string): void {
  const messageId = `msg_live_${Math.random().toString(36).slice(2, 8)}`;
  const partId = `${messageId}:text:0`;
  emit(
    "turn.started",
    { turnId: `turn_${messageId}` },
    { provider: session.provider, projectId: session.projectId, sessionId: session.id },
  );
  const message: AgentMessage = {
    id: messageId,
    sessionId: session.id,
    role: "assistant",
    createdAt: nowTimestamp(),
    state: "streaming",
    parts: [{ type: "text", id: partId, text: "" }],
  };
  emit(
    "message.started",
    { message },
    { provider: session.provider, projectId: session.projectId, sessionId: session.id },
  );

  const withReasoning = state.scenario === "reasoning" && session.provider === "opencode";
  if (withReasoning) {
    const reasoningId = `${messageId}:reasoning:0`;
    emit(
      "reasoning.started",
      { messageId, partId: reasoningId, text: "" },
      { provider: session.provider, projectId: session.projectId, sessionId: session.id },
    );
    let reasoning = "";
    for (const word of ["Checking", "the", "existing", "implementation", "first."]) {
      reasoning += `${word} `;
      const chunk = `${word} `;
      later(80, () =>
        emit(
          "reasoning.delta",
          { messageId, partId: reasoningId, delta: chunk },
          { provider: session.provider, projectId: session.projectId, sessionId: session.id },
        ),
      );
    }
    later(700, () =>
      emit(
        "reasoning.completed",
        { messageId, partId: reasoningId, text: reasoning.trimEnd() },
        { provider: session.provider, projectId: session.projectId, sessionId: session.id },
      ),
    );
  }

  const words = `Working on it: ${prompt}`.split(/\s+/);
  const toolCall: AgentToolCall = {
    id: `tool_live_${Math.random().toString(36).slice(2, 8)}`,
    name: "read",
    status: "running",
    title: "read",
    input: { file_path: "src/lib/session.ts" },
    startedAt: nowTimestamp(),
  };
  later(600, () =>
    emit(
      "tool.started",
      { toolCall },
      { provider: session.provider, projectId: session.projectId, sessionId: session.id },
    ),
  );
  later(1_400, () =>
    emit(
      "tool.completed",
      {
        toolCall: {
          ...toolCall,
          status: "completed",
          output: { type: "text", text: "export interface SessionStore {}" },
          completedAt: nowTimestamp(),
        },
      },
      { provider: session.provider, projectId: session.projectId, sessionId: session.id },
    ),
  );

  words.forEach((word, index) => {
    const chunk = `${word}${index < words.length - 1 ? " " : ""}`;
    later(400 + index * 90, () => {
      emit(
        "message.delta",
        { messageId, partId, delta: chunk },
        { provider: session.provider, projectId: session.projectId, sessionId: session.id },
      );
    });
  });

  const finalText = `Mock reply for ${session.provider}: ${prompt}`;
  const completionAt = 400 + words.length * 90 + 300;
  later(completionAt, () => {
    const completed: AgentMessage = {
      ...message,
      state: "completed",
      updatedAt: nowTimestamp(),
      parts: [
        ...(withReasoning
          ? [
              {
                type: "reasoning" as const,
                id: `${messageId}:reasoning:0`,
                text: "Checking the existing implementation first.",
              },
            ]
          : []),
        { type: "text", id: partId, text: finalText },
        {
          type: "tool_call",
          id: toolCall.id,
          toolCall: { ...toolCall, status: "completed", completedAt: nowTimestamp() },
        },
      ],
    };
    emit(
      "message.completed",
      { message: completed },
      { provider: session.provider, projectId: session.projectId, sessionId: session.id },
    );
    emit(
      "turn.completed",
      { turnId: `turn_${messageId}` },
      { provider: session.provider, projectId: session.projectId, sessionId: session.id },
    );
    const stored = state.messages.get(session.id) ?? [];
    stored.push(completed);
    state.messages.set(session.id, stored);
    session.state = "idle";
  });
  session.state = "working";
}

// --- REST handling ----------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message, requestId: "mock" } }, status);
}

function page<T>(key: string, items: T[], cursor: string | null, limit: number, prefix: string): Response {
  const offset = cursor ? Number.parseInt(cursor.replace(`${prefix}:`, ""), 10) || 0 : 0;
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  return json({ [key]: slice, nextCursor: nextOffset < items.length ? `${prefix}:${nextOffset}` : null });
}

async function handleRequest(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, window.location.origin);
  const path = url.pathname;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;

  // Simulates a Host that is up but failing every request (for error states).
  if (state.scenario === "host-error") {
    return errorResponse(500, "internal", "The Host hit an internal error.");
  }

  if (path === "/api/v1/health") return json({ status: "ok", version: "0.0.1-mock", latestSequence: state.sequence });
  if (path === "/api/v1/providers") return json({ providers: state.providers });
  if (path === "/api/v1/providers/refresh") return json({ providers: state.providers });
  if (path === "/api/v1/projects") return json({ projects: state.projects });

  const projectMatch = /^\/api\/v1\/projects\/([^/]+)$/.exec(path);
  if (projectMatch) {
    const project = state.projects.find((candidate) => candidate.id === decodeURIComponent(projectMatch[1] ?? ""));
    return project ? json({ project }) : errorResponse(404, "project_not_found", "Unknown project");
  }

  const sessionsMatch = /^\/api\/v1\/projects\/([^/]+)\/sessions$/.exec(path);
  if (sessionsMatch) {
    const projectId = decodeURIComponent(sessionsMatch[1] ?? "");
    const order = url.searchParams.get("cursor");
    const list = state.sessions
      .filter((session) => session.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const offset = order ? Number.parseInt(order.replace("mock:", ""), 10) || 0 : 0;
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
    const slice = list.slice(offset, offset + limit);
    const next = offset + slice.length;
    return json({ sessions: slice, nextCursor: next < list.length ? `mock:${next}` : null, previousCursor: null });
  }

  const modelsMatch = /^\/api\/v1\/projects\/([^/]+)\/providers\/([^/]+)\/models$/.exec(path);
  if (modelsMatch) {
    const providerId = decodeURIComponent(modelsMatch[2] ?? "");
    const provider = state.providers.find((candidate) => candidate.id === providerId);
    if (!provider) return errorResponse(404, "provider_not_found", "Unknown provider");
    if (!provider.capabilities.models) return errorResponse(409, "unsupported_capability", "No models");
    return json({ models: models(providerId, state.scenario) });
  }
  const modesMatch = /^\/api\/v1\/projects\/([^/]+)\/providers\/([^/]+)\/modes$/.exec(path);
  if (modesMatch) {
    const providerId = decodeURIComponent(modesMatch[2] ?? "");
    return json({ modes: providerId === "claude" ? CLAUDE_MODES : MODES });
  }

  if (path === "/api/v1/sessions" && method === "POST") {
    const providerId = String(body?.provider ?? "opencode");
    const provider = state.providers.find((candidate) => candidate.id === providerId);
    if (!provider) return errorResponse(404, "provider_not_found", "Unknown provider");
    if (!provider.installed) return errorResponse(503, "provider_unavailable", `${provider.name} is unavailable.`);
    const projectId = String(body?.projectId ?? state.projects[0]?.id ?? "prj_aurora");
    const session = makeSession(
      providerId,
      projectId,
      `ses_new_${state.sessions.length + 1}`,
      String(body?.title ?? "New session"),
      "idle",
      0,
      String(
        (body?.model as { modelId?: string } | undefined)?.modelId ??
          (providerId === "claude" ? "sonnet" : "example-provider/aurora-1"),
      ),
    );
    state.sessions.unshift(session);
    emit("session.created", { session }, { provider: providerId, projectId, sessionId: session.id });
    return json({ session }, 201);
  }

  const sessionMatch = /^\/api\/v1\/sessions\/([^/]+)$/.exec(path);
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return errorResponse(404, "session_not_found", "Unknown session");
    if (method === "DELETE") {
      state.sessions = state.sessions.filter((candidate) => candidate.id !== sessionId);
      emit("session.deleted", { sessionId }, { provider: session.provider, projectId: session.projectId, sessionId });
      return new Response(null, { status: 204 });
    }
    return json({ session });
  }

  const messagesMatch = /^\/api\/v1\/sessions\/([^/]+)\/messages$/.exec(path);
  if (messagesMatch) {
    const sessionId = decodeURIComponent(messagesMatch[1] ?? "");
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return errorResponse(404, "session_not_found", "Unknown session");
    if (method === "POST") {
      const text = String(body?.text ?? "");
      const provider = state.providers.find((candidate) => candidate.id === session.provider);
      if (!provider?.installed) return errorResponse(503, "provider_unavailable", "Provider unavailable");
      appendUserMessage(session, text, body?.attachments);
      streamReply(session, text);
      return json({ accepted: true }, 202);
    }
    const list = [...(state.messages.get(sessionId) ?? [])].reverse();
    return page(
      "messages",
      list,
      url.searchParams.get("cursor"),
      Number.parseInt(url.searchParams.get("limit") ?? "50", 10),
      "mock",
    );
  }

  const actionsMatch = /^\/api\/v1\/sessions\/([^/]+)\/actions$/.exec(path);
  if (actionsMatch) {
    const sessionId = decodeURIComponent(actionsMatch[1] ?? "");
    return json({ approvals: state.approvals.get(sessionId) ?? [], questions: state.questions.get(sessionId) ?? [] });
  }

  const queueMatch = /^\/api\/v1\/sessions\/([^/]+)\/(queue|steer|interrupt)$/.exec(path);
  if (queueMatch && method === "POST") {
    const sessionId = decodeURIComponent(queueMatch[1] ?? "");
    const action = queueMatch[2];
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return errorResponse(404, "session_not_found", "Unknown session");
    if (action === "interrupt") {
      emit(
        "turn.interrupted",
        { turnId: `turn_interrupt_${Date.now()}` },
        { provider: session.provider, projectId: session.projectId, sessionId },
      );
      session.state = "idle";
      return json({ accepted: true }, 202);
    }
    const text = String(body?.text ?? "");
    appendUserMessage(session, text, body?.attachments);
    emit(
      "session.updated",
      { session: { ...session } },
      { provider: session.provider, projectId: session.projectId, sessionId },
    );
    streamReply(session, text);
    return json({ accepted: true }, 202);
  }

  const approvalMatch = /^\/api\/v1\/approvals\/([^/]+)$/.exec(path);
  if (approvalMatch && method === "POST") {
    const requestId = decodeURIComponent(approvalMatch[1] ?? "");
    for (const [sessionId, list] of state.approvals) {
      state.approvals.set(
        sessionId,
        list.filter((request) => request.id !== requestId),
      );
    }
    emit(
      "approval.resolved",
      {
        resolution: {
          requestId,
          optionId: String(body?.optionId ?? "deny"),
          resolvedAt: nowTimestamp(),
          resolvedBy: "user",
        },
      },
      { sessionId: null, projectId: null },
    );
    return json({ resolved: true }, 202);
  }
  const questionMatch = /^\/api\/v1\/questions\/([^/]+)$/.exec(path);
  if (questionMatch && method === "POST") {
    const requestId = decodeURIComponent(questionMatch[1] ?? "");
    for (const [sessionId, list] of state.questions) {
      state.questions.set(
        sessionId,
        list.filter((request) => request.id !== requestId),
      );
    }
    emit(
      "question.resolved",
      {
        resolution: {
          requestId,
          answers: Array.isArray(body?.answers) ? body.answers : [],
          resolvedAt: nowTimestamp(),
        },
      },
      { sessionId: null, projectId: null },
    );
    return json({ resolved: true }, 202);
  }

  const modelMatch = /^\/api\/v1\/sessions\/([^/]+)\/model$/.exec(path);
  if (modelMatch && method === "POST") {
    const sessionId = decodeURIComponent(modelMatch[1] ?? "");
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return errorResponse(404, "session_not_found", "Unknown session");
    const modelId = String(body?.modelId ?? session.model?.modelId ?? "");
    session.model = {
      provider: session.provider,
      modelId,
      thinkingLevel: (body?.thinkingLevel as string | undefined) ?? null,
    };
    emit(
      "session.updated",
      { session: { ...session } },
      { provider: session.provider, projectId: session.projectId, sessionId },
    );
    return json({ accepted: true }, 202);
  }
  const modeMatch = /^\/api\/v1\/sessions\/([^/]+)\/mode$/.exec(path);
  if (modeMatch && method === "POST") {
    const sessionId = decodeURIComponent(modeMatch[1] ?? "");
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return errorResponse(404, "session_not_found", "Unknown session");
    session.mode = String(body?.mode ?? "default");
    emit(
      "session.updated",
      { session: { ...session } },
      { provider: session.provider, projectId: session.projectId, sessionId },
    );
    return json({ accepted: true }, 202);
  }

  const diffMatch = /^\/api\/v1\/sessions\/([^/]+)\/diff$/.exec(path);
  if (diffMatch) {
    const sessionId = decodeURIComponent(diffMatch[1] ?? "");
    return json({
      diff: {
        provider: state.sessions.find((candidate) => candidate.id === sessionId)?.provider ?? "opencode",
        sessionId,
        files: [
          {
            path: "src/lib/session.ts",
            status: "modified",
            additions: 12,
            deletions: 3,
            patch: "@@ -1,3 +1,12 @@\n-export const version = 1;\n+export const version = 2;\n",
          },
          { path: "docs/notes.md", status: "added", additions: 5, deletions: 0 },
        ],
      },
    });
  }

  const usageMatch = /^\/api\/v1\/providers\/([^/]+)\/usage$/.exec(path);
  if (usageMatch) {
    const providerId = decodeURIComponent(usageMatch[1] ?? "");
    if (providerId !== "claude" && providerId !== "opencode")
      return errorResponse(409, "unsupported_capability", "No usage");
    const usage: AgentUsage = {
      provider: providerId,
      windows: [
        { id: "five_hour", label: "5 hour", unit: "percent", usedPercent: 21.5 },
        {
          id: "seven_day",
          label: "Week",
          unit: "percent",
          usedPercent: 43,
          resetsAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
      fetchedAt: nowTimestamp(),
    };
    return json({ usage });
  }

  if (path === "/api/v1/attachments" && method === "POST") {
    const form = init?.body as FormData | undefined;
    const files = form ? [...form.getAll("file")].filter((entry): entry is File => entry instanceof File) : [];
    const attachments = [];
    for (const file of files) {
      const id = `att_mock_${state.attachments.size + 1}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      state.attachments.set(id, { mimeType: file.type || "application/octet-stream", name: file.name, bytes });
      attachments.push({
        id,
        kind: file.type.startsWith("image/") ? "image" : "file",
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: bytes.byteLength,
      });
    }
    return json({ attachments }, 201);
  }
  const attachmentMatch = /^\/api\/v1\/attachments\/([^/]+)$/.exec(path);
  if (attachmentMatch) {
    const id = decodeURIComponent(attachmentMatch[1] ?? "");
    const attachment = state.attachments.get(id);
    if (!attachment) return errorResponse(400, "invalid_attachment", "Unknown attachment");
    const bytes = new Uint8Array(attachment.bytes);
    return new Response(bytes.buffer, {
      headers: { "content-type": attachment.mimeType, "cache-control": "no-store" },
    });
  }

  return errorResponse(404, "not_found", `No mock route for ${method} ${path}`);
}

// --- SSE --------------------------------------------------------------------

export function createMockEventSource(since: number): { stream: ReadableStream<Uint8Array>; close(): void } {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown, id?: number) => {
        if (id !== undefined) write(`id: ${id}\n`);
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Reconnect scenario: fail the first connection shortly after opening.
      if (state.streamFailures > 0) {
        state.streamFailures -= 1;
        later(900, () => {
          closed = true;
          try {
            controller.error(new Error("mock stream dropped"));
          } catch {
            // already closed
          }
        });
        return;
      }

      send("ready", { latestSequence: state.sequence, protocolVersion: 1 });

      const replayFrom = since;
      if (state.scenario === "resync") {
        state.scenario = "normal";
        send("resync", { droppedBefore: state.sequence, latestSequence: state.sequence });
      }
      for (const buffered of state.buffers.filter((event) => event.sequence > replayFrom)) {
        send(buffered.type, buffered, buffered.sequence);
      }
      const subscriber = (event: SequencedAgentEvent) => send(event.type, event, event.sequence);
      state.subscribers.add(subscriber);
      unsubscribe = () => state.subscribers.delete(subscriber);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });

  return {
    stream,
    close: () => {
      closed = true;
      unsubscribe?.();
    },
  };
}

function mockTransport(): Transport {
  return {
    fetch: async (input, init) => {
      const url = new URL(input, window.location.origin);
      if (url.pathname === "/api/v1/events") {
        const source = createMockEventSource(Number.parseInt(url.searchParams.get("since") ?? "0", 10) || 0);
        return new Response(source.stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return handleRequest(input, init);
    },
  };
}

/** Installs the in-memory transport for the selected scenario. */
export function installMock(scenario: Scenario): void {
  state = buildState(scenario);
  setTransport(mockTransport());
  if (state.scenario === "active-stream") {
    const session = state.sessions.find(
      (candidate) => candidate.projectId === "prj_aurora" && candidate.provider === "opencode",
    );
    if (session) {
      later(1_500, () => {
        appendUserMessage(session, "Keep documenting while I watch.");
        streamReply(session, "Keep documenting while I watch.");
      });
    }
  }
  if (state.scenario === "long-conversation") {
    const session = state.sessions.find((candidate) => candidate.id === "ses_aurora_docs");
    if (session) session.state = "idle";
  }
}

export function disposeMock(): void {
  for (const timer of state?.timers ?? []) clearTimeout(timer);
  state?.subscribers.clear();
}
