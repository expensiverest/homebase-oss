import { describe, expect, it } from "vitest";
import { acpContextUsage, grokLedgerUsage, mergeGrokUsage } from "../src/usage.js";
describe("Grok structured consumption", () => {
  it("uses stable ACP context updates without inventing tokens or converting currencies", () => {
    expect(acpContextUsage({ used: 100, size: 1000, cost: { amount: 0.25, currency: "USD" } }, "s")).toMatchObject({
      contextTokens: 100,
      contextWindow: 1000,
      tokens: {},
      costUsd: 0.25,
    });
    expect(acpContextUsage({ used: 100, size: 1000, cost: { amount: 2, currency: "EUR" } }, "s")?.costUsd).toBeNull();
  });
  it("validates the isolated x.ai usage extension and marks process totals partial", () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cachedReadTokens: 30,
      reasoningTokens: 2,
      cacheCreationTokens: 4,
      costUsdTicks: 800_000_000,
    };
    expect(grokLedgerUsage({ usage }, "s")).toMatchObject({
      tokens: { inputTokens: 100, totalTokens: 110, cacheReadTokens: 30, cacheWriteTokens: 4 },
      costUsd: 0.08,
      partial: true,
    });
    expect(grokLedgerUsage({ usage: { ...usage, costIsPartial: true } }, "s")?.costUsd).toBeNull();
  });
  it.each([
    {},
    { usage: { inputTokens: 1 } },
    { usage: { inputTokens: -1, outputTokens: 2, totalTokens: 1 } },
    { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 9 } },
  ])("ignores unknown/invalid extension shapes", (value) => {
    expect(grokLedgerUsage(value, "s")).toBeNull();
  });

  describe("mergeGrokUsage", () => {
    const ledger = (costUsdTicks?: number) =>
      grokLedgerUsage({ usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, costUsdTicks } }, "s")!;
    const acp = (cost?: number) =>
      acpContextUsage({ used: 50, size: 1000, cost: cost == null ? null : { amount: cost, currency: "USD" } }, "s")!;

    it("keeps an xAI ledger cost when a later ACP update has null cost", () => {
      const merged = mergeGrokUsage(ledger(800_000_000), { ...acp(), updatedAt: "2999-01-01T00:00:00.000Z" });
      expect(merged.costUsd).toBe(0.08);
      expect(merged.tokens.totalTokens).toBe(110);
      expect(merged.contextWindow).toBe(1000);
      expect(merged.partial).toBe(true);
      expect(merged.updatedAt).toBe("2999-01-01T00:00:00.000Z");
    });
    it("keeps an ACP cost when a later xAI ledger has null cost, and lets a non-null cost replace it", () => {
      const merged = mergeGrokUsage(acp(0.25), ledger());
      expect(merged.costUsd).toBe(0.25);
      expect(merged.contextTokens).toBe(50);
      expect(mergeGrokUsage(merged, ledger(800_000_000)).costUsd).toBe(0.08);
    });
    it("preserves tokens and context across interleaved ACP and xAI updates", () => {
      const afterLedger = mergeGrokUsage(acp(), ledger());
      const merged = mergeGrokUsage(afterLedger, acpContextUsage({ used: 70, size: 1000 }, "s")!);
      expect(merged.tokens).toMatchObject({ inputTokens: 100, outputTokens: 10, totalTokens: 110 });
      expect(merged.contextTokens).toBe(70);
      expect(merged.contextWindow).toBe(1000);
    });
  });
});
