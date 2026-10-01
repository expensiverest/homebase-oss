import { nowTimestamp, type AgentSessionUsage, type AgentTokenUsage } from "@homebase/protocol";
import type { NativeSession } from "./native.js";

const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
/** Session.Info totals are maintained by SessionProjector. Do not add message
 * totals to them. OpenCode's input/output exclude cache/reasoning respectively. */
export function toSessionUsage(session: NativeSession, sessionId: string): AgentSessionUsage | null {
  const native = session.tokens;
  const input = count(native?.input),
    output = count(native?.output);
  const reasoning = count(native?.reasoning),
    read = count(native?.cache?.read),
    write = count(native?.cache?.write);
  const inputTokens = input !== null && read !== null && write !== null ? input + read + write : null;
  const outputTokens = output !== null && reasoning !== null ? output + reasoning : null;
  const tokens: AgentTokenUsage = {
    inputTokens,
    outputTokens,
    reasoningTokens: reasoning,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
  };
  const costUsd =
    typeof session.cost === "number" && Number.isFinite(session.cost) && session.cost >= 0 ? session.cost : null;
  if (!Object.values(tokens).some((value) => value != null) && costUsd === null) return null;
  const updated = session.time?.updated;
  return {
    provider: "opencode",
    sessionId,
    tokens,
    costUsd,
    updatedAt:
      typeof updated === "number" && Number.isFinite(updated) && updated > 0 && updated < 8640000000000000
        ? new Date(updated).toISOString()
        : nowTimestamp(),
  };
}
