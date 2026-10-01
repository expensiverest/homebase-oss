import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  defineCapabilities,
  type AgentApprovalRequest,
  type AgentMessage,
  type AgentProvider,
  type AgentQuestionRequest,
  type AgentSession,
  type AgentToolCall,
} from "@homebase/protocol";

import { ApprovalCard, QuestionCard } from "../components/ActionCards.js";
import { FileChip } from "../components/attachments.js";
import { ThemeToggle } from "../components/chrome.js";
import { PendingAttachmentChip } from "../components/attachments.js";
import { CodeBlock } from "../components/beautiful/CodeBlock.js";
import { LoadingState } from "../components/beautiful/LoadingState.js";
import { PromptBar } from "../components/beautiful/PromptBar.js";
import { TaskRows } from "../components/beautiful/TaskRows.js";
import { Thinking } from "../components/beautiful/Thinking.js";
import { ToolChips } from "../components/beautiful/ToolChips.js";
import { Timeline, toolChipItem, toolTaskRow } from "../components/ChatTimeline.js";
import { Markdown } from "../components/Markdown.js";
import { Composer } from "../components/Composer.js";
import { ModeSheet } from "../components/Sheets.js";
import { ProviderUsageDetail, SessionUsageDetail } from "../components/Usage.js";
import { ProjectRow } from "../components/ProjectRow.js";
import { FileContent } from "./FilesScreen.js";
import { ProjectMark, ProviderMark } from "../components/marks.js";
import {
  BranchChip,
  Button,
  EmptyState,
  ErrorState,
  Group,
  IconButton,
  PickerButton,
  Pill,
  Row,
  Segmented,
  Sheet,
  Skeleton,
  StatusDot,
  TextField,
} from "../components/ui.js";
import { writeDraft } from "../lib/prefs.js";
import { useTheme, type ThemeSetting } from "../lib/theme.js";
import { foldTimeline, sessionStatus } from "../lib/viewmodel.js";

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const SAMPLE_TOOLS: AgentToolCall[] = [
  {
    id: "t1",
    name: "read",
    status: "completed",
    input: { file_path: "src/routes/gateway.ts" },
    output: "export const routes = []",
    startedAt: iso(3),
  },
  { id: "t2", name: "bash", status: "running", input: { command: "npm test -- --runInBand" }, startedAt: iso(1) },
  {
    id: "t3",
    name: "write",
    status: "failed",
    title: "Write README.md",
    error: "Permission denied",
    startedAt: iso(2),
  },
  { id: "t4", name: "webfetch", status: "denied", input: { url: "https://example.com" }, startedAt: iso(2) },
  { id: "t5", name: "future_tool", status: "completed", input: { anything: true }, startedAt: iso(2) },
];

const SAMPLE_APPROVAL: AgentApprovalRequest = {
  id: "dev_approval",
  sessionId: "dev_session",
  provider: "mock",
  createdAt: iso(1),
  kind: "command",
  title: "Bash: npm test",
  detail: "npm test -- --runInBand",
  options: [
    { id: "allow_once", label: "Allow once", kind: "allow_once", description: "Runs this command once" },
    { id: "allow_always", label: "Always allow", kind: "allow_always", description: "Until this session ends" },
    { id: "deny", label: "Deny", kind: "deny" },
  ],
};

const SAMPLE_QUESTION: AgentQuestionRequest = {
  id: "dev_question",
  sessionId: "dev_session",
  provider: "mock",
  createdAt: iso(1),
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
  ],
};

const text = (id: string, role: "user" | "assistant", body: string, minutesAgo: number): AgentMessage => ({
  id,
  sessionId: "dev_session",
  role,
  createdAt: iso(minutesAgo),
  updatedAt: iso(minutesAgo),
  state: "completed",
  parts: [{ type: "text", id: `${id}:t`, text: body }],
});

