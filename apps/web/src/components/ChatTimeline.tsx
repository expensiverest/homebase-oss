import {
  AlertTriangle,
  Ban,
  Brain,
  Check,
  ChevronDown,
  CircleDot,
  FilePen,
  FilePlus2,
  FileText,
  Globe,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Search,
  SquareTerminal,
  Users,
  Wrench,
} from "lucide-react";
import { memo, useState, type ReactNode } from "react";

import type { AgentContentPart, AgentMessage, AgentToolCall } from "@homebase/protocol";

import { formatDuration, plural } from "../lib/format.js";
import { useSmoothText } from "../lib/smoothText.js";
import { toolPresentation, type TimelineItem } from "../lib/viewmodel.js";
import { FilePart, ImagePart } from "./attachments.js";
import { Markdown } from "./Markdown.js";

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

/** Completed tools stay quiet; only running, failed and denied say anything. */
function statusIcon(status: AgentToolCall["status"]) {
  switch (status) {
    case "running":
      return <Loader2 size={15} className="animate-spin text-accent" aria-label="Running" />;
    case "completed":
      return <Check size={15} className="text-faint" aria-label="Done" />;
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-medium text-bad">
          <AlertTriangle size={14} aria-hidden />
          Failed
        </span>
      );
    case "denied":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-medium text-muted">
          <Ban size={14} aria-hidden />
          Denied
        </span>
      );
  }
}

