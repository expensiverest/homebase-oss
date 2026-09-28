import { describe, expect, it } from "vitest";

import { createPublicId, decodePublicIdFor, isPublicIdFor, parsePublicId } from "../src/identity.js";

describe("public provider-scoped ids", () => {
  it("round-trips provider and native ids", () => {
    const id = createPublicId("claude", "0f0f0f0f-1111-2222-3333-444444444444");
    expect(id.startsWith("hb1~claude~")).toBe(true);
    expect(parsePublicId(id)).toEqual({ providerId: "claude", nativeId: "0f0f0f0f-1111-2222-3333-444444444444" });
    expect(decodePublicIdFor(id, "claude")).toBe("0f0f0f0f-1111-2222-3333-444444444444");
  });

  it("produces different public ids for identical native ids on different providers", () => {
    const claudeId = createPublicId("claude", "same-id");
    const opencodeId = createPublicId("opencode", "same-id");
    expect(claudeId).not.toBe(opencodeId);
    expect(isPublicIdFor(claudeId, "claude")).toBe(true);
    expect(isPublicIdFor(claudeId, "opencode")).toBe(false);
    expect(decodePublicIdFor(opencodeId, "opencode")).toBe("same-id");
  });

  it("is URL-path safe and deterministic", () => {
    const id = createPublicId("opencode", "ses_abc/../weird value");
    expect(encodeURIComponent(id)).toBe(id.replace(/[^A-Za-z0-9\-._~]/g, ""));
    expect(createPublicId("opencode", "ses_x")).toBe(createPublicId("opencode", "ses_x"));
  });

  it("rejects malformed, wrong-provider, non-canonical, and oversized ids", () => {
    expect(parsePublicId("")).toBeNull();
    expect(parsePublicId("ses_native")).toBeNull();
    expect(parsePublicId("hb1~claude")).toBeNull();
    expect(parsePublicId("hb1~claude~!!!")).toBeNull();
    expect(parsePublicId("hb1~Claude~c2FtZQ")).toBeNull();
    expect(parsePublicId(`hb1~claude~${Buffer.from("x".repeat(200)).toString("base64url")}`)).toBeNull();
    // Trailing padding is not canonical.
    expect(parsePublicId(`hb1~claude~${Buffer.from("same-id").toString("base64")}`)).toBeNull();
    expect(decodePublicIdFor(createPublicId("mock", "x"), "claude")).toBeNull();
  });

  it("rejects invalid inputs when creating ids", () => {
    expect(() => createPublicId("Bad Provider", "x")).toThrowError(/Invalid provider id/);
    expect(() => createPublicId("claude", "   ")).toThrowError(/must not be empty/);
    expect(() => createPublicId("claude", "x".repeat(97))).toThrowError(/too long/);
  });
});