const SAMPLE_CONVERSATION: AgentMessage[] = [
  text("m1", "user", "Document the gateway endpoints so the mobile client can use them.", 12),
  text("m2", "assistant", "Reading the routes first.", 11),
  {
    id: "m3",
    sessionId: "dev_session",
    role: "assistant",
    createdAt: iso(10),
    state: "completed",
    parts: [
      { type: "reasoning", id: "m3:r", text: "The router registers two endpoints and the event stream." },
      { type: "tool_call", id: "m3:t", toolCall: SAMPLE_TOOLS[0] as AgentToolCall },
    ],
  },
  text(
    "m4",
    "assistant",
    [
      "Found two endpoints (`/sessions`, `/sessions/:id/messages`) plus the global event stream.",
      "",
      "### Next",
      "",
      "- Write a reference page",
      "- Add request examples",
      "",
      "```ts",
      "const res = await fetch(`/api/v1/sessions/${id}/messages`);",
      "```",
    ].join("\n"),
    8,
  ),
];

const PROVIDER: AgentProvider = {
  id: "opencode",
  name: "OpenCode",
  version: "dev",
  installed: true,
  authenticated: true,
  compatible: true,
  warning: null,
  capabilities: defineCapabilities({
    queue: true,
    steer: true,
    interrupt: true,
    attachments: true,
    imageInput: true,
    models: true,
    modes: true,
  }),
};

const SESSION: AgentSession = {
  id: "dev_composer",
  provider: "opencode",
  projectId: "dev",
  title: "Composer",
  createdAt: iso(1),
  updatedAt: iso(1),
  state: "idle",
};

const MANY_TOOLS: AgentToolCall[] = Array.from({ length: 9 }, (_, index) => ({
  id: `many_${index}`,
  name:
    ["read", "grep", "edit", "bash", "glob", "webfetch", "write", "todowrite", "mcp__linear__search"][index] ?? "read",
  status: index === 8 ? "running" : "completed",
  input: { file_path: `src/module-${index + 1}.ts`, pattern: "cursor" },
  startedAt: iso(4 - index * 0.3),
  completedAt: index === 8 ? null : iso(4 - index * 0.3 - 0.1),
}));

const LONG_APPROVAL: AgentApprovalRequest = {
  id: "dev_approval_long",
  sessionId: "dev_session",
  provider: "mock",
  createdAt: iso(1),
  kind: "file",
  title: "Write src/features/billing/reconciliation/nightly-export-deduplication.ts",
  detail:
    "src/features/billing/reconciliation/nightly-export-deduplication.ts (new file, 212 lines) — replaces the region join with a customer-first query",
  options: [
    { id: "allow_once", label: "Allow once", kind: "allow_once" },
    {
      id: "allow_always",
      label: "Always allow edits in src/features",
      kind: "allow_always",
      description: "Until this session ends",
    },
    {
      id: "review",
      label: "Show me the diff first",
      kind: "custom",
      description: "The agent pauses and posts the diff",
    },
    { id: "deny", label: "Deny", kind: "deny", description: "The agent is told not to write the file" },
  ],
};

const CONFIRM_QUESTION: AgentQuestionRequest = {
  id: "dev_confirm",
  sessionId: "dev_session",
  provider: "mock",
  createdAt: iso(1),
  title: "Questions",
  questions: [
    {
      id: "c0",
      header: "It keeps settings queryable and works offline.",
      question: "Use SQLite for local settings storage?",
      kind: "confirm",
    },
  ],
};

const LIVE_CONVERSATION: AgentMessage[] = [
  text("l1", "user", "Add request examples for both endpoints.", 1),
  {
    id: "l2",
    sessionId: "dev_session",
    role: "assistant",
    createdAt: iso(0.5),
    state: "streaming",
    parts: [
      { type: "reasoning", id: "l2:r", text: "One example per endpoint; the messages page needs a cursor." },
      { type: "tool_call", id: "l2:t1", toolCall: SAMPLE_TOOLS[0] as AgentToolCall },
      { type: "tool_call", id: "l2:t2", toolCall: SAMPLE_TOOLS[1] as AgentToolCall },
      { type: "text", id: "l2:x", text: "Here is the first example:" },
    ],
  },
];

const LONG_REASONING = Array.from(
  { length: 5 },
  (_, index) =>
    `Step ${index + 1}: the export joins accounts before de-duplicating customers, so a customer with accounts in two regions produces two rows unless the join is keyed on the customer first.`,
).join("\n\n");

const SAMPLE_TS = `export async function listMessages(sessionId: string, cursor?: string) {
  const url = new URL(\`/api/v1/sessions/\${sessionId}/messages\`, location.origin);
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, { headers: authHeaders() });
  return (await response.json()) as ListPage<AgentMessage>;
}`;

