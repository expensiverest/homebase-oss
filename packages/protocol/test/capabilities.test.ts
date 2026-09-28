import { describe, expect, it } from "vitest";

import {
  capabilityKeys,
  defineCapabilities,
  enabledCapabilities,
  noCapabilities,
  supports,
} from "../src/capabilities.js";

describe("capability model", () => {
  it("exposes every capability key with a false baseline", () => {
    expect(Object.isFrozen(noCapabilities)).toBe(true);
    expect(capabilityKeys.length).toBeGreaterThanOrEqual(19);
    for (const key of capabilityKeys) {
      expect(noCapabilities[key]).toBe(false);
    }
  });

  it("builds complete capability records from partial declarations", () => {
    const capabilities = defineCapabilities({ streaming: true, interrupt: true, tools: true });

    expect(capabilities.streaming).toBe(true);
    expect(capabilities.interrupt).toBe(true);
    expect(capabilities.tools).toBe(true);
    // Omitted capabilities stay explicitly unsupported.
    expect(capabilities.approvals).toBe(false);
    expect(capabilities.usage).toBe(false);
    expect(Object.keys(capabilities).sort()).toEqual([...capabilityKeys].sort());
  });

  it("answers capability questions without provider identity checks", () => {
    const capabilities = defineCapabilities({ approvals: true, questions: true });

    expect(supports(capabilities, "approvals")).toBe(true);
    expect(supports(capabilities, "questions")).toBe(true);
    expect(supports(capabilities, "usage")).toBe(false);
    expect(enabledCapabilities(capabilities)).toEqual(["approvals", "questions"]);
  });
});
