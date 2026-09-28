import { ArrowLeft, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { useLive } from "../lib/live.js";
import { useTheme } from "../lib/theme.js";
import { IconButton } from "./ui.js";

const CONNECTION_LABELS: Record<string, { label: string; tone: string }> = {
  connecting: { label: "Connecting", tone: "bg-faint" },
  connected: { label: "Live", tone: "bg-ok" },
  reconnecting: { label: "Reconnecting…", tone: "bg-warn" },
  offline: { label: "Offline", tone: "bg-bad" },
  "auth-required": { label: "Sign in required", tone: "bg-bad" },
};

/**
 * Quiet connection state: connected shows only a small dot; problems explain
 * themselves without alarming the first paint.
 */
export function ConnectionPill() {
  const connection = useLive((state) => state.connection);
  const entry = CONNECTION_LABELS[connection] ?? CONNECTION_LABELS.connecting;
  const showLabel = connection !== "connected";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted"
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${entry?.tone ?? "bg-faint"} ${connection === "connected" ? "" : "hb-pulse"}`}
      />
      {showLabel ? <span>{entry?.label ?? ""}</span> : null}
    </span>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <IconButton label={`Switch to ${next} theme`} onClick={() => setTheme(next)}>
      {theme === "dark" ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </IconButton>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  trailing,
  large = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  trailing?: ReactNode;
  large?: boolean;
}) {
  return (
    <header className="pt-safe px-safe pb-2">
      <div className="flex min-h-11 items-center gap-1">
        {onBack ? (
          <IconButton label="Back" onClick={onBack} className="-ml-2">
            <ArrowLeft size={20} aria-hidden />
          </IconButton>
        ) : null}
        <div className="min-w-0 flex-1">
          {large ? (
            <h1 className="truncate font-serif text-[28px] leading-tight text-text">{title}</h1>
          ) : (
            <h1 className="truncate text-[17px] font-semibold text-text">{title}</h1>
          )}
          {subtitle ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] text-muted">{subtitle}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">{trailing}</div>
      </div>
    </header>
  );
}
