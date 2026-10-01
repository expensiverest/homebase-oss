import { describe, expect, it } from "vitest";
import { acpContextUsage, grokLedgerUsage } from "../src/usage.js";
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
});
