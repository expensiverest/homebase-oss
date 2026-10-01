import { z } from "zod";
import { nowTimestamp, type AgentSessionUsage } from "@homebase/protocol";

const count = z.number().int().nonnegative().safe();
// This extension belongs to Grok, not to the generic ACP transport. Unknown
// shapes are discarded; model/pricing/identity metadata never crosses the API.
const ledgerSchema = z.object({
  usage: z.object({
    inputTokens: count,
    outputTokens: count,
    totalTokens: count,
    reasoningTokens: count.optional(),
    cachedReadTokens: count.optional(),
    cacheCreationTokens: count.optional(),
    costUsdTicks: z.number().nonnegative().safe().nullish(),
    costIsPartial: z.boolean().optional(),
    usageIsIncomplete: z.boolean().optional(),
  }),
});

export function grokLedgerUsage(value: unknown, sessionId: string): AgentSessionUsage | null {
  const parsed = ledgerSchema.safeParse(value);
  if (!parsed.success) return null;
  const u = parsed.data.usage;
  if (u.totalTokens !== u.inputTokens + u.outputTokens) return null;
  if (
    (u.reasoningTokens ?? 0) > u.outputTokens ||
    (u.cachedReadTokens ?? 0) + (u.cacheCreationTokens ?? 0) > u.inputTokens
  )
    return null;
  return {
    provider: "grok",
    sessionId,
    tokens: {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      totalTokens: u.totalTokens,
      reasoningTokens: u.reasoningTokens ?? null,
      cacheReadTokens: u.cachedReadTokens ?? null,
      cacheWriteTokens: u.cacheCreationTokens ?? null,
    },
    costUsd: u.costIsPartial || u.usageIsIncomplete || u.costUsdTicks == null ? null : u.costUsdTicks / 1e10,
    // The upstream ledger only covers this ACP process, including resumed
    // sessions. It must never be presented as a complete historical total.
    partial: true,
    updatedAt: nowTimestamp(),
  };
}

const contextSchema = z.object({
  used: count,
  size: count.positive(),
  cost: z.object({ amount: z.number().nonnegative(), currency: z.string() }).nullish(),
});
export function acpContextUsage(value: unknown, sessionId: string): AgentSessionUsage | null {
  const parsed = contextSchema.safeParse(value);
  if (!parsed.success) return null;
  const u = parsed.data;
  return {
    provider: "grok",
    sessionId,
    tokens: {},
    contextTokens: u.used,
    contextWindow: u.size,
    costUsd: u.cost?.currency === "USD" ? u.cost.amount : null,
    partial: true,
    updatedAt: nowTimestamp(),
  };
}
