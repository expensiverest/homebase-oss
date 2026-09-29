import { createTestAdapterContext } from "@homebase/adapter-sdk/testing";
import { describe, expect, it } from "vitest";

import { GrokAdapter } from "../src/index.js";

/**
 * Optional live Grok checks. They are intentionally limited to no-model-cost
 * operations: version detection and ACP initialize (capabilities/auth).
 * No prompt is ever sent, so no Grok subscription usage is consumed.
 *
 * Run with:
 *   HOMEBASE_TEST_GROK=1 npm test -w @homebase/adapter-grok
 */
const LIVE = process.env.HOMEBASE_TEST_GROK === "1";

describe.skipIf(!LIVE)("Grok live (no model prompts)", () => {
  it("detects the installed CLI and negotiates ACP v1", async () => {
    const adapter = new GrokAdapter();
    const context = createTestAdapterContext({ projectPath: process.cwd(), projectId: "prj_live" });
    adapter.init(context);
    try {
      const detection = await adapter.detect();
      expect(detection.installed).toBe(true);
      expect(detection.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(detection.compatible).toBe(true);

      const capabilities = await adapter.getCapabilities();
      expect(capabilities.streaming).toBe(true);
      expect(capabilities.interrupt).toBe(true);
      expect(capabilities.approvals).toBe(true);
      // Phase 5.5 declares queue/steer/questions/usage honestly unsupported.
      expect(capabilities.queue).toBe(false);
      expect(capabilities.steer).toBe(false);
    } finally {
      await adapter.dispose?.();
    }
  }, 30_000);
});
