import { Ban, Check, ChevronDown, X } from "lucide-react";
import { useState, type ReactNode } from "react";

/*
 * Adapted from Beautiful UI "Task Rows" (MIT, © 2026 Shane Levine; see
 * THIRD_PARTY_NOTICES.md). Kept: capsule rows with a spinner ring that becomes
 * a check or cross badge, a status pill, a trailing chevron and the dropdown
 * detail behind a rail. Changed: status comes from real state (tool calls or
 * plan steps); a "pending" (empty ring) and "denied" state are added; Homebase
 * tokens and 44px rows; details are caller-supplied nodes. Removed: the TICKS
 * timeline, the scripted pending → failed → completed "sequence" row, the
 * spinning retry glyph and the demo TASK_ROWS.
 */

export type TaskStatus = "pending" | "running" | "done" | "failed" | "denied";

export interface TaskRowItem {
  key: string;
  label: string;
  /** Short trailing fact, e.g. a file name or "2m". */
  meta?: string | null;
  status: TaskStatus;
  details?: ReactNode;
  /** A standalone action at the row's end (e.g. open a sub-agent's thread); never toggles the row. */
  action?: ReactNode;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  running: "Working",
  done: "Completed",
  failed: "Failed",
  denied: "Denied",
};

function Ring({ active }: { active: boolean }) {
  const size = 22;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      width={size}
      height={size}
      aria-hidden
      style={active ? { animation: "bui-spin 1.1s linear infinite" } : undefined}
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-strong)" strokeWidth={stroke} />
      {active ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.28} ${circumference * 0.72}`}
        />
      ) : null}
    </svg>
  );
}

function Badge({ status, animate }: { status: TaskStatus; animate: boolean }) {
  if (status === "pending") return <Ring active={false} />;
  if (status === "running") return <Ring active />;
  const tone = status === "done" ? "bg-ok" : status === "failed" ? "bg-bad" : "bg-faint";
  return (
    <span
      aria-hidden
      className={`flex size-[22px] items-center justify-center rounded-full text-[var(--bg)] ${tone}`}
      style={animate ? { animation: "bui-pop-in 300ms cubic-bezier(0.23,1,0.32,1) both" } : undefined}
    >
      {status === "done" ? (
        <Check size={13} strokeWidth={3.5} />
      ) : status === "failed" ? (
        <X size={12} strokeWidth={3.5} />
      ) : (
        <Ban size={12} strokeWidth={3} />
      )}
    </span>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  if (status === "pending" || status === "running") return null;
  const tone =
    status === "done" ? "bg-ok-soft text-ok" : status === "failed" ? "bg-bad-soft text-bad" : "bg-fill text-muted";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-[2px] text-caption font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** `animate` is for live runs only; history renders still (no motion on static content). */
export function TaskRows({ rows, label, animate = false }: { rows: TaskRowItem[]; label?: string; animate?: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label} data-task-rows>
      {rows.map((row) => {
        const rowOpen = open[row.key] ?? false;
        const expandable = Boolean(row.details);
        return (
          <li
            key={row.key}
            className={`overflow-hidden border border-border bg-surface shadow-[var(--shadow-surface)] transition-[border-radius] duration-300 ${
              rowOpen ? "rounded-[16px]" : "rounded-[22px]"
            }`}
            style={animate ? { animation: "bui-fade-up 360ms cubic-bezier(0.23,1,0.32,1) both" } : undefined}
          >
            <div className="flex items-center">
              <button
                type="button"
                aria-expanded={expandable ? rowOpen : undefined}
                onClick={() => expandable && setOpen((current) => ({ ...current, [row.key]: !rowOpen }))}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left"
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <Badge status={row.status} animate={animate} />
                </span>
                <span className="sr-only">{STATUS_LABEL[row.status]}: </span>
                <span
                  className={`min-w-0 flex-1 truncate text-callout font-medium ${
                    row.status === "pending" ? "text-muted" : "text-text"
                  }`}
                >
                  {row.label}
                </span>
                {row.meta ? (
                  <span className="readout min-w-0 max-w-[40%] shrink truncate text-caption text-muted">
                    {row.meta}
                  </span>
                ) : null}
                <StatusPill status={row.status} />
                {expandable ? (
                  <ChevronDown
                    size={15}
                    strokeWidth={2.25}
                    aria-hidden
                    className={`shrink-0 text-faint transition-transform duration-300 ${rowOpen ? "rotate-180" : ""}`}
                  />
                ) : null}
              </button>
              {row.action}
            </div>
            {expandable && rowOpen ? (
              <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                <span aria-hidden className="mx-auto h-full w-px bg-border" />
                <div className="flex min-w-0 flex-col gap-2">{row.details}</div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
