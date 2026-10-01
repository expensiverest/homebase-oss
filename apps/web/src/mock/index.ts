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
  type AgentProviderUsage,
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
  "run-starting",
  "run-thinking",
  "run-tools",
  "confirm",
  "agents",
  "long-stream",
  "auth-unpaired",
  "mode-empty",
  "mode-error",
  "usage",
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
    providersAvailable: ["opencode", "claude", "grok"],
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
  {
    id: "prj_northwind",
    name: "northwind-customer-portal-platform",
    path: "/home/example/work/clients/northwind/northwind-customer-portal-platform",
    branch: "feature/long-running-migration-to-event-sourcing",
    providersAvailable: ["opencode", "claude"],
  },
  {
    id: "prj_kit",
    name: "kit",
    path: "/home/example/projects/kit",
    branch: "main",
    providersAvailable: ["claude"],
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

const GROK_MODES: AgentMode[] = [
  { id: "default", name: "Build", description: "Act on the task" },
  { id: "plan", name: "Plan", description: "Explore and propose; make no changes" },
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
  if (provider === "grok") {
    return [
      {
        id: "grok-4.7",
        provider: "grok",
        name: "Grok 4.7",
        description: "Frontier model",
        contextWindow: 256_000,
        thinkingLevels: [
          { id: "high", name: "High" },
          { id: "low", name: "Low" },
        ],
        defaultThinkingLevel: "high",
        inputCapabilities: { text: true, image: false, file: false },
      },
      {
        id: "grok-4.6",
        provider: "grok",
        name: "Grok 4.6",
        contextWindow: 500_000,
        thinkingLevels: [
          { id: "high", name: "High" },
          { id: "low", name: "Low" },
        ],
        defaultThinkingLevel: "high",
        inputCapabilities: { text: true, image: false, file: false },
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
  const defaultModel =
    provider === "claude" ? "sonnet" : provider === "grok" ? "grok-4.7" : "example-provider/aurora-1";
  return {
    id,
    provider,
    projectId,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    state,
    model: { provider, modelId: modelId ?? defaultModel },
    mode: "default",
    thinkingLevel: provider === "claude" || provider === "grok" ? "high" : "medium",
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
        sessionUsage: true,
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
        sessionUsage: true,
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
        providerUsage: true,
      }),
      warning:
        scenario === "signed-out" ? "Claude Code is not signed in; run `claude` on this machine to sign in." : null,
    },
    {
      id: "grok",
      name: "Grok",
      version: "1.0.41",
      installed: true,
      authenticated: true,
      compatible: true,
      capabilities: defineCapabilities({
        sessionUsage: true,
        resume: true,
        streaming: true,
        interrupt: true,
        models: true,
        modelSwitching: true,
        thinkingLevels: true,
        modes: true,
        tools: true,
        approvals: true,
        plans: true,
      }),
      warning: null,
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
      makeSession("grok", "prj_aurora", "ses_aurora_grok", "Draft the migration plan", "idle", 30),
      makeSession(
        "claude",
        "prj_northwind",
        "ses_northwind_export",
        "Investigate why the nightly export job occasionally produces duplicate rows for customers in multiple regions",
        "waiting",
        8,
        "opus",
      ),
      makeSession(
        "opencode",
        "prj_northwind",
        "ses_northwind_sdk",
        "Upgrade the payments SDK",
        "idle",
        26 * 60,
        "example-provider/comet-7",
      ),
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
    scenario === "long-conversation" || scenario === "long-stream"
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
  messages.set("ses_beacon_api", [
    textMessage(
      "ses_beacon_api",
      "user",
      "Add cursor pagination to the audit log endpoint. Keep the old offset parameter working for one release.",
      "msg_api_u1",
      520,
    ),
    textMessage("ses_beacon_api", "assistant", "I'll read the current handler and its tests first.", "msg_api_a1", 519),
    toolMessage(
      "ses_beacon_api",
      {
        id: "tool_api_read",
        name: "read",
        status: "completed",
        input: { file_path: "src/routes/audit-log.ts" },
        output: { type: "text", text: "export async function listAuditLog(req) { /* offset */ }" },
        startedAt: new Date(Date.now() - 519 * 60000).toISOString(),
      },
      "completed",
      519,
    ),
    toolMessage(
      "ses_beacon_api",
      {
        id: "tool_api_grep",
        name: "grep",
        status: "completed",
        input: { pattern: "offset", path: "src" },
        startedAt: new Date(Date.now() - 518 * 60000).toISOString(),
      },
      "completed",
      518,
    ),
    toolMessage(
      "ses_beacon_api",
      {
        id: "tool_api_edit",
        name: "edit",
        status: "completed",
        input: { file_path: "src/routes/audit-log.ts" },
        startedAt: new Date(Date.now() - 514 * 60000).toISOString(),
      },
      "completed",
      514,
    ),
    toolMessage(
      "ses_beacon_api",
      {
        id: "tool_api_test",
        name: "bash",
        status: "completed",
        input: { command: "npm test -- audit-log" },
        output: { type: "text", text: "Tests: 14 passed, 14 total" },
        startedAt: new Date(Date.now() - 512 * 60000).toISOString(),
      },
      "completed",
      512,
    ),
    {
      ...textMessage(
        "ses_beacon_api",
        "assistant",
        [
          "Cursor pagination is in place and the offset parameter still works.",
          "",
          "## What changed",
          "",
          "- `GET /audit-log` accepts `cursor` and `limit` and returns `nextCursor`.",
          "- Cursors are opaque: a base64url encoding of `(createdAt, id)`, so rows with the same timestamp never repeat or vanish between pages.",
          "- `offset` still works but logs a deprecation warning. It goes away in 0.6.",
          "",
          "## Example",
          "",
          "```ts",
          "const page = await client.auditLog.list({ limit: 50 });",
          "for (const entry of page.items) render(entry);",
          "if (page.nextCursor) await client.auditLog.list({ cursor: page.nextCursor });",
          "```",
          "",
          "## Follow-ups",
          "",
          "1. Update the admin UI to use `nextCursor` instead of page numbers.",
          "2. Add an index on `(created_at, id)`; the query plan still scans on large tenants.",
          "",
          "All 14 audit-log tests pass.",
        ].join("\n"),
        "msg_api_a2",
        510,
      ),
      createdAt: new Date(Date.now() - 519 * 60000).toISOString(),
    },
  ]);
  messages.set("ses_northwind_export", [
    textMessage(
      "ses_northwind_export",
      "user",
      "The nightly export sometimes writes the same customer twice when they have accounts in two regions. Find out why.",
      "msg_nw_u1",
      20,
    ),
    textMessage(
      "ses_northwind_export",
      "assistant",
      "The export joins accounts before de-duplicating customers, so a customer with two regional accounts yields two rows. I'd like to run the export against the fixture database to confirm.",
      "msg_nw_a1",
      9,
    ),
  ]);
  messages.set("ses_cedar_release", [
    textMessage("ses_cedar_release", "user", "Prepare the 0.4 release notes.", "msg_rel_u1", 95),
    textMessage("ses_cedar_release", "assistant", "Collecting merged PRs...", "msg_rel_a1", 94),
  ]);
  messages.set("ses_aurora_grok", [
    textMessage(
      "ses_aurora_grok",
      "user",
      "Draft a migration plan for moving sessions to the new store.",
      "msg_grok_u1",
      35,
    ),
    textMessage(
      "ses_aurora_grok",
      "assistant",
      "The current store keeps one JSON index per project. I would move to append-only logs first, then migrate readers.",
      "msg_grok_a1",
      34,
    ),
    toolMessage(
      "ses_aurora_grok",
      {
        id: "tool_grok_1",
        name: "read",
        status: "completed",
        title: "Read session store",
        input: { path: "src/lib/session.ts" },
        output: { type: "text", text: "export interface SessionStore {}" },
        startedAt: new Date(Date.now() - 34 * 60000).toISOString(),
      },
      "completed",
      34,
    ),
    textMessage("ses_aurora_grok", "assistant", "Plan drafted in three steps.", "msg_grok_a2", 33),
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
    approvals.set("ses_aurora_grok", [
      {
        id: "hb1~grok~YXBwcl9ncm9r",
        sessionId: "ses_aurora_grok",
        provider: "grok",
        createdAt: new Date(Date.now() - 45_000).toISOString(),
        kind: "command",
        title: "Run the test suite",
        detail: "npm test",
        toolCallId: "tool_grok_perm",
        options: [
          { id: "allow-once", label: "Allow once", kind: "allow_once" },
          { id: "allow-always", label: "Allow always", kind: "allow_always" },
          { id: "reject-once", label: "Reject once", kind: "deny" },
        ],
      },
    ]);
  }
  if (scenario === "confirm") {
    questions.set("ses_beacon_ui", [
      {
        id: "hb1~opencode~Y29uZmlybQ",
        sessionId: "ses_beacon_ui",
        provider: "opencode",
        createdAt: new Date(Date.now() - 30_000).toISOString(),
        title: "Questions",
        questions: [
          {
            id: "q0",
            header: "It keeps settings queryable and works offline; the JSON file would need a migration later.",
            question: "Use SQLite for local settings storage?",
            kind: "confirm",
          },
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

  const withReasoning =
    state.scenario === "reasoning" && (session.provider === "opencode" || session.provider === "grok");
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
  if (state.scenario === "auth-unpaired") {
    const paired = sessionStorage.getItem("hb.mockPaired") === "1";
    const current = {
      id: "00000000-0000-4000-8000-000000000001",
      name: sessionStorage.getItem("hb.mockDeviceName") ?? "Phone",
      createdAt: "2026-09-28T00:00:00.000Z",
      lastSeenAt: null,
      revokedAt: null,
      current: true,
    };
    const other = { ...current, id: "00000000-0000-4000-8000-000000000002", name: "Work iPad", current: false };
    if (path === "/api/v1/auth/status")
      return json({ mode: "device", authenticated: paired, ...(paired ? { device: current } : {}) });
    if (path === "/api/v1/pairing/redeem") {
      const token = String(body?.credential ?? "");
      const status = token.endsWith("B".repeat(43))
        ? "expired"
        : token.endsWith("C".repeat(43)) || sessionStorage.getItem("hb.mockInviteUsed") === "1"
          ? "used"
          : token.endsWith("A".repeat(43))
            ? "ok"
            : "invalid";
      if (status !== "ok") return errorResponse(400, `pairing_${status}`, "Invitation unavailable");
      sessionStorage.setItem("hb.mockInviteUsed", "1");
      sessionStorage.setItem("hb.mockPaired", "1");
      sessionStorage.setItem("hb.mockDeviceName", String(body?.name ?? "Phone"));
      return json({ device: { ...current, name: String(body?.name ?? "Phone") } }, 201);
    }
    if (!paired) return errorResponse(401, "invalid_request", "Device pairing required");
    if (path === "/api/v1/devices" && method === "GET") return json({ devices: [current, other] });
    const deviceMatch = /^\/api\/v1\/devices\/([^/]+)$/.exec(path);
    if (deviceMatch && method === "PATCH") {
      const name = String(body?.name ?? "");
      if (deviceMatch[1] === current.id) sessionStorage.setItem("hb.mockDeviceName", name);
      return json({ device: { ...(deviceMatch[1] === current.id ? current : other), name } });
    }
    if (deviceMatch && method === "DELETE") {
      if (deviceMatch[1] === current.id) sessionStorage.removeItem("hb.mockPaired");
      return json({
        device: { ...(deviceMatch[1] === current.id ? current : other), revokedAt: new Date().toISOString() },
      });
    }
  }

  // Simulates a Host that is up but failing every request (for error states).
  if (state.scenario === "host-error") {
    return errorResponse(500, "internal", "The Host hit an internal error.");
  }

  if (path === "/api/v1/health") return json({ status: "ok", version: "0.0.1-mock", latestSequence: state.sequence });
  if (path === "/api/v1/auth/status") return json({ mode: "none", authenticated: true });
  if (path === "/api/v1/providers") return json({ providers: state.providers });
  if (path === "/api/v1/providers/refresh") return json({ providers: state.providers });
  if (path === "/api/v1/projects") return json({ projects: state.projects });
  const rootId = "root_111111111111",
    clientRoot = "root_222222222222";
  const summaries = state.projects
    .map((project) => {
      const sessions = state.sessions.filter((s) => s.projectId === project.id && !s.parentSessionId);
      return {
        ...project,
        rootId: project.id === "prj_northwind" ? clientRoot : rootId,
        lastActivityAt:
          sessions
            .map((s) => s.updatedAt)
            .sort()
            .at(-1) ?? null,
        knownSessionCount: sessions.length,
        workingCount: sessions.filter((s) => s.state === "working").length,
        waitingCount: sessions.filter((s) => s.state === "waiting").length,
      };
    })
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || a.name.localeCompare(b.name));
  if (path === "/api/v1/projects/overview")
    return json({
      recent: summaries.filter((p) => p.lastActivityAt).slice(0, 5),
      roots: state.projects.length
        ? [
            {
              id: rootId,
              name: "Development",
              path: "/home/example/projects",
              available: true,
              projectCount: summaries.filter((p) => p.rootId === rootId).length,
              lastActivityAt: summaries[0]?.lastActivityAt ?? null,
            },
            {
              id: clientRoot,
              name: "Clients",
              path: "/home/example/work/clients",
              available: true,
              projectCount: 1,
              lastActivityAt: null,
            },
          ]
        : [],
    });
  const rootMatch = /^\/api\/v1\/project-roots\/([^/]+)\/projects$/.exec(path);
  if (rootMatch) return json({ projects: summaries.filter((p) => p.rootId === rootMatch[1]) });
  const sessionUsageMatch = /^\/api\/v1\/sessions\/([^/]+)\/usage$/.exec(path);
  if (sessionUsageMatch) {
    const session = state.sessions.find((s) => s.id === decodeURIComponent(sessionUsageMatch[1]!));
    return json({
      usage: session
        ? {
            provider: session.provider,
            sessionId: session.id,
            tokens: {
              inputTokens: 10000,
              outputTokens: 2400,
              totalTokens: 12400,
              cacheReadTokens: 2000,
              cacheWriteTokens: 300,
              reasoningTokens: 400,
            },
            costUsd: 0.08,
            updatedAt: session.updatedAt,
          }
        : null,
    });
  }
  const fileMatch = /^\/api\/v1\/projects\/([^/]+)\/(files|file|file-bytes)$/.exec(path);
  if (fileMatch) {
    const relativePath = url.searchParams.get("path") ?? "";
    const projectId = decodeURIComponent(fileMatch[1]!);
    const data: Record<
      string,
      { kind: "text" | "image" | "unsupported" | "too-large"; text?: string; language?: string; sizeBytes: number }
    > = {
      "README.md": {
        kind: "text",
        language: "markdown",
        text: "# Project notes\n\nA calm read-only preview.\n\n[unsafe](javascript:alert(1))\n<script>alert(1)</script>\n![blocked](https://example.com/private.png)",
        sizeBytes: 180,
      },
      "src/index.ts": {
        kind: "text",
        language: "typescript",
        text: "export function hello(name: string) {\n  return `Hello, ${name}`;\n}\n",
        sizeBytes: 80,
      },
      "src/index.html": {
        kind: "text",
        language: "html",
        text: "<script>window.projectExecuted = true</script>",
        sizeBytes: 48,
      },
      "src/a-very-long-component-filename-for-mobile-layout-testing.tsx": {
        kind: "text",
        language: "tsx",
        text: "export const Example = () => <div>Example</div>;",
        sizeBytes: 49,
      },
      "logo.png": { kind: "image", sizeBytes: 70 },
      "archive.bin": { kind: "unsupported", sizeBytes: 512 },
      "large.log": { kind: "too-large", sizeBytes: 2097152 },
      "unsafe.svg": { kind: "unsupported", sizeBytes: 200 },
    };
    if (fileMatch[2] === "files") {
      const folders = ["src", "empty"];
      const entries =
        relativePath === "empty"
          ? []
          : Object.entries(data)
              .filter(([key]) => key.split("/").slice(0, -1).join("/") === relativePath)
              .map(([key, value]) => ({
                name: key.split("/").at(-1)!,
                relativePath: key,
                kind: "file",
                sizeBytes: value.sizeBytes,
                modifiedAt: null,
                accessible: true,
              }));
      if (!relativePath)
        entries.unshift(
          ...folders.map((name) => ({
            name,
            relativePath: name,
            kind: "directory",
            sizeBytes: 0,
            modifiedAt: null,
            accessible: true,
          })),
        );
      entries.sort((a, b) => {
        const foldersFirst = Number(b.kind === "directory") - Number(a.kind === "directory");
        return foldersFirst || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      return json({ projectId, relativePath, entries, truncated: false });
    }
    if (fileMatch[2] === "file-bytes")
      return new Response(
        Uint8Array.from(
          atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII="),
          (c) => c.charCodeAt(0),
        ),
        { headers: { "content-type": "image/png" } },
      );
    const value = data[relativePath];
    return value
      ? json({
          projectId,
          relativePath,
          name: relativePath.split("/").at(-1),
          language: value.language ?? null,
          mimeType: value.kind === "image" ? "image/png" : null,
          ...value,
        })
      : errorResponse(404, "not_found", "File unavailable");
  }

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
      .filter((session) => session.projectId === projectId && !session.parentSessionId)
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
    if (state.scenario === "mode-error") return errorResponse(503, "provider_unavailable", "Catalog unavailable");
    if (state.scenario === "mode-empty") return json({ modes: [] });
    return json({ modes: providerId === "claude" ? CLAUDE_MODES : providerId === "grok" ? GROK_MODES : MODES });
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
          (providerId === "claude" ? "sonnet" : providerId === "grok" ? "grok-4.7" : "example-provider/aurora-1"),
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
    if (providerId !== "claude") return errorResponse(409, "unsupported_capability", "No usage");
    const usage: AgentProviderUsage = {
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
  let unsubscribeRevocation: (() => void) | null = null;

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
      if (state.scenario === "auth-unpaired") {
        const revoke = () => {
          sessionStorage.removeItem("hb.mockPaired");
          send("auth.revoked", { reason: "device_revoked" });
          closed = true;
          unsubscribe?.();
          controller.close();
        };
        window.addEventListener("homebase:mock-remote-revoke", revoke, { once: true });
        unsubscribeRevocation = () => window.removeEventListener("homebase:mock-remote-revoke", revoke);
      }

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
      unsubscribeRevocation?.();
    },
  });

  return {
    stream,
    close: () => {
      closed = true;
      unsubscribe?.();
      unsubscribeRevocation?.();
    },
  };
}

function mockTransport(): Transport {
  return {
    fetch: async (input, init) => {
      const url = new URL(input, window.location.origin);
      if (url.pathname === "/api/v1/events") {
        if (state.scenario === "auth-unpaired" && sessionStorage.getItem("hb.mockPaired") !== "1")
          return errorResponse(401, "invalid_request", "Device pairing required");
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
  if (state.scenario === "run-starting" || state.scenario === "run-thinking" || state.scenario === "run-tools") {
    const session = state.sessions.find((candidate) => candidate.id === "ses_aurora_docs");
    if (session) scriptLiveRun(session, state.scenario);
  }
  if (state.scenario === "long-conversation" || state.scenario === "long-stream") {
    const session = state.sessions.find((candidate) => candidate.id === "ses_aurora_docs");
    if (session) session.state = "idle";
    // A long history that keeps receiving live replies, to check that reading older
    // messages is never interrupted by new ones.
    if (session && state.scenario === "long-stream") {
      [2_500, 6_500, 10_500].forEach((delay, index) =>
        later(delay, () => {
          appendUserMessage(session, `Live follow-up ${index + 1}`);
          streamReply(session, `Live follow-up ${index + 1}`);
        }),
      );
    }
  }
  if (state.scenario === "agents") {
    const session = state.sessions.find((candidate) => candidate.id === "ses_aurora_docs");
    if (session) scriptAgentsRun(session);
  }
  if (state.scenario === "attachments") seedImageMessages();
}

/** Two non-square pictures already in the conversation: one from the user, one from the model. */
function seedImageMessages(): void {
  const picture = (from: string, to: string, label: string) =>
    new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/>` +
        `<stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="720" height="480" fill="url(#g)"/>` +
        `<circle cx="150" cy="240" r="90" fill="#fff" fill-opacity=".85"/><rect x="330" y="150" width="300" height="180" rx="24" fill="#fff" fill-opacity=".85"/>` +
        `<text x="360" y="440" font-size="40" font-family="sans-serif" fill="#fff" text-anchor="middle">${label}</text></svg>`,
    );
  state.attachments.set("att_seed_screenshot", {
    mimeType: "image/svg+xml",
    name: "mockup.svg",
    bytes: picture("#6d5ef5", "#2bb5a0", "Your screenshot"),
  });
  // A tall phone screenshot (402x874), to check portrait images in the large preview.
  state.attachments.set("att_seed_phone", {
    mimeType: "image/svg+xml",
    name: "phone-screenshot.svg",
    bytes: new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="402" height="874" viewBox="0 0 402 874">` +
        `<rect width="402" height="874" fill="#f5f3ee"/><rect y="0" width="402" height="62" fill="#e8e4da"/>` +
        `<text x="34" y="40" font-size="20" font-family="sans-serif" font-weight="700" fill="#222">4:56</text>` +
        `<rect x="24" y="110" width="354" height="90" rx="20" fill="#5a52dc"/><rect x="24" y="230" width="354" height="60" rx="16" fill="#fff"/>` +
        `<rect x="24" y="310" width="354" height="60" rx="16" fill="#fff"/><rect x="24" y="390" width="354" height="60" rx="16" fill="#fff"/>` +
        `<text x="201" y="860" font-size="16" font-family="sans-serif" fill="#666" text-anchor="middle">Phone screenshot</text></svg>`,
    ),
  });
  state.attachments.set("att_seed_chart", {
    mimeType: "image/svg+xml",
    name: "latency-chart.svg",
    bytes: picture("#f0883e", "#d1477a", "Model output"),
  });
  const sessionId = "ses_aurora_docs";
  const user: AgentMessage = {
    id: "msg_seed_image_user",
    sessionId,
    role: "user",
    createdAt: nowTimestamp(),
    state: "completed",
    parts: [
      { type: "text", id: "msg_seed_image_user:text", text: "Here is the layout I mean." },
      {
        type: "image",
        id: "msg_seed_image_user:img",
        attachmentId: "att_seed_screenshot",
        mimeType: "image/svg+xml",
        name: "mockup.svg",
      },
      {
        type: "image",
        id: "msg_seed_image_user:phone",
        attachmentId: "att_seed_phone",
        mimeType: "image/svg+xml",
        name: "phone-screenshot.svg",
      },
    ],
  };
  const assistant: AgentMessage = {
    id: "msg_seed_image_assistant",
    sessionId,
    role: "assistant",
    createdAt: nowTimestamp(),
    state: "completed",
    parts: [
      { type: "text", id: "msg_seed_image_assistant:text", text: "Got it. Here is the latency chart for that layout." },
      {
        type: "image",
        id: "msg_seed_image_assistant:img",
        attachmentId: "att_seed_chart",
        mimeType: "image/svg+xml",
        name: "latency-chart.svg",
      },
    ],
  };
  state.messages.set(sessionId, [...(state.messages.get(sessionId) ?? []), user, assistant]);
}

/**
 * A model that fans out to sub-agents. One turn plays through in real time
 * (about 22 seconds): the main agent thinks, spawns four agents a beat apart,
 * they finish at different times (one fails), then the main agent summarises.
 * Reload the page to watch it again.
 */
function scriptAgentsRun(session: AgentSession): void {
  const context = { provider: session.provider, projectId: session.projectId, sessionId: session.id };
  const prompt = "Audit the gateway: review the routes, tests, docs and dependencies in parallel.";
  session.state = "working";
  appendUserMessage(session, prompt);
  const messageId = "msg_agents_scripted";
  const textId = `${messageId}:text:0`;
  const startedAt = nowTimestamp();

  const specs = [
    {
      id: "agent_routes",
      childId: "ses_agent_routes",
      steps: [
        ["read", { file_path: "src/routes/gateway.ts" }],
        ["grep", { pattern: "requireAuth", path: "src" }],
      ] as Array<[string, Record<string, string>]>,
      description: "Review gateway routes",
      kind: "explore",
      prompt: "Read src/routes/gateway.ts and list every endpoint with its auth requirement and pagination shape.",
      spawnAt: 1_800,
      endAt: 9_000,
      result:
        "Found 4 endpoints. `/sessions` and `/sessions/:id/messages` are cursor-paged; only `/events` is unauthenticated.",
    },
    {
      id: "agent_tests",
      childId: "ses_agent_tests",
      steps: [
        ["bash", { command: "npm test -- gateway" }],
        ["read", { file_path: "test/gateway.test.ts" }],
      ] as Array<[string, Record<string, string>]>,
      description: "Run and read the gateway tests",
      kind: "general-purpose",
      prompt: "Run `npm test -- gateway`, then summarise which behaviours have no test coverage.",
      spawnAt: 2_600,
      endAt: 17_000,
      result: "38 tests pass. No coverage for cursor expiry or the retry headers on `/events`.",
    },
    {
      id: "agent_docs",
      childId: "ses_agent_docs",
      steps: [
        ["read", { file_path: "docs/gateway.md" }],
        ["grep", { pattern: "nextCursor", path: "docs" }],
      ] as Array<[string, Record<string, string>]>,
      description: "Compare docs with the code",
      kind: "explore",
      prompt: "Diff docs/gateway.md against the routes and report anything stale or missing.",
      spawnAt: 3_400,
      endAt: 13_000,
      result: "docs/gateway.md is missing `nextCursor` and still documents the removed `/v1/poll` endpoint.",
    },
    {
      id: "agent_deps",
      childId: "ses_agent_deps",
      steps: [
        ["read", { file_path: "package.json" }],
        ["bash", { command: "npm audit --json" }],
      ] as Array<[string, Record<string, string>]>,
      description: "Audit dependency versions",
      kind: "general-purpose",
      prompt: "Check every gateway dependency against the registry for known advisories.",
      spawnAt: 4_200,
      endAt: 11_000,
      error: "The npm registry request timed out after 30s.",
    },
  ];

  const toolFor = (spec: (typeof specs)[number], status: AgentToolCall["status"], started: string): AgentToolCall => ({
    id: spec.id,
    name: "task",
    status,
    title: spec.description,
    input: { description: spec.description, subagent_type: spec.kind, prompt: spec.prompt },
    startedAt: started,
    childSessionId: spec.childId,
    ...(status === "completed"
      ? { output: { type: "text", text: spec.result ?? "" }, completedAt: nowTimestamp() }
      : {}),
    ...(status === "failed" ? { error: spec.error ?? "The agent failed.", completedAt: nowTimestamp() } : {}),
  });

  const initial: AgentMessage = {
    id: messageId,
    sessionId: session.id,
    role: "assistant",
    createdAt: startedAt,
    state: "streaming",
    parts: [
      {
        type: "reasoning",
        id: `${messageId}:reasoning:0`,
        text: "This splits cleanly into four independent checks, so I will hand each to its own agent and merge what they report.",
      },
      { type: "text", id: textId, text: "" },
    ],
  };
  later(300, () => {
    emit("turn.started", { turnId: "turn_agents" }, context);
    emit("message.started", { message: initial }, context);
  });

  // The sub-agent's own thread: a child session that fills in while it works.
  const childTool = (
    spec: (typeof specs)[number],
    index: number,
    status: AgentToolCall["status"],
  ): AgentMessage["parts"][number] => {
    const [name, input] = spec.steps[index]!;
    const id = `${spec.childId}:tool:${index}`;
    return {
      type: "tool_call",
      id,
      toolCall: {
        id,
        name,
        title: name,
        status,
        input,
        startedAt: nowTimestamp(),
        ...(status === "completed" ? { output: { type: "text", text: "ok" }, completedAt: nowTimestamp() } : {}),
      },
    };
  };
  const spawnChild = (spec: (typeof specs)[number]) => {
    const child: AgentSession = {
      id: spec.childId,
      provider: session.provider,
      projectId: session.projectId,
      title: spec.description,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
      state: "working",
      model: session.model ?? null,
      mode: spec.kind,
      parentSessionId: session.id,
    };
    state.sessions.push(child);
    appendUserMessage(child, spec.prompt);
    const working: AgentMessage = {
      id: `${spec.childId}:msg`,
      sessionId: child.id,
      role: "assistant",
      createdAt: nowTimestamp(),
      state: "streaming",
      parts: [childTool(spec, 0, "completed"), childTool(spec, 1, "running")],
    };
    state.messages.set(child.id, [...(state.messages.get(child.id) ?? []), working]);
  };
  const finishChild = (spec: (typeof specs)[number], status: AgentToolCall["status"]) => {
    const child = state.sessions.find((candidate) => candidate.id === spec.childId);
    if (!child) return;
    const failed = status === "failed";
    const done: AgentMessage = {
      id: `${spec.childId}:msg`,
      sessionId: child.id,
      role: "assistant",
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
      state: failed ? "failed" : "completed",
      parts: [
        childTool(spec, 0, "completed"),
        childTool(spec, 1, failed ? "failed" : "completed"),
        failed
          ? { type: "error", id: `${spec.childId}:error`, message: spec.error ?? "The agent failed." }
          : { type: "text", id: `${spec.childId}:text`, text: spec.result ?? "Done." },
      ],
    };
    const messages = state.messages.get(child.id) ?? [];
    state.messages.set(
      child.id,
      messages.map((message) => (message.id === done.id ? done : message)),
    );
    child.state = failed ? "failed" : "idle";
    child.updatedAt = nowTimestamp();
    const childContext = { provider: child.provider, projectId: child.projectId, sessionId: child.id };
    emit("message.completed", { message: done }, childContext);
    emit("session.updated", { session: { ...child } }, childContext);
  };

  const startedAtByAgent = new Map<string, string>();
  const outcomes = new Map<string, AgentToolCall["status"]>();
  for (const spec of specs) {
    later(spec.spawnAt, () => {
      const started = nowTimestamp();
      startedAtByAgent.set(spec.id, started);
      spawnChild(spec);
      emit("tool.started", { toolCall: toolFor(spec, "running", started) }, context);
    });
    later(spec.endAt, () => {
      const status = spec.error ? "failed" : "completed";
      outcomes.set(spec.id, status);
      finishChild(spec, status);
      const toolCall = toolFor(spec, status, startedAtByAgent.get(spec.id) ?? startedAt);
      emit(status === "failed" ? "tool.failed" : "tool.completed", { toolCall }, context);
    });
  }

  const summary =
    "All four agents reported back. The routes are cursor-paged and only `/events` is public; the gateway tests pass but skip cursor expiry; `docs/gateway.md` is missing `nextCursor` and documents a removed endpoint; and the dependency audit could not finish (registry timeout), so I will retry it.";
  const words = summary.split(/\s+/);
  const streamFrom = 18_000;
  words.forEach((word, index) => {
    later(streamFrom + index * 60, () =>
      emit(
        "message.delta",
        { messageId, partId: textId, delta: `${word}${index < words.length - 1 ? " " : ""}` },
        context,
      ),
    );
  });
  later(streamFrom + words.length * 60 + 300, () => {
    const completed: AgentMessage = {
      ...initial,
      state: "completed",
      updatedAt: nowTimestamp(),
      parts: [
        initial.parts[0]!,
        ...specs.map((spec) => ({
          type: "tool_call" as const,
          id: `tool:${spec.id}`,
          toolCall: toolFor(spec, outcomes.get(spec.id) ?? "completed", startedAtByAgent.get(spec.id) ?? startedAt),
        })),
        { type: "text", id: textId, text: summary },
      ],
    };
    emit("message.completed", { message: completed }, context);
    emit("turn.completed", { turnId: "turn_agents" }, context);
    const stored = state.messages.get(session.id) ?? [];
    stored.push(completed);
    state.messages.set(session.id, stored);
    session.state = "idle";
  });
}

/**
 * Holds a live turn at one moment for visual QA: just started (nothing yet),
 * reasoning in progress, or tools in flight. The run never finishes.
 */
function scriptLiveRun(session: AgentSession, scenario: "run-starting" | "run-thinking" | "run-tools"): void {
  const context = { provider: session.provider, projectId: session.projectId, sessionId: session.id };
  session.state = "working";
  const prompt = "Add request examples for both endpoints.";
  appendUserMessage(session, prompt);
  const messageId = "msg_live_scripted";
  const started = new Date(Date.now() - 12_000).toISOString();
  const parts: AgentMessage["parts"] = [];
  if (scenario === "run-thinking" || scenario === "run-tools") {
    parts.push({
      type: "reasoning",
      id: `${messageId}:reasoning:0`,
      text:
        scenario === "run-thinking"
          ? "The docs should show one request per endpoint. The messages endpoint pages with a cursor, so the example needs `nextCursor`"
          : "The docs should show one request per endpoint, with the cursor for the messages page.",
    });
  }
  if (scenario === "run-tools") {
    const tool = (
      id: string,
      name: string,
      input: Record<string, string>,
      status: AgentToolCall["status"],
      ago: number,
    ) => ({
      type: "tool_call" as const,
      id,
      toolCall: {
        id,
        name,
        status,
        input,
        ...(status === "completed"
          ? { output: { type: "text", text: "ok" }, completedAt: new Date(Date.now() - (ago - 2) * 1000).toISOString() }
          : {}),
        startedAt: new Date(Date.now() - ago * 1000).toISOString(),
      },
    });
    parts.push(
      tool("tool_run_read", "read", { file_path: "src/routes/gateway.ts" }, "completed", 10),
      tool("tool_run_grep", "grep", { pattern: "nextCursor", path: "src" }, "completed", 8),
      tool("tool_run_test", "bash", { command: "npm test -- gateway" }, "running", 4),
    );
  }
  const message: AgentMessage = {
    id: messageId,
    sessionId: session.id,
    role: "assistant",
    createdAt: started,
    state: "streaming",
    parts,
  };
  later(300, () => {
    emit("turn.started", { turnId: "turn_scripted" }, context);
    emit("message.started", { message }, context);
  });
}

export function disposeMock(): void {
  for (const timer of state?.timers ?? []) clearTimeout(timer);
  state?.subscribers.clear();
}
