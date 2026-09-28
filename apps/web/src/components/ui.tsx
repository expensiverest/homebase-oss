import { ChevronDown, ChevronRight, GitBranch, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm" | "lg";
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // The screen's one primary action: iris with a soft same-color shadow.
  primary: "bg-accent text-on-accent shadow-[var(--shadow-accent)] hover:bg-[var(--accent-hover)]",
  secondary: "bg-fill text-text hover:bg-fill-strong",
  ghost: "bg-transparent text-muted hover:text-text active:bg-fill",
  danger: "bg-bad-soft text-bad",
};

const SIZE_CLASSES = {
  sm: "min-h-11 px-3.5 text-callout rounded-[12px]",
  md: "min-h-11 px-4 text-callout rounded-[var(--radius-md)]",
  lg: "min-h-[52px] px-6 text-row rounded-[16px]",
};

/** At least 44px tall; presses scale down slightly. */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-w-11 items-center justify-center gap-2 font-semibold tracking-[-0.01em] transition-[transform,background-color,opacity] duration-150 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

/** 44px icon-only button; `label` becomes the accessible name. */
export function IconButton({ label, className = "", children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-[transform,background-color,color] hover:text-text active:scale-95 active:bg-fill disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner({ label = "Loading", className = "" }: { label?: string; className?: string }) {
  return (
    <span role="status" aria-label={label} className={`inline-flex ${className}`}>
      <Loader2 size={16} className="animate-spin text-muted" aria-hidden />
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`hb-pulse rounded-[10px] bg-fill-strong ${className}`} />;
}

const TONE_CLASSES: Record<string, string> = {
  working: "bg-accent-soft text-accent",
  waiting: "bg-warn-soft text-warn",
  failed: "bg-bad-soft text-bad",
  ok: "bg-ok-soft text-ok",
  muted: "bg-fill text-muted",
};

/** Compact categorical status. Reserved for states that need attention. */
export function Pill({ tone = "muted", children }: { tone?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-caption font-medium ${TONE_CLASSES[tone] ?? TONE_CLASSES.muted}`}
    >
      {children}
    </span>
  );
}

const DOT_CLASSES: Record<string, string> = {
  working: "bg-accent",
  ok: "bg-ok",
  waiting: "bg-warn",
  failed: "bg-bad",
};

/** A small status dot; `pulse` radiates a ring for something live. */
export function StatusDot({
  tone,
  pulse = false,
  className = "",
}: {
  tone: string;
  pulse?: boolean;
  className?: string;
}) {
  const color = DOT_CLASSES[tone] ?? "bg-faint";
  return (
    <span aria-hidden className={`relative inline-flex h-2 w-2 shrink-0 ${className}`}>
      {pulse ? <span className={`hb-ping absolute inset-0 rounded-full ${color}`} /> : null}
      <span className={`relative h-full w-full rounded-full ${color}`} />
    </span>
  );
}

/** Branch name in mono with a small git glyph. */
export function BranchChip({ branch, className = "" }: { branch: string; className?: string }) {
  return (
    <span
      className={`readout inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-fill px-2 py-[2px] text-caption text-muted ${className}`}
      title={branch}
    >
      <GitBranch size={12} strokeWidth={2.25} className="shrink-0" aria-hidden />
      <span className="truncate">{branch}</span>
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-faint">{icon}</div> : null}
      <p className="font-serif text-[1.75rem] leading-tight text-text">{title}</p>
      {detail ? <p className="max-w-[32ch] text-callout text-muted">{detail}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-row font-semibold text-text">{title}</p>
      {detail ? <p className="max-w-[34ch] text-callout text-muted">{detail}</p> : null}
      {onRetry ? (
        <Button size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Mono eyebrow above a group, with an optional trailing readout. */
export function SectionLabel({ title, trailing, id }: { title: string; trailing?: ReactNode; id?: string }) {
  return (
    <div className="flex min-h-7 items-end justify-between gap-3 px-1 pb-2.5">
      <h2 id={id} className="eyebrow">
        {title}
      </h2>
      {trailing ? <div className="readout text-caption text-muted">{trailing}</div> : null}
    </div>
  );
}

/** Inset-grouped list: one lit surface, rows divided by hairlines. */
export function Group({
  title,
  trailing,
  children,
  className = "",
}: {
  title?: string;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={title ? id : undefined} className={className}>
      {title ? <SectionLabel id={id} title={title} trailing={trailing} /> : null}
      <div className="surface overflow-hidden">{children}</div>
    </section>
  );
}

export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  ariaLabel,
  chevron = false,
  className = "",
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  chevron?: boolean;
  className?: string;
}) {
  const content = (
    <>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-row font-medium text-text">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-callout text-muted">{subtitle}</div>
        ) : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
      {chevron ? <ChevronRight size={18} className="-mr-1 shrink-0 text-faint" aria-hidden /> : null}
    </>
  );
  const base = `hairline-top flex min-h-[64px] w-full items-center gap-3.5 px-4 py-3 first:shadow-none ${className}`;
  if (onClick) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={`${base} text-left transition-colors active:bg-surface-2`}
      >
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
}

export function TextField(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, id, className = "", ...rest } = props;
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="px-1 text-caption font-medium text-muted">
        {label}
      </label>
      <input
        id={inputId}
        {...rest}
        className={`min-h-12 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3.5 text-body text-text placeholder:text-faint focus:border-accent focus:outline-none ${className}`}
      />
    </div>
  );
}

/**
 * iOS-style segmented control with a sliding thumb. Behaves as a radio group:
 * arrow keys move and select, and only the selected segment is tabbable.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
  disabled = false,
}: {
  options: Array<{ id: T; label: ReactNode; ariaLabel?: string }>;
  value: T | null;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const count = options.length;
  const found = options.findIndex((option) => option.id === value);
  const index = Math.max(0, found);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step || count === 0) return;
    event.preventDefault();
    const next = (index + step + count) % count;
    const option = options[next];
    if (!option) return;
    onChange(option.id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`relative grid min-h-[50px] rounded-[16px] bg-fill p-[3px] ${disabled ? "opacity-45" : ""} ${className}`}
      style={{ gridTemplateColumns: `repeat(${Math.max(count, 1)}, minmax(0, 1fr))` }}
    >
      {found >= 0 ? (
        <span
          aria-hidden
          className="absolute inset-y-[3px] left-[3px] rounded-[13px] border border-border bg-[var(--thumb)] shadow-[var(--shadow-surface)] transition-transform duration-300 ease-[var(--ease-spring)]"
          style={{ width: `calc((100% - 6px) / ${count})`, transform: `translateX(${index * 100}%)` }}
        />
      ) : null}
      {options.map((option, position) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            ref={(element) => {
              refs.current[position] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel}
            tabIndex={active || (found < 0 && position === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={`relative z-10 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 truncate rounded-[13px] px-2 text-callout transition-colors ${
              active ? "font-semibold text-text" : "font-medium text-muted hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A control that shows the current choice and opens a picker: model, mode.
 * Quiet fill, not a pill; the label truncates, never the chevron.
 */
export function PickerButton({
  label,
  value,
  detail,
  icon,
  onClick,
  disabled,
  className = "",
  ariaLabel,
}: {
  label?: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      className={`inline-flex min-h-11 min-w-0 items-center gap-2 rounded-[var(--radius-md)] bg-fill px-3 text-left text-callout transition-[transform,background-color] hover:bg-fill-strong active:scale-[0.98] disabled:opacity-40 ${className}`}
    >
      {icon ? <span className="shrink-0 text-muted">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        {label ? <span className="text-caption leading-tight text-muted">{label}</span> : null}
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium text-text">{value}</span>
          {detail ? <span className="shrink-0 text-muted">{detail}</span> : null}
        </span>
      </span>
      <ChevronDown size={16} className="shrink-0 text-muted" aria-hidden />
    </button>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () => [
      ...(panel?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    const preferred = panel?.querySelector<HTMLElement>("[data-autofocus]");
    (preferred ?? focusable()[0])?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div aria-hidden className="hb-rise absolute inset-0 bg-scrim" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="hb-sheet relative flex max-h-[88dvh] w-full max-w-[560px] flex-col rounded-t-[var(--radius-xl)] border border-b-0 border-border bg-bg pb-safe shadow-[var(--shadow-lift)]"
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-fill-strong" />
        <header className="flex items-center justify-between gap-3 px-5 pt-2 pb-2">
          <h2 id={titleId} className="text-[1.25rem] font-semibold tracking-[-0.015em] text-text">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 min-h-11 rounded-full px-3 text-callout font-semibold text-accent active:bg-fill"
          >
            Done
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? <footer className="hairline-top px-5 py-3 pb-safe-composer">{footer}</footer> : null}
      </div>
    </div>
  );
}
