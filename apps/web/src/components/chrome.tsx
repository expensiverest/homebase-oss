import { ChevronLeft, Moon, RefreshCw, Sun, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { AgentProvider } from "@homebase/protocol";

import { useLive } from "../lib/live.js";
import { useTheme } from "../lib/theme.js";
import { providerStatus } from "../lib/viewmodel.js";
import { Button, IconButton } from "./ui.js";

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
export function ConnectionPill({ hideWhenConnected = false }: { hideWhenConnected?: boolean }) {
  const connection = useLive((state) => state.connection);
  if (hideWhenConnected && connection === "connected") return null;
  const entry = CONNECTION_LABELS[connection] ?? CONNECTION_LABELS.connecting;
  const showLabel = connection !== "connected";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-caption font-medium text-muted"
      role="status"
      aria-live="polite"
      aria-label={showLabel ? undefined : "Connected"}
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
  const resolved = theme === "system" ? (document.documentElement.dataset.theme === "dark" ? "dark" : "light") : theme;
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <IconButton label={`Switch to ${next} theme`} onClick={() => setTheme(next)}>
      {resolved === "dark" ? <Sun size={19} aria-hidden /> : <Moon size={19} aria-hidden />}
    </IconButton>
  );
}

/** iOS-style "‹ Parent" back control; the parent's name keeps you oriented. */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Back to ${label}`}
      className="-ml-2.5 inline-flex min-h-11 min-w-11 max-w-[70%] items-center gap-0.5 rounded-full pr-3 text-row font-medium text-muted transition-colors hover:text-text active:text-text"
    >
      <ChevronLeft size={26} strokeWidth={2} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Top bar row that sits under the status bar: back on the left, utilities on the right. */
export function TopBar({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 items-center">{leading}</div>
      <div className="-mr-2 flex shrink-0 items-center">{trailing}</div>
    </div>
  );
}

/**
 * Provider health. Healthy is quiet: one muted line naming the ready agents.
 * Problems explain themselves: provider, what's wrong, and a Retry.
 */
export function ProviderHealth({
  providers,
  loading,
  onRetry,
  retrying,
  context = "global",
}: {
  providers: AgentProvider[];
  loading?: boolean;
  onRetry: () => void;
  retrying?: boolean;
  context?: "global" | "project";
}) {
  if (loading) return <p className="h-6 text-callout text-muted">Checking agents…</p>;
  const problems = providers.filter((provider) => providerStatus(provider).tone !== "ok");
  const ready = providers.filter((provider) => providerStatus(provider).tone === "ok");

  const readyLine =
    ready.length === 0 ? null : (
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-callout text-muted">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
        {ready.length <= 3 ? (
          ready.map((provider, index) => (
            <span key={provider.id} className="inline-flex items-center gap-1.5">
              <span className="text-text/80">{provider.name}</span>
              {index < ready.length - 1 ? <span aria-hidden>·</span> : null}
            </span>
          ))
        ) : (
          <span>{ready.length} agents</span>
        )}
        <span>{problems.length > 0 ? "ready" : ready.length === 1 ? "is ready" : "ready"}</span>
      </p>
    );

  if (problems.length === 0) return readyLine;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="alert"
        className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--warn)_28%,var(--border))] bg-warn-soft px-4 py-3.5"
      >
        <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          {problems.map((provider) => {
            const status = providerStatus(provider);
            return (
              <div key={provider.id} className="mb-1 last:mb-0">
                <p className="text-callout font-semibold text-text">
                  {provider.name} · {status.label.toLowerCase()}
                </p>
                <p className="text-callout text-muted">
                  {status.detail ??
                    (context === "project"
                      ? "Sessions from other agents still work."
                      : "Start it on your computer, then retry.")}
                </p>
              </div>
            );
          })}
        </div>
        <Button size="sm" variant="ghost" className="-my-1 -mr-2 shrink-0" onClick={onRetry} loading={retrying}>
          {retrying ? null : <RefreshCw size={14} aria-hidden />}
          Retry
        </Button>
      </div>
      {readyLine}
    </div>
  );
}
