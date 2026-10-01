import { readFileSync, statSync } from "node:fs";
import { nowTimestamp, type AgentSessionUsage, type AgentTokenUsage } from "@homebase/protocol";
import type { NativeUsage } from "./native.js";

const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
export function claudeTokens(native: NativeUsage): AgentTokenUsage {
  const input = count(native.input_tokens),
    output = count(native.output_tokens);
  const read = count(native.cache_read_input_tokens),
    write = count(native.cache_creation_input_tokens);
  const fullInput = input !== null && read !== null && write !== null ? input + read + write : null;
  return {
    inputTokens: fullInput,
    outputTokens: output,
    reasoningTokens: count(native.output_tokens_details?.thinking_tokens),
    cacheReadTokens: read,
    cacheWriteTokens: write,
    // Without cache counters the uncached input cannot establish a full total.
    totalTokens: fullInput !== null && output !== null && read !== null && write !== null ? fullInput + output : null,
  };
}

/** Assistant input/cache usage is a per-call snapshot, repeated across content
 * frames. Its output count can be a message_start placeholder. Only a result
 * establishes completed turn output. Result tokens cover the main loop, while
 * cost is cumulative for the process (restored on resume since 2.1.277). */
export class ClaudeUsageLedger {
  readonly messages = new Map<string, AgentTokenUsage>();
  readonly turns = new Map<string, { tokens: AgentTokenUsage; messageIds: Set<string> }>();
  readonly pendingIds = new Set<string>();
  costUsd: number | null = null;
  #costBeforeProcess = 0;
  #restoresSpend = false;
  #updatedAt = "1970-01-01T00:00:00.000Z";
  beginProcess(): void {
    this.#costBeforeProcess = this.costUsd ?? 0;
    this.#restoresSpend = false;
  }
  setVersion(version: string | undefined): void {
    const match = version?.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return;
    const [major, minor, patch] = match.slice(1).map(Number);
    this.#restoresSpend = major! > 2 || (major === 2 && (minor! > 1 || (minor === 1 && patch! >= 277)));
  }
  observe(id: string, usage: NativeUsage): void {
    this.messages.set(id, { ...claudeTokens(usage), outputTokens: null, reasoningTokens: null, totalTokens: null });
    this.#updatedAt = nowTimestamp();
    if (![...this.turns.values()].some((turn) => turn.messageIds.has(id))) this.pendingIds.add(id);
  }
  finish(
    turnId: string,
    usage: NativeUsage | undefined,
    cost: number | undefined,
    failed = false,
  ): AgentTokenUsage | null {
    const zeroedError = failed && usage && Object.values(claudeTokens(usage)).every((v) => v === null || v === 0);
    const tokens = usage && !zeroedError ? claudeTokens(usage) : null;
    if (tokens) this.turns.set(turnId, { tokens, messageIds: new Set(this.pendingIds) });
    this.pendingIds.clear();
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0 && !(failed && cost === 0)) {
      this.costUsd = this.#restoresSpend ? cost : this.#costBeforeProcess + cost;
    }
    this.#updatedAt = nowTimestamp();
    return tokens;
  }
  readHistory(file: string): void {
    try {
      if (statSync(file).size > 16 * 1024 * 1024) return;
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        try {
          const e = JSON.parse(line);
          if (e.type !== "assistant" || e.isSidechain || e.isMeta || String(e.message?.model ?? "").startsWith("<"))
            continue;
          if (typeof e.message?.id === "string" && e.message?.usage && !this.messages.has(e.message.id)) {
            this.messages.set(e.message.id, {
              ...claudeTokens(e.message.usage),
              outputTokens: null,
              reasoningTokens: null,
              totalTokens: null,
            });
            if (typeof e.timestamp === "string" && Number.isFinite(Date.parse(e.timestamp))) {
              const timestamp = new Date(e.timestamp).toISOString();
              if (timestamp > this.#updatedAt) this.#updatedAt = timestamp;
            }
          }
        } catch {
          /* tolerant provider-owned history */
        }
      }
    } catch {
      /* missing history does not invent usage */
    }
  }
  snapshot(sessionId: string): AgentSessionUsage | null {
    const covered = new Set([...this.turns.values()].flatMap((t) => [...t.messageIds]));
    const records = [...this.messages]
      .filter(([id]) => !covered.has(id))
      .map(([, tokens]) => tokens)
      .concat([...this.turns.values()].map((t) => t.tokens));
    if (!records.some((record) => Object.values(record).some((value) => value != null)) && this.costUsd === null)
      return null;
    const tokens: AgentTokenUsage = {};
    for (const key of [
      "inputTokens",
      "outputTokens",
      "reasoningTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "totalTokens",
    ] as const) {
      const values = records.map((t) => t[key]);
      tokens[key] =
        values.length && values.every((v) => typeof v === "number")
          ? values.reduce<number>((sum, v) => sum + (v as number), 0)
          : null;
    }
    return { provider: "claude", sessionId, tokens, costUsd: this.costUsd, partial: true, updatedAt: this.#updatedAt };
  }
}
