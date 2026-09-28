import { Check, Lightbulb, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "../ui.js";
import { ApprovalShell } from "./ApprovalCard.js";

/*
 * Adapted from Beautiful UI "Recommendation Card" (MIT, © 2026 Shane Levine;
 * source pinned at slev12397/beautiful-ui@44a274e; see THIRD_PARTY_NOTICES.md).
 * Kept: the card that holds its shape — the question as the title, the
 * recommendation body under it, an optional "Alternatives" drawer that opens as
 * a new section of the card, and a footer with a signal meter on the left and
 * the actions on the right. Changed: Homebase tokens, 44px actions, the shared
 * intervention shell (the agent is waiting on you); actions are real answers
 * supplied by the caller. The signal meter is optional and renders only when a
 * real 0–3 signal is supplied — Homebase's protocol has none today, so it never
 * appears and is never inferred. Removed: the demo OPTIONS (restock orders,
 * "High confidence"), the local "Accepted" state, and the site's
 * Button/EntityChip/ValuePill atoms.
 */

export interface RecommendationAlternative {
  key: string;
  label: string;
  onPick: () => void;
}

function Meter({ signal }: { signal: number }) {
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="w-1 rounded-full"
          style={{ height: 10, background: bar < signal ? "var(--accent)" : "var(--border-strong)" }}
        />
      ))}
    </span>
  );
}

export function RecommendationCard({
  label,
  eyebrow = "The agent recommends",
  title,
  detail,
  signal,
  signalLabel,
  alternatives,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
  busy,
  children,
}: {
  label: string;
  eyebrow?: string;
  title: string;
  detail?: string | null;
  /** 0–3 bars, only when real data exists (never inferred). */
  signal?: number | null;
  signalLabel?: string | null;
  alternatives?: RecommendationAlternative[];
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const hasSignal = typeof signal === "number" && Number.isFinite(signal) && Boolean(signalLabel);
  const hasAlternatives = (alternatives?.length ?? 0) > 0;

  return (
    <ApprovalShell
      label={label}
      tone="accent"
      eyebrow={eyebrow}
      icon={<Lightbulb size={14} aria-hidden />}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {hasSignal ? (
            <span className="flex items-center gap-2" data-signal>
              <Meter signal={Math.max(0, Math.min(3, Math.round(signal as number)))} />
              <span className="text-caption font-medium text-muted">{signalLabel}</span>
            </span>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {hasAlternatives ? (
              <Button aria-expanded={open} aria-controls={drawerId} onClick={() => setOpen((current) => !current)}>
                Alternatives
              </Button>
            ) : null}
            <Button disabled={busy} onClick={onDecline}>
              <X size={16} aria-hidden />
              {declineLabel}
            </Button>
            <Button variant="primary" loading={busy} onClick={onAccept}>
              {busy ? null : <Check size={16} aria-hidden />}
              {acceptLabel}
            </Button>
          </span>
        </div>
      }
    >
      <h3 className="break-words text-row font-semibold leading-snug text-text">{title}</h3>
      {detail ? (
        <p
          className="mt-1.5 text-callout leading-relaxed text-muted"
          style={{ animation: "bui-fade-up 220ms ease-out both" }}
        >
          {detail}
        </p>
      ) : null}
      {children}
      {hasAlternatives ? (
        <div id={drawerId} className="bui-collapse" data-open={open}>
          <div inert={!open}>
            <div className="-mx-4 mt-3 border-t border-border px-2 pt-2">
              <p className="px-2 pb-1 text-caption font-medium text-muted">Other options</p>
              {alternatives?.map((alternative) => (
                <button
                  key={alternative.key}
                  type="button"
                  onClick={alternative.onPick}
                  className="flex min-h-11 w-full items-center rounded-[12px] px-2 text-left text-callout text-text transition-colors active:bg-fill"
                >
                  {alternative.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </ApprovalShell>
  );
}
