import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  FilePen,
  FilePlus2,
  FileText,
  Globe,
  ListChecks,
  MessageCircleQuestion,
  Search,
  SquareTerminal,
  Users,
  Wrench,
} from "lucide-react";
import { memo, useState, type ReactNode } from "react";

import type { AgentMessage, AgentPlan, AgentToolCall } from "@homebase/protocol";

import { formatDuration, plural } from "../lib/format.js";
import { useSmoothText } from "../lib/smoothText.js";
import {
  activeRunView,
  toolPresentation,
  type TimelineItem,
  type TimelineWorkItem,
  type TraceStep,
} from "../lib/viewmodel.js";
import { FilePart, ImagePart } from "./attachments.js";
import { CodeBlock } from "./beautiful/CodeBlock.js";
import { LoadingState } from "./beautiful/LoadingState.js";
import { TaskRows, type TaskRowItem, type TaskStatus } from "./beautiful/TaskRows.js";
import { Thinking } from "./beautiful/Thinking.js";
import { ToolChips, type ToolChipItem, type ToolChipStatus } from "./beautiful/ToolChips.js";
import { Markdown } from "./Markdown.js";
import { OpenThreadButton } from "./OpenThreadButton.js";

/*
 * The conversation. Each run reads as one execution trace:
 *
 *   live      Orbit (nothing yet) → Thinking → Task Rows → streaming text
 *   finished  "Worked for …" folded; open: Thinking, Tool Chips, updates
 *
 * Every surface is driven by normalized AgentMessage parts; nothing here knows
 * which provider produced them.
 */

function TextPart({ text, streaming }: { text: string; streaming: boolean }) {
  const smooth = useSmoothText(text, { enabled: streaming });
  const trailing = streaming && smooth.length < text.length;
  if (streaming && smooth.length === 0) return null;
  return (
    <div className={`my-1 ${trailing ? "hb-streaming-caret" : ""}`}>
      <Markdown text={streaming ? smooth : text} />
    </div>
  );
}

// --- tool adapters ---------------------------------------------------------

const VERB_ICONS: Record<string, typeof Wrench> = {
  Run: SquareTerminal,
  Read: FileText,
  Write: FilePlus2,
  Edit: FilePen,
  Search: Search,
  Find: Search,
  Fetch: Globe,
  Agent: Users,
  Plan: ListChecks,
  Ask: MessageCircleQuestion,
};

function toolIcon(verb: string) {
  const Icon = VERB_ICONS[verb] ?? Wrench;
  return <Icon size={16} strokeWidth={2} aria-hidden />;
}

