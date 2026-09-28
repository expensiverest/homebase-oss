import { Check, Lightbulb, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui.js";
import { ApprovalShell } from "./ApprovalCard.js";

/*
 * Recommendation Card. Upstream source for Beautiful UI's "Recommendation
 * Card" was not available to this project (see THIRD_PARTY_NOTICES.md); this
 * is a Homebase component in the same idiom, built on the adapted Approval
 * Card shell. The confidence meter is optional and renders only when a real
 * value is supplied; Homebase's protocol has no confidence field today, so in
 * production the meter never appears. No confidence is ever inferred.
 */

export function RecommendationCard({
  label,
  eyebrow = "The agent recommends",
  title,
  detail,
  confidence,
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
  /** 0–1, only when a real value exists. */
  confidence?: number | null;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  const hasConfidence = typeof confidence === "number" && Number.isFinite(confidence);
  const percent = hasConfidence ? Math.round(Math.min(1, Math.max(0, confidence)) * 100) : 0;
  return (
    <ApprovalShell label={label} tone="accent" eyebrow={eyebrow} icon={<Lightbulb size={14} aria-hidden />}>
      <h3 className="break-words text-row font-semibold leading-snug text-text">{title}</h3>
      {detail ? <p className="mt-1.5 text-callout text-muted">{detail}</p> : null}
      {hasConfidence ? (
        <div className="mt-3" data-confidence>
          <div className="mb-1 flex items-center justify-between text-caption text-muted">
            <span>Confidence</span>
            <span className="readout">{percent}%</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-fill-strong"
            role="meter"
            aria-label="Confidence"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : null}
      {children}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" className="flex-1 basis-[8rem]" loading={busy} onClick={onAccept}>
          {busy ? null : <Check size={16} aria-hidden />}
          {acceptLabel}
        </Button>
        <Button className="flex-1 basis-[8rem]" disabled={busy} onClick={onDecline}>
          <X size={16} aria-hidden />
          {declineLabel}
        </Button>
      </div>
    </ApprovalShell>
  );
}
