import { describe, expect, it } from "vitest";
import {
  agentSessionUsageSchema,
  agentTurnUsageSchema,
  agentProviderUsageSchema,
  defineCapabilities,
} from "../src/index.js";
const session = { provider: "example", sessionId: "s", tokens: { totalTokens: 12 }, updatedAt: "2026-09-30T00:00:00Z" };
describe("explicit usage contracts", () => {
  it("separates session consumption, turn consumption and account limits", () => {
    expect(agentSessionUsageSchema.safeParse(session).success).toBe(true);
    expect(agentProviderUsageSchema.safeParse(session).success).toBe(false);
    expect(
      agentTurnUsageSchema.safeParse({ ...session, updatedAt: undefined, turnId: "t", observedAt: session.updatedAt })
        .success,
    ).toBe(false);
    const { updatedAt, ...base } = session;
    expect(agentTurnUsageSchema.safeParse({ ...base, turnId: "t", observedAt: updatedAt }).success).toBe(true);
    expect(defineCapabilities({ sessionUsage: true }).providerUsage).toBe(false);
  });
  it.each([-1, Infinity, NaN, 1.2])("rejects invalid token numbers %s", (n) => {
    expect(agentSessionUsageSchema.safeParse({ ...session, tokens: { totalTokens: n } }).success).toBe(false);
  });
  it("rejects credentials and malformed or out-of-bounds account limits", () => {
    expect(agentSessionUsageSchema.safeParse({ ...session, apiKey: "fixture-secret" }).success).toBe(false);
    for (const usedPercent of [-1, 101, Infinity])
      expect(
        agentProviderUsageSchema.safeParse({
          provider: "example",
          windows: [{ id: "window", label: "Window", unit: "percent", usedPercent }],
          fetchedAt: session.updatedAt,
        }).success,
      ).toBe(false);
    expect(agentSessionUsageSchema.safeParse({ ...session, updatedAt: "bad" }).success).toBe(false);
  });
});