const LONG_LINE = JSON.stringify({
  messages: [
    {
      id: "msg_01",
      role: "assistant",
      text: "A single very long line that must scroll sideways inside the code block instead of widening the page.",
    },
  ],
});

const SAMPLE_PATCH =
  "@@ -1,3 +1,4 @@\n export const version = 2;\n-export const pageSize = 25;\n+export const pageSize = 50;\n+export const maxPageSize = 200;\n";

const DRAFT_SESSION = "dev_composer_draft";

const LONG_CONTROLS = (
  <>
    <PickerButton
      value="An extremely long provider model name, 1M context"
      detail="· High"
      icon={<span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-accent" />}
      ariaLabel="Model (long sample)"
      onClick={() => undefined}
      className="min-w-0 flex-1"
    />
    <PickerButton
      value="Auto-edit"
      icon={<SlidersHorizontal size={16} aria-hidden />}
      ariaLabel="Mode (long sample)"
      onClick={() => undefined}
      className="max-w-[46%] shrink-0"
    />
  </>
);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="eyebrow mb-3 px-1">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-10 w-10 shrink-0 rounded-[12px] border border-border"
        style={{ background: `var(--${name})` }}
        aria-hidden
      />
      <span className="readout text-caption text-muted">--{name}</span>
    </div>
  );
}