function stringifyOutput(output: AgentToolCall["output"]): string | null {
  if (output == null) return null;
  if (typeof output === "string") return output;
  if (
    typeof output === "object" &&
    output !== null &&
    "text" in output &&
    typeof (output as { text?: unknown }).text === "string"
  ) {
    return (output as { text: string }).text;
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function ToolRow({ tool, dense = false }: { tool: AgentToolCall; dense?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const presentation = toolPresentation(tool);
  const output = stringifyOutput(tool.output);
  const hasDetail = Boolean(tool.input) || Boolean(output) || Boolean(tool.error);

  return (
    <div className={`min-w-0 ${dense ? "" : "my-1"}`}>
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((value) => !value)}
        aria-expanded={hasDetail ? expanded : undefined}
        className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left transition-colors active:bg-fill"
      >
        <span className={`shrink-0 ${presentation.tone === "failed" ? "text-bad" : "text-muted"}`}>
          {toolIcon(presentation.verb)}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-callout">
          <span className={`shrink-0 font-medium ${presentation.tone === "working" ? "text-text" : "text-muted"}`}>
            {presentation.verb}
          </span>
          {presentation.detail ? (
            <span className="readout min-w-0 truncate text-caption text-muted">{presentation.detail}</span>
          ) : null}
        </span>
        <span className="shrink-0">{statusIcon(tool.status)}</span>
        {hasDetail ? (
          <ChevronDown
            size={15}
            className={`shrink-0 text-faint transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden
          />
        ) : null}
      </button>
      {expanded ? (
        <div className="mb-2 ml-[1.625rem] mt-1 flex flex-col gap-2 border-l border-border pl-3">
          {tool.input ? (
            <div>
              <p className="eyebrow mb-1">Input</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-fill px-2.5 py-2 font-mono text-caption text-text">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          ) : null}
          {output ? (
            <div>
              <p className="eyebrow mb-1">Output</p>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-fill px-2.5 py-2 font-mono text-caption text-text">
                {output}
              </pre>
            </div>
          ) : null}
          {tool.error ? <p className="text-callout text-bad">{tool.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ReasoningBlock({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(active);
  if (text.trim().length === 0 && !active) return null;
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="-ml-2 flex min-h-11 items-center gap-2 rounded-[12px] px-2 text-callout font-medium text-muted transition-colors hover:text-text active:bg-fill"
      >
        <Brain size={16} aria-hidden />
        <span className={active ? "shimmer" : undefined}>{active ? "Thinking…" : "Thought process"}</span>
        <ChevronDown size={15} className={`text-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="hb-markdown-quiet mb-2 ml-2 border-l border-border pl-3.5">
          <Markdown text={text} />
        </div>
      ) : null}
    </div>
  );
}

function StatusPart({ label, detail }: { label: string; detail?: string | null }) {
  return (
    <p className="my-1 text-caption text-muted">
      {label}
      {detail ? ` — ${detail}` : ""}
    </p>
  );
}

function PlanPart({ parts }: { parts: Array<Extract<AgentContentPart, { type: "plan" }>> }) {
  return (
    <div className="surface my-3 px-4 py-3.5">
      {parts.map((part) => (
        <div key={part.id}>
          {part.plan.title ? <p className="mb-2 text-callout font-semibold text-text">{part.plan.title}</p> : null}
          <ul className="flex flex-col gap-1.5">
            {part.plan.steps.map((step) => (
              <li key={step.id} className="flex items-start gap-2.5 text-callout text-muted">
                <span className="mt-[3px] shrink-0">
                  {step.status === "completed" ? (
                    <Check size={15} className="text-ok" aria-hidden />
                  ) : step.status === "in_progress" ? (
                    <Loader2 size={15} className="animate-spin text-accent" aria-hidden />
                  ) : (
                    <CircleDot size={15} className="text-faint" aria-hidden />
                  )}
                </span>
                <span>{step.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function MessageParts({ message }: { message: AgentMessage }) {
  const streaming = message.state === "streaming";
  const plans = message.parts.filter(
    (part): part is Extract<AgentContentPart, { type: "plan" }> => part.type === "plan",
  );
  return (
    <div>
      {message.parts.map((part, index) => {
        switch (part.type) {
          case "text":
            return (
              <TextPart key={part.id} text={part.text} streaming={streaming && index === message.parts.length - 1} />
            );
          case "reasoning":
            return <ReasoningBlock key={part.id} text={part.text} active={streaming} />;
          case "tool_call":
            return <ToolRow key={part.id} tool={part.toolCall} />;
          case "image":
            return <ImagePart key={part.id} part={part} />;
          case "file":
            return <FilePart key={part.id} part={part} />;
          case "status":
            return <StatusPart key={part.id} label={part.label} detail={part.detail} />;
          case "error":
            return (
              <p key={part.id} className="my-2 rounded-[var(--radius-md)] bg-bad-soft px-4 py-3 text-callout text-bad">
                {part.message}
              </p>
            );
          case "plan":
            return null;
          default:
            return null;
        }
      })}
      {plans.length > 0 ? <PlanPart parts={plans} /> : null}
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

function WorkRow({ item, children }: { item: Extract<TimelineItem, { kind: "work" }>; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const duration = formatDuration(item.startedAt, item.endedAt);
  const bits: string[] = [];
  if (item.tools.length > 0) bits.push(plural(item.tools.length, "tool"));
  if (item.reasoningCount > 0) bits.push(`${item.reasoningCount} thinking`);
  if (item.foldedTextCount > 0) bits.push(plural(item.foldedTextCount, "update"));
  return (
    <div className="-mt-2 mb-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="-ml-2 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-[12px] px-2 text-left text-callout text-muted transition-colors hover:text-text active:bg-fill"
      >
        <span className="min-w-0">
          <span className="font-medium">Worked{duration ? ` for ${duration}` : ""}</span>
          {bits.length > 0 ? <span className="text-muted/80"> · {bits.join(" · ")}</span> : null}
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2.25}
          className={`shrink-0 text-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="mb-2 ml-1 mt-1 border-l border-border pl-4">
          {item.tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} dense />
          ))}
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function WorkingRow() {
  return (
    <div className="-mt-3 mb-4 flex min-h-11 items-center gap-2.5 text-callout text-muted" role="status">
      <Loader2 size={16} className="animate-spin text-accent" aria-hidden />
      <span className="shimmer font-medium">Working…</span>
    </div>
  );
}

export const Timeline = memo(function Timeline({
  items,
  running,
  hasMessages,
}: {
  items: TimelineItem[];
  running: boolean;
  hasMessages: boolean;
}) {
  // A streaming reply only replaces the working line once it has something to show.
  const last = items[items.length - 1];
  const lastStreaming =
    last?.kind === "final" &&
    last.message.state === "streaming" &&
    last.message.parts.some((part) => (part.type === "text" ? part.text.length > 0 : part.type !== "reasoning"));
  return (
    <div>
      {items.map((item) => {
        if (item.kind === "user") return <UserMessage key={item.id} message={item.message} />;
        if (item.kind === "final") return <FinalMessage key={item.id} message={item.message} />;
        return <WorkRow key={item.id} item={item} />;
      })}
      {running && (!lastStreaming || !hasMessages) ? <WorkingRow /> : null}
    </div>
  );
});
