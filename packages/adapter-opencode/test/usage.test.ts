import { describe, expect, it } from "vitest";
import { toSessionUsage } from "../src/usage.js";
import { nativeSession } from "./fixtures.js";
describe("OpenCode cumulative session usage", () => {
  it("normalizes native session totals once, including cache and reasoning", () => {
    const native = {
      ...nativeSession,
      cost: 0.08,
      tokens: { input: 10, output: 20, reasoning: 3, cache: { read: 4, write: 5 } },
    };
    expect(toSessionUsage(native, "public-id")).toMatchObject({
      provider: "opencode",
      sessionId: "public-id",
      costUsd: 0.08,
      tokens: {
        inputTokens: 19,
        outputTokens: 23,
        totalTokens: 42,
        reasoningTokens: 3,
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
      },
    });
    expect(toSessionUsage(native, "public-id")?.tokens).toEqual(toSessionUsage(native, "public-id")?.tokens);
  });
  it("leaves missing or invalid fields unknown", () => {
    expect(toSessionUsage(nativeSession, "s")).toBeNull();
    expect(toSessionUsage({ ...nativeSession, tokens: { input: 4, output: 8 } }, "s")).toBeNull();
    expect(
      toSessionUsage({ ...nativeSession, tokens: { input: 4, output: 8, cache: { read: 2 } } }, "s"),
    ).toMatchObject({
      tokens: { inputTokens: null, outputTokens: null, totalTokens: null, cacheReadTokens: 2 },
    });
    expect(toSessionUsage({ ...nativeSession, cost: -1 }, "s")).toBeNull();
  });
});
