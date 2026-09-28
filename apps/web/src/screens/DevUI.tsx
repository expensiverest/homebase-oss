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
import { Timeline, ToolRow, WorkingRow } from "../components/ChatTimeline.js";
import { Composer } from "../components/Composer.js";
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
  const [provider, setProvider] = useState("opencode");
  const [mode, setMode] = useState("build");

  if (!import.meta.env.DEV) {
    return <p className="p-6 text-callout text-muted">/dev/ui is only available during development.</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-safe pb-16 pt-safe">
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

      <Section title="Conversation">
        <Timeline items={foldTimeline(SAMPLE_CONVERSATION)} running={false} hasMessages />
      </Section>

      <Section title="Running">
        <WorkingRow />
      </Section>

      <Section title="Tool states">
        {SAMPLE_TOOLS.map((tool) => (
          <ToolRow key={tool.id} tool={tool} />
        ))}
      </Section>

      <Section title="Action cards">
        <div className="flex flex-col gap-3">
          <ApprovalCard request={SAMPLE_APPROVAL} busy={false} error={null} onResolve={() => undefined} />
          <QuestionCard request={SAMPLE_QUESTION} busy={false} error={null} onSubmit={() => undefined} />
        </div>
      </Section>

      <Section title="Attachments">
        <div className="flex flex-wrap gap-2">
          <FileChip name="build-log.txt" mimeType="text/plain" sizeBytes={48_200} />
          <FileChip name="a-very-long-report-name-for-the-quarterly-review.pdf" mimeType="application/pdf" />
        </div>
      </Section>

      <Section title="Composer · idle">
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

      <Section title="Composer · running">
        <div className="-mx-4 overflow-hidden rounded-[var(--radius-lg)]">
          <Composer
            session={{ ...SESSION, id: "dev_composer_running" }}
            provider={PROVIDER}
            model={undefined}
            running
            onSend={() => undefined}
            onInterrupt={() => undefined}
            controls={COMPOSER_CONTROLS}
          />
        </div>
      </Section>

      <Section title="Inputs & sheets">
        <div className="flex flex-col gap-3">
          <TextField label="Text field" placeholder="Placeholder" />
          <Button onClick={() => setSheetOpen(true)}>Open sheet</Button>
        </div>
      </Section>

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
