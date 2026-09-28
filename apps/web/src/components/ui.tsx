import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-[var(--accent-hover)]",
  secondary: "bg-surface-2 text-text border border-border hover:border-border-strong",
  ghost: "bg-transparent text-muted hover:text-text",
  danger: "bg-bad-soft text-bad border border-[var(--border)] hover:border-bad",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const sizing = size === "sm" ? "min-h-11 px-3 text-[13px] rounded-[10px]" : "min-h-11 px-4 rounded-[12px]";
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:opacity-45 ${sizing} ${VARIANT_CLASSES[variant]} ${className}`}
      style={{ minWidth: size === "sm" ? 36 : 44 }}
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
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-muted transition-colors hover:text-text disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <Loader2 size={16} className="animate-spin text-muted" aria-hidden />
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`hb-pulse rounded-[10px] bg-surface-2 ${className}`} />;
}

const TONE_CLASSES: Record<string, string> = {
  working: "bg-accent-soft text-accent",
  waiting: "bg-warn-soft text-warn",
  failed: "bg-bad-soft text-bad",
  ok: "bg-ok-soft text-ok",
  muted: "bg-surface-2 text-muted",
};

export function Pill({ tone = "muted", children }: { tone?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[tone] ?? TONE_CLASSES.muted}`}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone }: { tone: string }) {
  const color =
    tone === "working" || tone === "ok"
      ? "bg-ok"
      : tone === "waiting"
        ? "bg-warn"
        : tone === "failed"
          ? "bg-bad"
          : "bg-faint";
  return <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${color}`} />;
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
      {icon ? <div className="text-faint">{icon}</div> : null}
      <p className="text-[15px] font-medium text-text">{title}</p>
      {detail ? <p className="max-w-[30ch] text-[13px] text-muted">{detail}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
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
      <p className="text-[15px] font-medium text-text">{title}</p>
      {detail ? <p className="max-w-[32ch] text-[13px] text-muted">{detail}</p> : null}
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      {title ? (
        <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-faint">{title}</h2>
      ) : null}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface halo">{children}</div>
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
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const content = (
    <>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-[15px] font-medium text-text">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted">{subtitle}</div>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className="hairline-top flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors first:shadow-none active:bg-surface-2"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="hairline-top flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 first:shadow-none">
      {content}
    </div>
  );
}

export function TextField(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, id, className = "", ...rest } = props;
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[12px] font-medium text-muted">
        {label}
      </label>
      <input
        id={inputId}
        {...rest}
        className={`min-h-11 w-full rounded-[12px] border border-border bg-surface px-3 text-[15px] text-text placeholder:text-faint focus:border-accent focus:outline-none ${className}`}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ id: T; label: string }>;
  value: T | null;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            className={`min-h-11 rounded-full border px-4 text-[14px] font-medium transition-colors ${
              active
                ? "border-accent bg-accent-soft text-accent"
                : "border-border bg-surface text-muted hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
    const onKeyDown = (event: KeyboardEvent) => {
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
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="hb-rise relative flex max-h-[88dvh] w-full max-w-[560px] flex-col rounded-t-[var(--radius-xl)] border border-border bg-bg pb-safe halo"
      >
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <h2 id={titleId} className="text-[17px] font-semibold text-text">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-[10px] px-2 text-[13px] font-medium text-muted hover:text-text"
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
