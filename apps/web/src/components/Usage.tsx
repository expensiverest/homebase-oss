import { useQueryClient } from "@tanstack/react-query";
import type { AgentProvider, AgentProviderUsage, AgentSessionUsage } from "@homebase/protocol";
import { useUsage } from "../lib/queries.js";
import { relativeTime } from "../lib/format.js";
import { Button, Sheet, Spinner } from "./ui.js";

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
const tokens = (value: number) =>
  value >= 1000 ? `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : number(value);
const money = (value: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
const age = (value: string) => (relativeTime(value) === "now" ? "just now" : `${relativeTime(value)} ago`);

export function sessionUsageLabel(usage: AgentSessionUsage): string {
  const parts = [];
  if (usage.tokens.totalTokens != null) parts.push(`${tokens(usage.tokens.totalTokens)} tokens`);
  else if (usage.contextTokens != null) parts.push(`${tokens(usage.contextTokens)} context tokens`);
  else if (usage.tokens.outputTokens != null) parts.push(`${tokens(usage.tokens.outputTokens)} output tokens`);
  else if (usage.tokens.inputTokens != null) parts.push(`${tokens(usage.tokens.inputTokens)} input tokens`);
  if (usage.costUsd != null) parts.push(money(usage.costUsd));
  return parts.join(" · ") || "Usage details";
}

export function SessionUsageDetail({ usage }: { usage: AgentSessionUsage | null }) {
  if (!usage) return <p className="py-6 text-callout text-muted">Session usage isn't available from this provider.</p>;
  const metrics = [
    ["Input", usage.tokens.inputTokens],
    ["Output", usage.tokens.outputTokens],
    ["Reasoning", usage.tokens.reasoningTokens],
    ["Cache read", usage.tokens.cacheReadTokens],
    ["Cache write", usage.tokens.cacheWriteTokens],
    ["Total", usage.tokens.totalTokens],
  ] as const;
  return (
    <div>
      {usage.partial ? (
        <p className="mb-4 text-callout text-muted">
          Reported usage is incomplete. Historical work or subagents may be absent.
        </p>
      ) : null}
      <dl className="surface divide-y divide-border px-4">
        {metrics
          .filter(([, value]) => value != null)
          .map(([label, value]) => (
            <div key={label} className="flex min-h-11 items-center justify-between gap-3 py-2">
              <dt className="text-callout text-muted">{label}</dt>
              <dd className="readout text-callout text-text">{number(value!)}</dd>
            </div>
          ))}
        {usage.costUsd != null ? (
          <div className="flex min-h-11 items-center justify-between">
            <dt className="text-callout text-muted">Reported cost</dt>
            <dd className="readout text-callout">{money(usage.costUsd)}</dd>
          </div>
        ) : null}
        {usage.contextTokens != null ? (
          <div className="flex min-h-11 items-center justify-between gap-3">
            <dt className="text-callout text-muted">Context</dt>
            <dd className="readout text-callout">
              {number(usage.contextTokens)}
              {usage.contextWindow != null ? ` / ${number(usage.contextWindow)}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-3 text-caption text-muted">
        Updated {age(usage.updatedAt)}. Cache and reasoning counters are subsets of input and output. Provider-reported
        cost may be an estimate.
      </p>
    </div>
  );
}

export function ProviderUsageDetail({ usage }: { usage: AgentProviderUsage | null }) {
  if (!usage || !usage.windows.length)
    return (
      <p className="py-3 text-callout text-muted">
        No account limits have been reported yet. Check again after normal coding activity.
      </p>
    );
  return (
    <div>
      {usage.planName ? <p className="mb-2 text-callout text-muted">{usage.planName}</p> : null}
      <dl className="space-y-4">
        {usage.windows.map((window) => (
          <div key={window.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <dt className="text-callout font-medium">{window.label}</dt>
              <dd className="readout text-callout">
                {window.usedPercent != null
                  ? `${Math.round(window.usedPercent)}% used`
                  : window.remaining != null
                    ? `${number(window.remaining)} ${window.unit} remaining`
                    : window.used != null
                      ? `${number(window.used)}${window.limit != null ? ` / ${number(window.limit)}` : ""} ${window.unit}`
                      : "Usage unavailable"}
              </dd>
            </div>
            {window.usedPercent != null ? (
              <div
                role="progressbar"
                aria-label={`${window.label} used`}
                aria-valuenow={window.usedPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill"
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(0, Math.min(100, window.usedPercent))}%` }}
                />
              </div>
            ) : null}
            {window.resetsAt ? (
              <p className="mt-1.5 text-caption text-muted">
                Resets{" "}
                {new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(
                  new Date(window.resetsAt),
                )}
              </p>
            ) : null}
          </div>
        ))}
      </dl>
      <p className="mt-4 text-caption text-muted">Reported {age(usage.fetchedAt)}</p>
    </div>
  );
}

function ProviderUsageRow({ provider }: { provider: AgentProvider }) {
  const usage = useUsage(provider.id, provider.capabilities.providerUsage);
  return (
    <section className="hairline-top py-5 first:shadow-none">
      <h3 className="mb-3 text-row font-semibold">{provider.name}</h3>
      {!provider.capabilities.providerUsage ? (
        <p className="text-callout text-muted">This provider does not expose account usage limits.</p>
      ) : usage.isLoading ? (
        <Spinner label={`Loading ${provider.name} usage`} />
      ) : usage.isError ? (
        <p role="alert" className="text-callout text-bad">
          Account usage could not be loaded.
        </p>
      ) : (
        <ProviderUsageDetail usage={usage.data ?? null} />
      )}
    </section>
  );
}
export function ProviderUsageSheet({
  open,
  onClose,
  providers,
}: {
  open: boolean;
  onClose: () => void;
  providers: AgentProvider[];
}) {
  const client = useQueryClient();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Usage"
      footer={
        <Button className="w-full" onClick={() => void client.invalidateQueries({ queryKey: ["usage"] })}>
          Refresh reported usage
        </Button>
      }
    >
      <p className="text-callout text-muted">Account limits reported by your coding agents.</p>
      {open ? providers.filter((p) => p.installed).map((p) => <ProviderUsageRow key={p.id} provider={p} />) : null}
      {open && !providers.some((p) => p.installed) ? <p className="py-6 text-muted">No installed providers.</p> : null}
    </Sheet>
  );
}
export function SessionUsageSheet({
  open,
  onClose,
  usage,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  usage: AgentSessionUsage | null;
  onRefresh: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Session usage"
      footer={
        <Button className="w-full" onClick={onRefresh}>
          Refresh usage
        </Button>
      }
    >
      <SessionUsageDetail usage={usage} />
    </Sheet>
  );
}
