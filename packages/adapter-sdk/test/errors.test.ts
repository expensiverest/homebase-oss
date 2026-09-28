import { describe, expect, it } from "vitest";

import {
  AdapterError,
  isAdapterError,
  sanitizeErrorMessage,
  toAgentError,
  unsupportedCapability,
} from "../src/errors.js";

describe("adapter errors", () => {
  it("normalizes AdapterError into the protocol error shape", () => {
    const error = new AdapterError("provider_unavailable", "The provider is not running.", { retryable: true });
    expect(isAdapterError(error)).toBe(true);
    expect(error.toAgentError("mock")).toEqual({
      code: "provider_unavailable",
      message: "The provider is not running.",
      provider: "mock",
      retryable: true,
      details: null,
    });
  });

  it("normalizes unknown and abort errors without leaking stacks", () => {
    const unknown = toAgentError(new Error("boom"), { provider: "mock" });
    expect(unknown.code).toBe("provider_error");
    expect(unknown.message).toBe("boom");
    expect(JSON.stringify(unknown)).not.toContain("stack");

    const abort = new DOMException("Aborted", "AbortError");
    expect(toAgentError(abort, { provider: "mock" }).code).toBe("aborted");
  });

  it("bounds and cleans error messages", () => {
    const long = `first\u0000line ${"x".repeat(1_000)}`;
    const cleaned = sanitizeErrorMessage(long);
    expect(cleaned.length).toBeLessThanOrEqual(500);
    expect(cleaned).not.toContain("\u0000");
  });

  it("builds standard unsupported-capability errors", () => {
    const error = unsupportedCapability("steer", "mock");
    expect(error.code).toBe("unsupported_capability");
    expect(error.message).toContain("steer");
  });
});
