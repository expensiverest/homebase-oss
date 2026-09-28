import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Adapted from Beautiful UI "Approval Card" (MIT, © 2026 Shane Levine; see
 * THIRD_PARTY_NOTICES.md). Kept: the intervention card shell (question as the
 * heading, footer with a step counter and pill actions), the odometer
 * RollingDigits counter, and radio/checkbox choice rows. Changed: Homebase
 * tokens; 44px rows and controls; a tone accent (warn for approvals, iris for
 * questions); callers render real AgentApprovalRequest options or
 * AgentQuestionRequest fields. Removed: the hard-coded QUESTIONS, the
 * GlideMenu hover highlight (touch has no hover), the dismiss (×) button (an
 * agent blocked on you cannot be dismissed from here), "Start over", and the
 * site's Button/GlideMenu dependencies.
 */

const ROLL_MS = 400;

/** Odometer digits: each changed character rolls up (or down). */
export function RollingDigits({ value }: { value: string }) {
  const previous = useRef(value);
  const [from, setFrom] = useState(value);
  const [rolling, setRolling] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [direction, setDirection] = useState<"up" | "down">("up");

  useEffect(() => {
    if (previous.current === value) return;
    const old = previous.current;
    previous.current = value;
    const a = Number.parseInt(old, 10);
    const b = Number.parseInt(value, 10);
    setDirection(Number.isFinite(a) && Number.isFinite(b) && b < a ? "down" : "up");
    setFrom(old);
    setRolling(true);
    setShifted(false);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShifted(true));
    });
    const done = setTimeout(() => {
      setRolling(false);
      setFrom(value);
      setShifted(false);
    }, ROLL_MS);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      clearTimeout(done);
    };
  }, [value]);

  const chars = rolling ? value : from;
  return (
    <>
      {Array.from({ length: chars.length }, (_, index) => {
        const oldChar = from[index] ?? "";
        const newChar = chars[index] ?? "";
        if (!rolling || oldChar === newChar) return <span key={`${index}-${newChar}`}>{newChar}</span>;
        const top = direction === "down" ? newChar : oldChar;
        const bottom = direction === "down" ? oldChar : newChar;
        const rest = direction === "down" ? "0" : "-1em";
        const start = direction === "down" ? "-1em" : "0";
        return (
          <span
            key={`${index}-${oldChar}-${newChar}-${direction}`}
            style={{
              display: "inline-block",
              position: "relative",
              overflow: "hidden",
              height: "1em",
              lineHeight: "1em",
            }}
          >
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
                transform: `translateY(${shifted ? rest : start})`,
              }}
            >
              <span style={{ height: "1em", lineHeight: "1em" }}>{top}</span>
              <span style={{ height: "1em", lineHeight: "1em" }}>{bottom}</span>
            </span>
          </span>
        );
      })}
    </>
  );
}

const TONES = {
  warn: { border: "border-[color-mix(in_srgb,var(--warn)_34%,var(--border))]", eyebrow: "text-warn", bar: "bg-warn" },
  accent: {
    border: "border-[color-mix(in_srgb,var(--accent)_32%,var(--border))]",
    eyebrow: "text-accent",
    bar: "bg-accent",
  },
} as const;

/** The intervention surface: the agent is blocked until you act. */
export function ApprovalShell({
  label,
  tone,
  eyebrow,
  icon,
  children,
  footer,
}: {
  /** Accessible name of the region. */
  label: string;
  tone: keyof typeof TONES;
  eyebrow: string;
  icon: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const colors = TONES[tone];
  return (
    <section
      aria-label={label}
      className={`relative overflow-hidden rounded-[var(--radius-lg)] border bg-surface shadow-[var(--shadow-surface)] ${colors.border}`}
      style={{ animation: "bui-fade-up 380ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${colors.bar}`} />
      <div className="px-4 pb-4 pt-3.5">
        <p className={`eyebrow mb-2 flex items-center gap-1.5 ${colors.eyebrow}`}>
          {icon}
          {eyebrow}
        </p>
        {children}
      </div>
      {footer ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
    </section>
  );
}

/** A radio or checkbox row (44px), styled as Beautiful UI's choice rows. */
export function ChoiceRow({
  type,
  checked,
  label,
  description,
  onClick,
  tabIndex,
}: {
  type: "radio" | "check";
  checked: boolean;
  label: string;
  description?: string | null;
  onClick: () => void;
  tabIndex?: number;
}) {
  return (
    <button
      type="button"
      role={type === "radio" ? "radio" : "checkbox"}
      aria-checked={checked}
      tabIndex={tabIndex}
      onClick={onClick}
      className={`flex min-h-11 w-full items-center gap-3 rounded-[12px] px-2 py-1.5 text-left transition-colors ${
        checked ? "bg-accent-soft" : "active:bg-fill hover:bg-fill"
      }`}
    >
      <span
        aria-hidden
        className={`flex size-[1.125rem] shrink-0 items-center justify-center transition-colors duration-200 ${
          type === "radio" ? "rounded-full" : "rounded-[5px]"
        } ${checked ? "bg-accent text-on-accent" : "shadow-[inset_0_0_0_1.5px_var(--border-strong)] text-transparent"}`}
      >
        {type === "radio" ? (
          <span
            className="size-1.5 rounded-full bg-[var(--on-accent)] transition-transform duration-200"
            style={{ transform: checked ? "scale(1)" : "scale(0)" }}
          />
        ) : (
          <Check size={12} strokeWidth={3} />
        )}
      </span>
      <span className="min-w-0">
        <span className={`block text-body leading-snug ${checked ? "font-medium text-text" : "text-text/90"}`}>
          {label}
        </span>
        {description ? <span className="block text-caption text-muted">{description}</span> : null}
      </span>
    </button>
  );
}