const COMPOSER_CONTROLS = (
  <>
    <PickerButton
      value="Aurora 1"
      detail="· Medium"
      icon={<span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-accent" />}
      ariaLabel="Model (sample)"
      onClick={() => undefined}
      className="min-w-0 flex-1"
    />
    <PickerButton
      value="Ask"
      icon={<SlidersHorizontal size={16} aria-hidden />}
      ariaLabel="Mode (sample)"
      onClick={() => undefined}
      className="max-w-[46%] shrink-0"
    />
  </>
);

export function DevUI() {
  const { theme, setTheme } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [emptyModeOpen, setEmptyModeOpen] = useState(false);
  const [provider, setProvider] = useState("opencode");
  const [mode, setMode] = useState("build");
  // Seed the running composer's draft before it mounts (dev page only).
  useState(() => {
    writeDraft(DRAFT_SESSION, "Also cover pagination,\nerror shapes,\nand the retry headers\nfor the event stream.");
    return null;
  });

  if (!import.meta.env.DEV) {
    return <p className="p-6 text-callout text-muted">/dev/ui is only available during development.</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-safe pb-safe-scroll pt-safe">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <p className="eyebrow mb-3">Homebase</p>
          <h1 className="font-serif text-display text-text">Design QA</h1>
        </div>
        <ThemeToggle />
      </header>

      <Section title="Theme">
        <Segmented<ThemeSetting>
          ariaLabel="Theme"
          options={[
            { id: "system", label: "System" },
            { id: "light", label: "Light" },
            { id: "dark", label: "Dark" },
          ]}
          value={theme}
          onChange={setTheme}
        />
      </Section>

      <Section title="Typography">
        <div className="flex flex-col gap-4">
          <p className="font-serif text-display">Display · Projects</p>
          <p className="font-serif text-title">Title · aurora-api</p>
          <p className="text-heading font-semibold">Heading · Document the gateway endpoints</p>
          <p className="text-row font-semibold">Row title · beacon-web</p>
          <p className="text-body">Body · The conversation reads at 17px with generous leading.</p>
          <p className="text-callout text-muted">Callout · Secondary lines and controls.</p>
          <p className="text-caption text-muted">Caption · Metadata, never essential alone.</p>
          <p className="eyebrow">Eyebrow · Section label</p>
          <p className="readout text-callout">Readout · feat/onboarding · 4m · 2.0.18</p>
        </div>
      </Section>

      <Section title="Surfaces & color">
        <div className="grid grid-cols-2 gap-3">
          {[
            "bg",
            "surface",
            "surface-2",
            "surface-inset",
            "text",
            "muted",
            "faint",
            "accent",
            "accent-soft",
            "ok",
            "warn",
            "bad",
          ].map((name) => (
            <Swatch key={name} name={name} />
          ))}
        </div>
      </Section>

      <Section title="Project marks">
        <div className="flex flex-wrap items-center gap-3">
          {["aurora-api", "beacon-web", "cedar-tools", "northwind", "kit", "_private"].map((name) => (
            <ProjectMark key={name} name={name} />
          ))}
          <ProjectMark name="working" working />
          <ProjectMark name="large" size={56} />
        </div>
      </Section>

      <Section title="Provider marks">
        <div className="flex flex-wrap items-center gap-3">
          <ProviderMark providerId="opencode" />
          <ProviderMark providerId="claude" />
          <ProviderMark providerId="future-agent" />
          <ProviderMark providerId="opencode" working />
        </div>
      </Section>

      <Section title="Rows">
        <Group title="Projects" trailing={3}>
          <Row
            leading={<ProjectMark name="aurora-api" working />}
            title="aurora-api"
            subtitle={
              <>
                <BranchChip branch="main" />
                <span className="text-accent">1 working</span>
              </>
            }
            trailing={<Pill tone="waiting">Needs you</Pill>}
            onClick={() => undefined}
            chevron
          />
          <Row
            leading={<ProjectMark name="northwind-customer-portal-platform" />}
            title="northwind-customer-portal-platform"
            subtitle={
              <>
                <BranchChip branch="feature/long-running-migration-to-event-sourcing" className="max-w-[60%]" />
                <span>2 sessions</span>
              </>
            }
            onClick={() => undefined}
            chevron
          />
          <Row
            leading={<ProviderMark providerId="claude" />}
            title="Refactor session storage"
            subtitle="Claude Code · Sonnet"
          />
        </Group>
      </Section>

      <Section title="Session states">
        <div className="flex flex-wrap items-center gap-2">
          {(["idle", "working", "waiting", "failed", "completed", "unknown"] as const).map((state) => {
            const status = sessionStatus(state);
            return (
              <Pill key={state} tone={status.tone}>
                <StatusDot tone={status.tone} />
                {status.label}
              </Pill>
            );
          })}
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex flex-col gap-3">
          <Segmented
            ariaLabel="Provider (sample)"
            options={[
              { id: "opencode", label: "OpenCode" },
              { id: "claude", label: "Claude Code" },
            ]}
            value={provider}
            onChange={setProvider}
          />
          <Segmented
            ariaLabel="Mode (sample)"
            options={[
              { id: "build", label: "Build" },
              { id: "plan", label: "Plan" },
            ]}
            value={mode}
            onChange={setMode}
          />
          <div className="flex gap-2">{COMPOSER_CONTROLS}</div>
          <PickerButton
            label="Model"
            value="An extremely long model name that has to truncate gracefully"
            ariaLabel="Long model (sample)"
            onClick={() => undefined}
          />
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-col gap-3">
          <Button variant="primary" size="lg" className="w-full">
            <Plus size={18} strokeWidth={2.5} aria-hidden />
            New session
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" loading>
              Loading
            </Button>
            <Button disabled>Disabled</Button>
            <IconButton label="Delete (sample)">
              <Trash2 size={20} aria-hidden />
            </IconButton>
          </div>
        </div>
      </Section>

      <Section title="Execution trace · finished (tap Worked for…)">
        <Timeline items={foldTimeline(SAMPLE_CONVERSATION)} running={false} />
      </Section>

      <Section title="Execution trace · live">
        <Timeline items={foldTimeline(LIVE_CONVERSATION)} running runStartedAt={iso(0.3)} />
      </Section>

      <Section title="Loading · Orbit">
        <div className="flex flex-col gap-1">
          <LoadingState label="Starting…" />
          <LoadingState label="Working…" since={iso(0.2)} />
        </div>
        <p className="mt-2 text-caption text-muted">
          Agent activity only, before any reasoning, tool or text arrives. Data loading uses skeletons.
        </p>
      </Section>

      <Section title="Thinking">
        <Thinking active label="Thought process">
          <div className="hb-markdown-quiet">
            <Markdown text="The router registers two endpoints and the event stream…" />
          </div>
        </Thinking>
        <Thinking active={false} label="Thought process">
          <div className="hb-markdown-quiet">
            <Markdown text="Settled reasoning stays collapsed and quiet." />
          </div>
        </Thinking>
        <Thinking active={false} label="Thought process" defaultOpen>
          <div className="hb-markdown-quiet">
            <Markdown text={LONG_REASONING} />
          </div>
        </Thinking>
        <p className="mt-1 text-caption text-muted">
          The Brain loops only while reasoning streams; with reduced motion it holds still (it follows the OS setting).
        </p>
      </Section>

      <Section title="Tool chips">
        <ToolChips items={SAMPLE_TOOLS.map(toolChipItem)} />
        <p className="eyebrow mb-1 mt-4 px-1">Many tools</p>
        <ToolChips items={MANY_TOOLS.map(toolChipItem)} />
      </Section>

      <Section title="Task rows">
        <TaskRows rows={SAMPLE_TOOLS.map(toolTaskRow)} label="Tool calls" />
        <div className="mt-3">
          <TaskRows
            label="Plan"
            rows={[
              { key: "p1", label: "Read the gateway routes", status: "done" },
              {
                key: "p2",
                label: "Write request examples for every endpoint in the gateway reference",
                status: "running",
              },
              {
                key: "p3",
                label: "Update the docs index",
                status: "pending",
                details: <p className="text-callout text-muted">Link the new page from the sidebar.</p>,
              },
              { key: "p4", label: "Publish", status: "failed", meta: "exit 1" },
            ]}
          />
        </div>
      </Section>

      <Section title="Approval">
        <div className="flex flex-col gap-3">
          <ApprovalCard request={SAMPLE_APPROVAL} busy={false} error={null} onResolve={() => undefined} />
          <ApprovalCard request={LONG_APPROVAL} busy={false} error={null} onResolve={() => undefined} />
        </div>
      </Section>

      <Section title="Recommendation (confirm question)">
        <div className="flex flex-col gap-3">
          <QuestionCard request={CONFIRM_QUESTION} busy={false} error={null} onSubmit={() => undefined} />
          <p className="text-caption text-muted">
            No confidence meter: the protocol has no confidence value, so none is shown or inferred.
          </p>
        </div>
      </Section>

      <Section title="Questions (stepped)">
        <QuestionCard request={SAMPLE_QUESTION} busy={false} error={null} onSubmit={() => undefined} />
      </Section>

      <Section title="Attachments">
        <div className="flex flex-wrap gap-2">
          <FileChip name="build-log.txt" mimeType="text/plain" sizeBytes={48_200} />
          <FileChip name="a-very-long-report-name-for-the-quarterly-review.pdf" mimeType="application/pdf" />
        </div>
      </Section>

      <Section title="Prompt bar · idle">
        <div className="-mx-4 overflow-hidden rounded-[var(--radius-lg)]">
          <Composer
            session={SESSION}
            provider={PROVIDER}
            model={undefined}
            running={false}
            onSend={() => undefined}
            onInterrupt={() => undefined}
            controls={COMPOSER_CONTROLS}
          />
        </div>
      </Section>

      <Section title="Prompt bar · running, multiline draft, long model">
        <div className="-mx-4 overflow-hidden rounded-[var(--radius-lg)]">
          <Composer
            session={{ ...SESSION, id: DRAFT_SESSION }}
            provider={PROVIDER}
            model={undefined}
            running
            onSend={() => undefined}
            onInterrupt={() => undefined}
            controls={LONG_CONTROLS}
          />
        </div>
      </Section>

      <Section title="Prompt bar · attachment">
        <PromptBar
          controls={COMPOSER_CONTROLS}
          attachments={
            <PendingAttachmentChip
              attachment={{
                id: "dev_att",
                kind: "file",
                name: "gateway-notes.md",
                mimeType: "text/markdown",
                sizeBytes: 4_812,
              }}
              onRemove={() => undefined}
            />
          }
          textarea={{ "aria-label": "Message (sample)", placeholder: "Message OpenCode…", readOnly: true }}
          trailing={
            <span
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent text-on-accent"
              aria-hidden
            >
              ↑
            </span>
          }
        />
      </Section>

      <Section title="Code block">
        <div className="flex flex-col gap-3">
          <CodeBlock code={SAMPLE_TS} language="ts" />
          <CodeBlock code="npm test -- --runInBand" language="bash" />
          <CodeBlock code={LONG_LINE} language="json" />
          <CodeBlock code={SAMPLE_PATCH} diff title="src/lib/session.ts" />
        </div>
      </Section>

      <Section title="Inputs & sheets">
        <div className="flex flex-col gap-3">
          <TextField label="Text field" placeholder="Placeholder" />
          <Button onClick={() => setSheetOpen(true)}>Open sheet</Button>
        </div>
      </Section>

      <Section title="Recent & configured folders">
        <p className="eyebrow mb-2">Recent</p>
        <div className="surface">
          <ProjectRow
            project={{
              id: "prj_sample",
              name: "example-api",
              path: "/home/example/projects/example-api",
              branch: "main",
              providersAvailable: [],
              rootId: "root_111111111111",
              lastActivityAt: iso(5),
              knownSessionCount: 3,
              workingCount: 1,
              waitingCount: 0,
            }}
            onOpen={() => undefined}
          />
        </div>
        <p className="eyebrow mb-2 mt-4">Folders</p>
        <Group>
          <Row title="Development" subtitle="24 projects" onClick={() => undefined} />
        </Group>
        <p className="eyebrow mb-2 mt-4">Development</p>
        <div className="surface">
          <ProjectRow
            project={{
              id: "prj_sample_2",
              name: "a-long-project-name-for-mobile-layout",
              path: "/home/example/projects/example-web",
              branch: "feature/mobile",
              providersAvailable: [],
              rootId: "root_111111111111",
              lastActivityAt: null,
              knownSessionCount: 0,
              workingCount: 0,
              waitingCount: 0,
            }}
            onOpen={() => undefined}
          />
        </div>
      </Section>
      <Section title="Provider usage">
        <ProviderUsageDetail
          usage={{
            provider: "mock",
            windows: [
              { id: "five-hour", label: "5 hour", unit: "percent", usedPercent: 43, resetsAt: iso(-120) },
              { id: "week", label: "Week", unit: "percent", usedPercent: 18, resetsAt: iso(-1440) },
            ],
            fetchedAt: iso(2),
          }}
        />
        <p className="mt-4 text-callout text-muted">This provider does not expose account usage limits.</p>
      </Section>
      <Section title="Session usage">
        <SessionUsageDetail
          usage={{
            provider: "mock",
            sessionId: "dev_session",
            tokens: {
              inputTokens: 10000,
              outputTokens: 2400,
              totalTokens: 12400,
              cacheReadTokens: 2000,
              cacheWriteTokens: 300,
              reasoningTokens: 400,
            },
            costUsd: 0.08,
            updatedAt: iso(1),
          }}
        />
      </Section>
      <Section title="Project files · read only">
        <Group>
          <Row title="src" subtitle="Folder" onClick={() => undefined} />
          <Row title="README.md" subtitle="1.2 KB" onClick={() => undefined} />
        </Group>
        <div className="mt-4">
          <FileContent
            preview={{
              projectId: "dev",
              relativePath: "src/index.ts",
              name: "index.ts",
              sizeBytes: 400,
              kind: "text",
              language: "typescript",
              mimeType: "text/plain",
              text: SAMPLE_TS,
            }}
          />
        </div>
        <div className="mt-4">
          <FileContent
            preview={{
              projectId: "dev",
              relativePath: "README.md",
              name: "README.md",
              sizeBytes: 50,
              kind: "text",
              language: "markdown",
              mimeType: "text/plain",
              text: "# Project notes\n\nA read-only Markdown preview.",
            }}
          />
        </div>
        <FileContent
          preview={{
            projectId: "dev",
            relativePath: "archive.bin",
            name: "archive.bin",
            sizeBytes: 2048,
            kind: "unsupported",
            language: null,
            mimeType: null,
          }}
        />
      </Section>
      <Section title="Empty mode catalog">
        <Button onClick={() => setEmptyModeOpen(true)}>Open empty Mode sheet</Button>
      </Section>
      <ModeSheet
        open={emptyModeOpen}
        onClose={() => setEmptyModeOpen(false)}
        modes={[]}
        loading={false}
        currentMode={null}
        busy={false}
        onApply={() => undefined}
      />

      <Section title="Loading">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      </Section>

      <Section title="Empty & error">
        <div className="surface">
          <EmptyState title="A clean slate" detail="No sessions here yet. Start one above." />
        </div>
        <ErrorState title="Something went wrong" detail="A restrained inline error." onRetry={() => undefined} />
      </Section>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Example sheet"
        footer={
          <Button variant="primary" size="lg" className="w-full" onClick={() => setSheetOpen(false)}>
            Confirm
          </Button>
        }
      >
        <p className="text-body text-muted">Sheets trap focus, close on Escape, and restore focus when dismissed.</p>
      </Sheet>
    </div>
  );
}
