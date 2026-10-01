import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { createTestAdapterContext } from "@homebase/adapter-sdk/testing";
import { agentSessionUsageSchema } from "@homebase/protocol";
import { OpenCodeAdapter } from "../src/adapter.js";

/** Explicit no-model native API validation. Never joins the paid live suite. */
describe.skipIf(process.env.HOMEBASE_TEST_DOGFOOD !== "1")("no-model OpenCode dogfood", () => {
  it("discovers Build/Plan, persists selected agent, and reads reopened native session totals", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hb-opencode-no-model-"));
    await mkdir(path.join(dir, ".git"));
    const project = { id: "prj_dogfood", name: "Example", path: dir, providersAvailable: ["opencode"] };
    const context = createTestAdapterContext({ projectPath: dir, projectId: project.id });
    const adapter = new OpenCodeAdapter({ config: { serverMode: "managed" }, startEventStream: false });
    adapter.init(context);
    let sessionId: string | null = null;
    try {
      const detection = await adapter.detect();
      expect(detection.installed).toBe(true);
      expect(detection.version).toBe("2.0.18");
      const modes = await adapter.listModes(project);
      expect(modes.map((m) => m.id)).toEqual(expect.arrayContaining(["build", "plan"]));
      const created = await adapter.createSession(
        { provider: "opencode", projectId: project.id, title: "Homebase no-model fixture" },
        project,
      );
      sessionId = created.id;
      await adapter.setMode(sessionId, { mode: "plan" });
      expect((await adapter.getSession(sessionId)).mode).toBe("plan");
      const usage = await adapter.getSessionUsage(sessionId);
      expect(agentSessionUsageSchema.safeParse(usage).success).toBe(true);
      expect(usage?.tokens.totalTokens).toBe(0);
      expect(await adapter.getProviderUsage()).toBeNull();
      expect(await adapter.getSessionUsage(sessionId)).toEqual(usage);
    } finally {
      if (sessionId) await adapter.deleteSession(sessionId).catch(() => undefined);
      await adapter.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
});
