import { ChevronUp, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { formatDuration, plural } from "../lib/format.js";
import { subagentSummary, type SubagentView } from "../lib/viewmodel.js";
import { TaskRows, type TaskRowItem, type TaskStatus } from "./beautiful/TaskRows.js";
import { OpenThreadButton } from "./OpenThreadButton.js";
import { Sheet } from "./ui.js";

/*
 * Sub-agent status. When the model spawns sub-agents (Claude's Task tool,
 * OpenCode's task tool) the run is no longer one thread, so the state of each
 * one has to be one tap away: a strip above the composer summarises them, and
 * tapping it opens a sheet with a row per agent (status, kind, how long, and
 * what it was asked and answered). Everything is derived from normalized tool
 * calls (see `subagentsOf`); nothing here knows which provider produced them.
 */

const TASK_STATUS: Record<SubagentView["status"], TaskStatus> = {
  running: "running",
  completed: "done",
  failed: "failed",
  denied: "denied",
};

const DOT_TONE: Record<SubagentView["status"], string> = {
  running: "bg-accent",
  completed: "bg-ok",
  failed: "bg-bad",
  denied: "bg-faint",
};

/** How long the strip lingers after the last agent finishes before it steps out of the way. */
export const AGENTS_STRIP_LINGER_MS = 5_000;

/**
 * The strip is a heads-up, not furniture: it stays while any agent is working,
 * lingers a few seconds after the last one settles, then goes. It only lingers
 * for agents you watched work, so opening a finished session never flashes it.
 * (Each agent's state stays in the run's trace, and new agents bring it back.)
 */
export function useAgentsStripVisible(
  agents: SubagentView[],
  resetKey: string,
  lingerMs: number = AGENTS_STRIP_LINGER_MS,
): boolean {
  const working = agents.some((agent) => agent.status === "running");
  const signature = agents.map((agent) => agent.id).join(",");
  const [watched, setWatched] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    setWatched(null);
    setDismissed(null);
  }, [resetKey]);

  useEffect(() => {
    if (working) setWatched(signature);
  }, [working, signature]);

  useEffect(() => {
    if (working || agents.length === 0 || watched !== signature) return;
    const timer = setTimeout(() => setDismissed(signature), lingerMs);
    return () => clearTimeout(timer);
  }, [working, agents.length, watched, signature, lingerMs]);

  if (agents.length === 0) return false;
  return working || (watched === signature && dismissed !== signature);
}

function summaryText(agents: SubagentView[]): string {
  const { total, working, failed } = subagentSummary(agents);
  if (working > 0) return total === 1 ? "1 agent working" : `${working} of ${total} agents working`;
  if (failed > 0) return `${plural(total, "agent")} · ${failed} failed`;
  return `${plural(total, "agent")} · all done`;
}

/** The strip above the composer. Always one 44px line, however many agents there are. */
export function AgentsStrip({ agents, onOpen }: { agents: SubagentView[]; onOpen: () => void }) {
  const working = agents.some((agent) => agent.status === "running");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`${summaryText(agents)}. View agents`}
      data-agents-strip={working ? "working" : "settled"}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-full border border-border bg-surface px-3.5 text-left shadow-[var(--shadow-surface)] transition-transform active:scale-[0.99]"
    >
      <Users size={16} strokeWidth={2.25} className={working ? "text-accent" : "text-muted"} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-callout font-medium text-text" aria-live="polite">
        {summaryText(agents)}
      </span>
      <span aria-hidden className="flex shrink-0 items-center gap-1">
        {agents.slice(0, 8).map((agent) => (
          <span
            key={agent.id}
            className={`size-2 rounded-full ${DOT_TONE[agent.status]} ${agent.status === "running" ? "animate-pulse" : ""}`}
          />
        ))}
      </span>
      <ChevronUp size={15} strokeWidth={2.25} className="shrink-0 text-faint" aria-hidden />
    </button>
  );
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

function Detail({ label, text, tone }: { label: string; text: string; tone?: "bad" }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-1">{label}</p>
      <p
        className={`max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-callout ${tone === "bad" ? "text-bad" : "text-muted"}`}
      >
        {text}
      </p>
    </div>
  );
}

function rowFor(agent: SubagentView, now: number, onOpenThread: () => void): TaskRowItem {
  const took =
    agent.status === "running"
      ? formatDuration(agent.startedAt, new Date(now).toISOString())
      : formatDuration(agent.startedAt, agent.completedAt);
  const hasDetail = agent.kind || agent.prompt || agent.result || agent.error;
  return {
    key: agent.id,
    label: agent.title,
    meta: took,
    status: TASK_STATUS[agent.status],
    action: agent.threadId ? (
      <OpenThreadButton sessionId={agent.threadId} title={agent.title} onOpen={onOpenThread} />
    ) : null,
    details: hasDetail ? (
      <>
        {agent.kind ? <Detail label="Agent type" text={agent.kind} /> : null}
        {agent.prompt ? <Detail label="Asked" text={agent.prompt} /> : null}
        {agent.result ? <Detail label="Result" text={agent.result} /> : null}
        {agent.error ? <Detail label="Error" text={agent.error} tone="bad" /> : null}
      </>
    ) : null,
  };
}

export function AgentsSheet({ open, onClose, agents }: { open: boolean; onClose: () => void; agents: SubagentView[] }) {
  const summary = subagentSummary(agents);
  const now = useNow(open && summary.working > 0);
  return (
    <Sheet open={open} onClose={onClose} title="Agents">
      <p className="mb-3 text-callout text-muted" data-agents-summary>
        {[
          summary.working > 0 ? `${summary.working} working` : null,
          summary.done > 0 ? `${summary.done} done` : null,
          summary.failed > 0 ? `${summary.failed} failed` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <TaskRows rows={agents.map((agent) => rowFor(agent, now, onClose))} label="Agents" animate />
    </Sheet>
  );
}
