import { Brain as StaticBrain, ChevronDown } from "lucide-react";
import { lazy, Suspense, useId, useState, type ReactNode } from "react";

// Code-split: see AnimatedBrain.tsx. The static Brain holds the slot while it loads.
const AnimatedBrain = lazy(() => import("./AnimatedBrain.js"));

/*
 * Adapted from Beautiful UI "Thinking" (MIT, © 2026 Shane Levine; see
 * THIRD_PARTY_NOTICES.md). Kept: the header that shimmers while working and
 * settles to a quiet label, the chevron, and the expandable trace behind a thin
 * left rail. Changed: the sparkle glyph is replaced by a Brain
 * whose fold-ripple animation loops while active (AnimatedBrain.tsx) and is static when settled; open
 * state follows the real `active` prop instead of a scripted timeline.
 * Removed: the self-running STAGES sequence and the demo Steps/Search/Coding
 * content. Homebase renders only reasoning text a provider actually sent.
 */

export function Thinking({
  active,
  label,
  children,
  defaultOpen,
}: {
  /** The provider is still streaming this reasoning. */
  active: boolean;
  /** Settled label, e.g. "Thought for 4s" or "Thought process". */
  label: string;
  children: ReactNode;
  /** Initial open state; defaults to open while active. */
  defaultOpen?: boolean;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? defaultOpen ?? active;
  const id = useId();

  return (
    <div className="my-1" data-thinking={active ? "active" : "settled"}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setManual(!open)}
        className="-ml-2 inline-flex min-h-11 max-w-full items-center gap-2 rounded-[12px] px-2 text-callout font-medium text-muted transition-colors hover:text-text active:bg-fill"
      >
        <span
          className={`inline-flex shrink-0 ${active ? "text-accent" : "text-muted"}`}
          data-brain={active ? "animated" : "static"}
        >
          {active ? (
            <Suspense fallback={<StaticBrain size={17} strokeWidth={2} aria-hidden />}>
              <AnimatedBrain size={17} />
            </Suspense>
          ) : (
            <StaticBrain size={17} strokeWidth={2} aria-hidden />
          )}
        </span>
        <span role="status" className={active ? "shimmer" : undefined}>
          {active ? "Thinking…" : label}
        </span>
        <ChevronDown
          size={15}
          strokeWidth={2.25}
          className={`shrink-0 text-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      <div id={id} className="bui-collapse" data-open={open}>
        <div inert={!open}>
          <div className="relative mb-2 ml-[0.55rem] mt-0.5 border-l border-border pl-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
