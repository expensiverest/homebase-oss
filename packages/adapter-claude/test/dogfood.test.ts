import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { createTestAdapterContext } from "@homebase/adapter-sdk/testing";
import { agentSessionUsageSchema } from "@homebase/protocol";
import { ClaudeAdapter } from "../src/adapter.js";

describe.skipIf(process.env.HOMEBASE_TEST_DOGFOOD !== "1")("no-model Claude dogfood", () => {
  it("detects installed CLI and reads available history without fetching quota through inference", async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url)).replace(/[\\/]$/, ""),
      project = { id: "prj_dogfood", name: "Example", path: root, providersAvailable: ["claude"] };
    const adapter = new ClaudeAdapter();
    adapter.init(createTestAdapterContext({ projectPath: root, projectId: project.id }));
    try {
      expect((await adapter.detect()).version).toBe("2.1.268");
      expect(await adapter.getProviderUsage()).toBeNull();
      const history = await adapter.listSessions(project, { limit: 1 });
      if (history.items[0]) {
        const usage = await adapter.getSessionUsage(history.items[0].id);
        if (usage) {
          expect(agentSessionUsageSchema.safeParse(usage).success).toBe(true);
          expect(usage.partial).toBe(true);
          expect(usage.tokens.outputTokens).toBeNull();
          expect(usage.costUsd).toBeNull();
        }
      }
    } finally {
      await adapter.dispose();
    }
  }, 30000);
});
