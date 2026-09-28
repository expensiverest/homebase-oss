import {
  AlertTriangle,
  Ban,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Loader2,
  MessageSquare,
  Terminal,
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
    <div className={trailing ? "hb-streaming-caret" : undefined}>
      <Markdown text={streaming ? smooth : text} />
    </div>
  );
}

function toolIcon(name: string) {
  const verb = toolPresentation({ id: "", name, status: "completed", input: null }).verb;
  switch (verb) {
    case "Run":
      return <Terminal size={14} aria-hidden />;
    case "Read":
    case "Write":
    case "Edit":
      return <CircleDot size={14} aria-hidden />;
    case "Ask":
      return <MessageSquare size={14} aria-hidden />;
    default:
      return <CircleDot size={14} aria-hidden />;
  }
}

function statusIcon(status: AgentToolCall["status"]) {
  switch (status) {
    case "running":
      return <Loader2 size={13} className="animate-spin text-accent" aria-hidden />;
    case "completed":
      return <Check size={13} className="text-ok" aria-hidden />;
    case "failed":
      return <AlertTriangle size={13} className="text-bad" aria-hidden />;
    case "denied":
      return <Ban size={13} className="text-warn" aria-hidden />;
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
        className="flex min-h-11 w-full items-center gap-2 rounded-[10px] px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
      >
        <span className={`shrink-0 ${presentation.tone === "failed" ? "text-bad" : "text-muted"}`}>
          {toolIcon(tool.name)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">
          <span
            className={`font-medium ${presentation.tone === "failed" ? "text-bad" : presentation.tone === "working" ? "text-text" : "text-muted"}`}
          >
            {presentation.verb}
          </span>
          {presentation.detail ? (
            <span className="ml-2 font-mono text-[12px] text-muted">{presentation.detail}</span>
          ) : null}
        </span>
        <span className="shrink-0">{statusIcon(tool.status)}</span>
        {hasDetail ? (
          <span className="shrink-0 text-faint">
            {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="mb-2 ml-7 rounded-[10px] border border-border bg-inset p-2">
          {tool.input ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          ) : null}
          {output ? (
            <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
              {output}
            </pre>
          ) : null}
          {tool.error ? <p className="mt-1 text-[12px] text-bad">{tool.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ReasoningBlock({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(active);
  if (text.trim().length === 0 && !active) return null;
  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-11 items-center gap-2 rounded-[10px] px-1.5 text-[12px] font-medium text-muted hover:text-text"
      >
        <Brain size={13} aria-hidden />
        <span>{active ? "Thinking…" : "Thought process"}</span>
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
      </button>
      {open ? (
        <div className="mb-1 ml-1.5 border-l-2 border-border pl-3 text-[13px] text-muted">
          <Markdown text={text} />
        </div>
      ) : null}
    </div>
  );
}

function StatusPart({ label, detail }: { label: string; detail?: string | null }) {
  return (
    <p className="my-1 text-[12px] text-faint">
      {label}
      {detail ? ` — ${detail}` : ""}
    </p>
  );
}

function PlanPart({ parts }: { parts: Array<Extract<AgentContentPart, { type: "plan" }>> }) {
  return (
    <div className="my-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
      {parts.map((part) => (
        <div key={part.id}>
          {part.plan.title ? <p className="mb-1 text-[13px] font-medium text-text">{part.plan.title}</p> : null}
          <ul className="flex flex-col gap-1">
            {part.plan.steps.map((step) => (
              <li key={step.id} className="flex items-start gap-2 text-[13px] text-muted">
                <span className="mt-0.5 shrink-0">
                  {step.status === "completed" ? (
                    <Check size={13} className="text-ok" aria-hidden />
                  ) : step.status === "in_progress" ? (
                    <Loader2 size={13} className="animate-spin text-accent" aria-hidden />
                  ) : (
                    <CircleDot size={13} className="text-faint" aria-hidden />
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
              <p key={part.id} className="my-1.5 rounded-[10px] bg-bad-soft px-3 py-2 text-[13px] text-bad">
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
      {message.state === "failed" ? <p className="mt-1 text-[12px] font-medium text-bad">Run failed</p> : null}
      {message.state === "interrupted" ? <p className="mt-1 text-[12px] font-medium text-warn">Interrupted</p> : null}
    </div>
  );
}

function UserMessage({ message }: { message: AgentMessage }) {
  return (
    <div className="mb-4 flex justify-end">
      <div className="max-w-[86%] rounded-[18px] rounded-br-[6px] bg-accent-soft px-3.5 py-2 text-[15px] text-text">
        {message.parts.map((part) => {
          if (part.type === "text")
            return (
              <p key={part.id} className="whitespace-pre-wrap">
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
    <div className={`mb-4 ${failed || interrupted ? "opacity-90" : ""}`}>
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
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-11 items-center gap-2 rounded-[10px] px-1.5 text-[12px] font-medium text-muted hover:text-text"
      >
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        <span>
          Worked{duration ? ` for ${duration}` : ""}
          {bits.length > 0 ? ` · ${bits.join(" · ")}` : ""}
        </span>
      </button>
      {open ? (
        <div className="ml-3 border-l-2 border-border pl-3">
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
    <div className="mb-3 flex items-center gap-2 text-[13px] text-muted" role="status">
      <Loader2 size={13} className="animate-spin text-accent" aria-hidden />
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
  const lastStreaming =
    items[items.length - 1]?.kind === "final" &&
    (items[items.length - 1] as { message: AgentMessage }).message.state === "streaming";
  return (
    <div>
      {items.map((item) => {
        if (item.kind === "user") return <UserMessage key={item.id} message={item.message} />;
        if (item.kind === "final") return <FinalMessage key={item.id} message={item.message} />;
        return <WorkRow key={item.id} item={item} />;
      })}
      {running && !lastStreaming ? <WorkingRow /> : null}
      {running && !hasMessages ? <WorkingRow /> : null}
    </div>
  );
});
