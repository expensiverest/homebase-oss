import { useEffect, useState } from "react";

/*
 * Adapted from Beautiful UI "Loading State" (MIT, © 2026 Shane Levine; see
 * THIRD_PARTY_NOTICES.md). Kept: the 3×3 pixel grid with the Orbit pattern (a
 * comet lapping the perimeter), the shimmering label and the tabular elapsed
 * timer. Changed: Homebase tokens; the timer counts from a real start time
 * passed in (the turn's start) instead of from mount, and is omitted when that
 * time is unknown. Removed: the Drive/Dots/Surfer variants, the hosted meme
 * video, and the demo's default label.
 */

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const ORBIT_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const step = ORBIT_ORDER.indexOf(index);
  return step === -1 ? null : step * 110;
});
const ORBIT_MS = 950;

export function OrbitLoader({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px] ${className}`}>
      {ORBIT_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="size-[4px] rounded-[1px] bg-accent"
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation: delay === null ? "none" : `bui-pixel-on ${ORBIT_MS}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

/** "4.2s", "1m 05.0s". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}s`;
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

/**
 * Agent-activity indicator for a turn that has started but shown nothing yet.
 * Never used for ordinary data loading (that is what skeletons are for).
 */
export function LoadingState({ label, since }: { label: string; since?: string | null }) {
  const start = since ? Date.parse(since) : Number.NaN;
  const known = Number.isFinite(start);
  const now = useNow(known);
  return (
    <div role="status" aria-label={label} className="flex min-h-11 w-fit items-center gap-2.5" data-agent-loading>
      <OrbitLoader />
      <span className="shimmer text-callout font-medium">{label}</span>
      {known ? (
        <span className="readout text-caption text-muted" aria-hidden>
          {formatElapsed(now - start)}
        </span>
      ) : null}
    </div>
  );
}