function stringifyOutput(output: AgentToolCall["output"]): string | null {
  if (output == null) return null;
  if (typeof output === "string") return output;
  if (typeof output === "object" && "text" in output && typeof (output as { text?: unknown }).text === "string") {
    return (output as { text: string }).text;
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function commandOf(tool: AgentToolCall): string | null {
  const input = tool.input;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const command = (input as Record<string, unknown>).command;
    if (typeof command === "string") return command;
  }
  return null;
}

/** A labelled link to a sub-agent's thread, for tool details (settled runs use chips, not rows). */
function OpenThreadLink({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-open-thread
      onClick={() => void navigate({ to: "/s/$sessionId", params: { sessionId } })}
      className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full bg-fill px-3.5 text-callout font-semibold text-accent active:scale-[0.98]"
    >
      <ArrowUpRight size={16} strokeWidth={2.25} aria-hidden />
      Open sub-agent thread
    </button>
  );
}

/** Tool input, output and error as untrusted text in code blocks (never HTML). */
function ToolDetail({ tool }: { tool: AgentToolCall }) {
  const output = stringifyOutput(tool.output);
  const command = commandOf(tool);
  return (
    <>
      {tool.childSessionId ? <OpenThreadLink sessionId={tool.childSessionId} /> : null}
      {command ? (
        <CodeBlock code={command} language="bash" title="command" compact lineNumbers={false} />
      ) : tool.input != null ? (
        <CodeBlock
          code={JSON.stringify(tool.input, null, 2)}
          language="json"
          title="input"
          compact
          lineNumbers={false}
        />
      ) : null}
      {output ? (
        <div className="max-h-72 overflow-y-auto rounded-[var(--radius-md)]">
          <CodeBlock code={output} language={null} title="output" compact />
        </div>
      ) : null}
      {tool.error ? <p className="text-callout text-bad">{tool.error}</p> : null}
    </>
  );
}

function hasToolDetail(tool: AgentToolCall): boolean {
  return tool.input != null || tool.output != null || Boolean(tool.error) || Boolean(tool.childSessionId);
}

const CHIP_STATUS: Record<AgentToolCall["status"], ToolChipStatus> = {
  running: "running",
  completed: "done",
  failed: "failed",
  denied: "denied",
};

export function toolChipItem(tool: AgentToolCall): ToolChipItem {
  const presentation = toolPresentation(tool);
  return {
    key: tool.id,
    icon: toolIcon(presentation.verb),
    label: presentation.verb,
    chip: presentation.detail,
    status: CHIP_STATUS[tool.status],
    detail: hasToolDetail(tool) ? <ToolDetail tool={tool} /> : null,
  };
}

export function toolTaskRow(tool: AgentToolCall): TaskRowItem {
  const presentation = toolPresentation(tool);
  const took = tool.status === "running" ? null : formatDuration(tool.startedAt, tool.completedAt ?? null);
  return {
    key: tool.id,
    label: presentation.detail ? `${presentation.verb} ${presentation.detail}` : presentation.verb,
    meta: tool.completedAt ? took : null,
    status: CHIP_STATUS[tool.status] as TaskStatus,
    action: tool.childSessionId ? (
      <OpenThreadButton sessionId={tool.childSessionId} title={presentation.detail ?? presentation.verb} />
    ) : null,
    details: hasToolDetail(tool) ? <ToolDetail tool={tool} /> : null,
  };
}

const PLAN_STATUS: Record<AgentPlan["steps"][number]["status"], TaskStatus> = {
  pending: "pending",
  in_progress: "running",
  completed: "done",
};

function PlanRows({ plan, animate }: { plan: AgentPlan; animate: boolean }) {
  return (
    <div className="my-2">
      <p className="eyebrow mb-2 px-1">{plan.title ?? "Plan"}</p>
      <TaskRows
        label={plan.title ?? "Plan"}
        animate={animate}
        rows={plan.steps.map((step) => ({
          key: step.id,
          label: step.title,
          status: PLAN_STATUS[step.status],
          details: step.detail ? <p className="text-callout text-muted">{step.detail}</p> : null,
        }))}
      />
    </div>
  );
}

// --- trace -----------------------------------------------------------------

type TraceGroup = { kind: "tools"; id: string; tools: AgentToolCall[] } | Exclude<TraceStep, { kind: "tool" }>;

/** Consecutive tool calls become one group; reasoning and updates stand alone. */
function groupSteps(steps: TraceStep[]): TraceGroup[] {
  const groups: TraceGroup[] = [];
  for (const step of steps) {
    const previous = groups[groups.length - 1];
    if (step.kind === "tool") {
      if (previous?.kind === "tools") previous.tools.push(step.tool);
      else groups.push({ kind: "tools", id: `tools:${step.id}`, tools: [step.tool] });
    } else {
      groups.push(step);
    }
  }
  return groups;
}

/**
 * The steps of one run. `live` renders tools as Task Rows (status-first, for
 * watching) and lets the newest reasoning think out loud; settled runs use the
 * denser Tool Chips and quiet, collapsed Thinking.
 */
function Trace({ work, live }: { work: TimelineWorkItem; live: boolean }) {
  const groups = groupSteps(work.steps);
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((group, index) => {
        if (group.kind === "reasoning") {
          const active = live && group.streaming && index === groups.length - 1;
          return (
            <Thinking key={group.id} active={active} label="Thought process" defaultOpen={active}>
              <div className="hb-markdown-quiet">
                <Markdown text={group.text || "…"} />
              </div>
            </Thinking>
          );
        }
        if (group.kind === "text") {
          return (
            <div key={group.id} className="hb-markdown-quiet my-1">
              <Markdown text={group.text} />
            </div>
          );
        }
        return live ? (
          <div key={group.id} className="my-1.5">
            <TaskRows rows={group.tools.map(toolTaskRow)} label="Tool calls" animate />
          </div>
        ) : (
          <ToolChips key={group.id} items={group.tools.map(toolChipItem)} />
        );
      })}
      {work.plan ? <PlanRows plan={work.plan} animate={live} /> : null}
    </div>
  );
}

