import { useState } from "react";

import type { AgentApprovalRequest, AgentQuestionRequest, AgentToolCall } from "@homebase/protocol";

import { ApprovalCard, QuestionCard } from "../components/ActionCards.js";
import { MessageParts, ToolRow } from "../components/ChatTimeline.js";
import {
  Button,
  EmptyState,
  ErrorState,
  Group,
  IconButton,
  Pill,
  Row,
  Segmented,
  Sheet,
  Skeleton,
  StatusDot,
  TextField,
} from "../components/ui.js";
import { formatDuration } from "../lib/format.js";
import { useTheme, type ThemeSetting } from "../lib/theme.js";
import { sessionStatus, toolPresentation } from "../lib/viewmodel.js";
import { ThemeToggle } from "../components/chrome.js";

const SAMPLE_TOOLS: AgentToolCall[] = [
  {
    id: "t1",
    name: "read",
    status: "completed",
    input: { file_path: "src/foo.ts" },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  },
  { id: "t2", name: "bash", status: "running", input: { command: "npm test" }, startedAt: new Date().toISOString() },
  {
    id: "t3",
    name: "write",
    status: "failed",
    title: "Write README.md",
    error: "Permission denied",
    startedAt: new Date().toISOString(),
  },
  {
    id: "t4",
    name: "webfetch",
    status: "denied",
    input: { url: "https://example.com" },
    startedAt: new Date().toISOString(),
  },
  {
    id: "t5",
    name: "future_tool",
    status: "completed",
    input: { anything: true },
    startedAt: new Date().toISOString(),
  },
];

const SAMPLE_APPROVAL: AgentApprovalRequest = {
  id: "dev_approval",
  sessionId: "dev_session",
  provider: "mock",
  createdAt: new Date().toISOString(),
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
  createdAt: new Date().toISOString(),
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
      ],
    },
  ],
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">{title}</h2>
      {children}
    </section>
  );
}

export function DevUI() {
  const { theme, setTheme } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [, setBusy] = useState(false);

  if (!import.meta.env.DEV) {
    return <p className="p-6 text-[14px] text-muted">/dev/ui is only available during development.</p>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-safe pb-12 pt-safe">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-serif text-[26px] text-text">Design QA</h1>
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

      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" loading>
            Loading
          </Button>
          <IconButton label="Icon example" onClick={() => undefined}>
            <StatusDot tone="ok" />
          </IconButton>
        </div>
      </Section>

      <Section title="Session states">
        <div className="flex flex-wrap gap-2">
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

      <Section title="Tool rows">
        <Group>
          {SAMPLE_TOOLS.map((tool) => (
            <Row
              key={tool.id}
              title={`${toolPresentation(tool).verb} ${toolPresentation(tool).detail ?? ""}`}
              subtitle={tool.status}
              trailing={<ToolRow tool={tool} />}
            />
          ))}
        </Group>
      </Section>

      <Section title="Remembered duration">
        <p className="text-[13px] text-muted">
          {formatDuration(new Date(Date.now() - 74_000).toISOString(), new Date().toISOString())}
        </p>
      </Section>

      <Section title="Cards">
        <div className="flex flex-col gap-3">
          <ApprovalCard request={SAMPLE_APPROVAL} busy={false} error={null} onResolve={() => undefined} />
          <QuestionCard request={SAMPLE_QUESTION} busy={false} error={null} onSubmit={() => undefined} />
        </div>
      </Section>

      <Section title="Message parts">
        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-3">
          <MessageParts
            message={{
              id: "dev_message",
              sessionId: "dev_session",
              role: "assistant",
              createdAt: new Date().toISOString(),
              state: "completed",
              parts: [
                { type: "reasoning", id: "p0", text: "Considering the storage options." },
                { type: "text", id: "p1", text: "Here is a **summary** with `code`:\n\n- one\n- two" },
              ],
            }}
          />
        </div>
      </Section>

      <Section title="Inputs">
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
        <EmptyState title="Nothing here yet" detail="A calm inline empty state." />
        <ErrorState title="Something went wrong" detail="A restrained inline error." onRetry={() => undefined} />
      </Section>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Example sheet"
        footer={
          <Button variant="primary" className="w-full" onClick={() => setSheetOpen(false)}>
            Confirm
          </Button>
        }
      >
        <p className="text-[14px] text-muted">Sheets trap focus, close on Escape, and restore focus when dismissed.</p>
        <Button className="mt-3" loading={false} onClick={() => setBusy((value) => !value)}>
          Toggle busy
        </Button>
      </Sheet>
    </div>
  );
}
