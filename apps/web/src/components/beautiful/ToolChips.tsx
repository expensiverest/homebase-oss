import { Ban, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

/*
 * Adapted from Beautiful UI "Tool Chips" (MIT, © 2026 Shane Levine; see
 * THIRD_PARTY_NOTICES.md). Kept: one compact row per tool call (glyph, label,
 * the argument in a mono chip), the glyph turning into a chevron when the row
 * is open, and the detail behind a hairline rail. Changed: rows are 44px touch
 * targets; there is no hover reveal (the chevron shows once open); a status
 * marker is added for running/failed/denied; detail content is supplied by the
 * caller from real tool input/output. Removed: the STEP_MS reveal timer, the
 * demo ROWS/DIFFS, the hover diff-preview popover and the "+2 more" link
 * (Homebase has no per-file line counts on tool calls; real diffs live in the
 * Changes sheet).
 */

export type ToolChipStatus = "running" | "done" | "failed" | "denied";

export interface ToolChipItem {
  key: string;
  icon: ReactNode;
  /** Short verb, e.g. "Read", "Run". */
  label: string;
  /** The argument: a path, command or query. */
  chip?: string | null;
  mono?: boolean;
  status: ToolChipStatus;
  /** Expanded content (input/output/error), or null when there is nothing to show. */
  detail?: ReactNode;
}

function StatusMarker({ status }: { status: ToolChipStatus }) {
  if (status === "running")
    return <Loader2 size={15} className="shrink-0 animate-spin text-accent" aria-label="Running" />;
  if (status === "failed")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-bad">
        <TriangleAlert size={13} aria-hidden />
        Failed
      </span>
    );
  if (status === "denied")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-caption font-medium text-muted">
        <Ban size={13} aria-hidden />
        Denied
      </span>
    );
  return null;
}

export function ToolChips({ items }: { items: ToolChipItem[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <ul className="flex flex-col" data-tool-chips>
      {items.map((item) => {
        const rowOpen = open.has(item.key);
        const expandable = Boolean(item.detail);
        return (
          <li key={item.key} className="min-w-0">
            <button
              type="button"
              aria-expanded={expandable ? rowOpen : undefined}
              onClick={() => expandable && toggle(item.key)}
              className="-mx-1.5 flex min-h-11 w-[calc(100%+0.75rem)] min-w-0 items-center gap-2.5 rounded-[12px] px-1.5 text-left transition-colors active:bg-fill"
            >
              <span
                className={`relative flex size-[1.125rem] shrink-0 items-center justify-center ${
                  item.status === "failed" ? "text-bad" : "text-muted"
                }`}
              >
                <span className={`flex transition-opacity duration-150 ${rowOpen ? "opacity-0" : ""}`}>
                  {item.icon}
                </span>
                <ChevronDown
                  size={15}
                  strokeWidth={2.25}
                  aria-hidden
                  className={`absolute transition-opacity duration-150 ${rowOpen ? "opacity-100" : "opacity-0"}`}
                />
              </span>
              <span
                className={`shrink-0 text-callout font-medium ${item.status === "running" ? "text-text" : "text-muted"}`}
              >
                {item.label}
              </span>
              {item.chip ? (
                <span
                  className={`inline-flex min-h-[1.625rem] min-w-0 flex-1 items-center truncate rounded-[8px] bg-fill px-2 text-caption text-text/85 ${
                    item.mono === false ? "" : "readout"
                  }`}
                >
                  <span className="truncate">{item.chip}</span>
                </span>
              ) : (
                <span className="flex-1" />
              )}
              <StatusMarker status={item.status} />
            </button>
            {expandable ? (
              <div className="bui-collapse" data-open={rowOpen}>
                <div inert={!rowOpen}>
                  {/* Detail mounts only while open: tool output can be large, and hidden copies confuse search. */}
                  {rowOpen ? (
                    <div className="mb-2 ml-[0.55rem] mt-0.5 flex flex-col gap-2 border-l border-border pl-4">
                      {item.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