/** Finished work, folded: "Worked for 4m · 3 tools". The chevron stays with the text when it wraps. */
function WorkRow({ item }: { item: TimelineWorkItem }) {
  const [open, setOpen] = useState(false);
  const duration = formatDuration(item.startedAt, item.endedAt);
  const bits: string[] = [];
  if (item.tools.length > 0) bits.push(plural(item.tools.length, "tool"));
  if (item.reasoningCount > 0) bits.push(`${item.reasoningCount} thinking`);
  if (item.foldedTextCount > 0) bits.push(plural(item.foldedTextCount, "update"));
  return (
    <div className="-mt-2 mb-3" data-work-row>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="-ml-2 block min-h-11 max-w-full rounded-[12px] px-2 py-2.5 text-left text-callout leading-snug text-muted transition-colors hover:text-text active:bg-fill"
      >
        {/* One inline run of text: the chevron is the last "word", so it wraps with the summary. */}
        <span className="font-medium">Worked{duration ? ` for ${duration}` : ""}</span>
        {bits.length > 0 ? <span className="text-muted/80"> · {bits.join(" · ")}</span> : null}
        <span className="whitespace-nowrap">
          {"⁠"}
          <ChevronDown
            size={15}
            strokeWidth={2.25}
            data-work-chevron
            className={`ml-1.5 inline-block align-[-0.15em] text-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      <div className="bui-collapse" data-open={open}>
        <div inert={!open}>{open ? <div className="pb-2 pt-1">{<Trace work={item} live={false} />}</div> : null}</div>
      </div>
    </div>
  );
}

// --- messages --------------------------------------------------------------

/** An answer's own content. Reasoning, tools and plans live in the trace. */
export function MessageParts({ message }: { message: AgentMessage }) {
  const streaming = message.state === "streaming";
  const lastText = [...message.parts].reverse().find((part) => part.type === "text");
  return (
    <div>
      {message.parts.map((part) => {
        switch (part.type) {
          case "text":
            return <TextPart key={part.id} text={part.text} streaming={streaming && part === lastText} />;
          case "image":
            return <ImagePart key={part.id} part={part} />;
          case "file":
            return <FilePart key={part.id} part={part} />;
          case "status":
            return (
              <p key={part.id} className="my-1 text-caption text-muted">
                {part.label}
                {part.detail ? ` — ${part.detail}` : ""}
              </p>
            );
          case "error":
            return (
              <p key={part.id} className="my-2 rounded-[var(--radius-md)] bg-bad-soft px-4 py-3 text-callout text-bad">
                {part.message}
              </p>
            );
          default:
            return null;
        }
      })}
      {message.state === "failed" ? (
        <p className="mt-2 flex items-center gap-1.5 text-callout font-medium text-bad">
          <AlertTriangle size={15} aria-hidden />
          The run failed
        </p>
      ) : null}
      {message.state === "interrupted" ? <p className="mt-2 text-callout font-medium text-muted">Stopped</p> : null}
    </div>
  );
}

function UserMessage({ message }: { message: AgentMessage }) {
  return (
    <div className="mb-6 mt-2 flex justify-end pl-10">
      <div className="min-w-0 max-w-full rounded-[22px] rounded-br-[8px] bg-[var(--user-bubble)] px-4 py-3 text-body leading-[1.5] text-text">
        {message.parts.map((part) => {
          if (part.type === "text")
            return (
              <p key={part.id} className="whitespace-pre-wrap break-words">
                {part.text}
              </p>
            );
          if (part.type === "image") return <ImagePart key={part.id} part={part} />;
          if (part.type === "file") return <FilePart key={part.id} part={part} />;
          return null;
        })}
      </div>
    </div>
  );
}

function FinalMessage({ message }: { message: AgentMessage }) {
  const failed = message.state === "failed";
  const interrupted = message.state === "interrupted";
  return (
    <div className={`mb-8 ${failed || interrupted ? "opacity-90" : ""}`}>
      <MessageParts message={message} />
    </div>
  );
}

export const Timeline = memo(function Timeline({
  items,
  running,
  runStartedAt,
}: {
  items: TimelineItem[];
  running: boolean;
  /** When the live turn started, for the Orbit's elapsed time (never page-mount time). */
  runStartedAt?: string | null;
  hasMessages?: boolean;
}): ReactNode {
  const view = activeRunView(items, running);
  const lastUser = [...items].reverse().find((item) => item.kind === "user");
  const since = runStartedAt ?? (lastUser?.kind === "user" ? lastUser.message.createdAt : null);
  return (
    <div>
      {items.map((item) => {
        if (item.kind === "user") return <UserMessage key={item.id} message={item.message} />;
        if (item.kind === "final") return <FinalMessage key={item.id} message={item.message} />;
        if (view.mode === "trace" && view.workId === item.id) {
          return (
            <div key={item.id} className="-mt-2 mb-4" data-live-trace>
              <Trace work={item} live />
            </div>
          );
        }
        return <WorkRow key={item.id} item={item} />;
      })}
      {view.mode === "orbit" ? (
        <div className="-mt-2 mb-4">
          <LoadingState label={view.label} since={since} />
        </div>
      ) : null}
    </div>
  );
});
