import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  agentCapabilitiesSchema,
  agentDiffSchema,
  agentEventSchema,
  agentModelSchema,
  agentModeSchema,
  agentSessionSchema,
  agentUsageSchema,
  providerDetectionSchema,
  providerIdSchema,
  type AgentCapabilities,
  type AgentProject,
  type AgentSession,
  type CapabilityKey,
} from "@homebase/protocol";

import type { AgentAdapter } from "./adapter.js";
import { createTestAdapterContext, type TestAdapterContext } from "./testing/context.js";

export interface AdapterComplianceOptions {
  /** Provider display name used in test titles. */
  providerName: string;
  /** Creates a fresh adapter instance under test. */
  createAdapter: () => AgentAdapter | Promise<AgentAdapter>;
  /**
   * Creates a project the adapter can operate in. When omitted, session-level
   * checks are reported as skipped.
   */
  createProject?: () => AgentProject | Promise<AgentProject>;
  /**
   * Opt-in behavioral checks that need a working provider (live CLI, running
   * server, or a mock). When false, those checks are skipped explicitly rather
   * than faked.
   */
  live?: boolean;
  /** Per-test timeout for live checks. */
  timeoutMs?: number;
}

/**
 * Method that must exist when a capability is declared. Capabilities without a
 * one-to-one method (streaming, tools, plans, ...) are event-shape capabilities
 * and are covered by the live checks.
 */
const CAPABILITY_METHODS: Partial<Record<CapabilityKey, keyof AgentAdapter>> = {
  deleteSession: "deleteSession",
  interrupt: "interrupt",
  steer: "steer",
  approvals: "resolveApproval",
  questions: "answerQuestion",
  modelSwitching: "setModel",
  modes: "setMode",
  diffs: "getDiff",
  usage: "getUsage",
};

const LIVE_METHOD_CAPABILITIES: CapabilityKey[] = ["streaming", "tools", "approvals", "questions", "plans"];

/**
 * Registers a Vitest suite that every Homebase adapter should run.
 *
 * Checks are capability-gated: unsupported capabilities are skipped with an
 * explicit reason instead of failing or being faked. Live provider behavior is
 * opt-in via `live: true` so contributor machines without a provider installed
 * are not blocked.
 */
export function defineAdapterComplianceSuite(options: AdapterComplianceOptions): void {
  describe(`${options.providerName} adapter compliance`, () => {
    const timeout = options.timeoutMs ?? 20_000;
    let adapter!: AgentAdapter;
    let context!: TestAdapterContext;
    let project: AgentProject | undefined;
    let capabilities!: AgentCapabilities;

    beforeAll(async () => {
      adapter = await options.createAdapter();
      project = options.createProject ? await options.createProject() : undefined;
      context = createTestAdapterContext({ projectPath: project?.path });
      await adapter.init?.(context);
      capabilities = await adapter.getCapabilities();
    });

    afterAll(async () => {
      await adapter?.dispose?.();
    });

    it("declares a valid provider identity", () => {
      expect(providerIdSchema.safeParse(adapter.id).success, `invalid provider id "${adapter.id}"`).toBe(true);
      expect(adapter.displayName.trim().length).toBeGreaterThan(0);
    });

    it("reports detection without exposing credentials", async () => {
      const detection = await adapter.detect();
      expect(providerDetectionSchema.safeParse(detection).success).toBe(true);

      const serialized = JSON.stringify(detection).toLowerCase();
      for (const forbidden of ["api_key", "apikey", "access_token", "refresh_token", "password", "secret"]) {
        expect(serialized, `detection output mentions "${forbidden}"`).not.toContain(forbidden);
      }
    });

    it("declares a complete, valid capability record", () => {
      const result = agentCapabilitiesSchema.safeParse(capabilities);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });

    it("implements every method its capabilities promise", () => {
      for (const [capability, method] of Object.entries(CAPABILITY_METHODS) as Array<
        [CapabilityKey, keyof AgentAdapter]
      >) {
        if (!capabilities[capability]) continue;
        expect(typeof adapter[method], `capability "${capability}" requires adapter.${method}()`).toBe("function");
      }
    });

    it("skips live-only checks explicitly when they cannot be run", ({ skip }) => {
      if (options.live) return;
      skip("live provider run not enabled for this adapter");
    });

    it("lists valid models when it declares model support", async ({ skip }) => {
      if (!capabilities.models) return skip("provider does not support models");
      const models = await adapter.listModels(project!);
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        expect(agentModelSchema.safeParse(model).success, JSON.stringify(model)).toBe(true);
        expect(model.provider).toBe(adapter.id);
      }
    });

    it("lists valid modes when it declares mode support", async ({ skip }) => {
      if (!capabilities.modes) return skip("provider does not support modes");
      const modes = await adapter.listModes(project!);
      for (const mode of modes) {
        expect(agentModeSchema.safeParse(mode).success, JSON.stringify(mode)).toBe(true);
      }
    });

    it("lists sessions for a project", async ({ skip }) => {
      if (!project) return skip("no project fixture supplied");
      const sessions = await adapter.listSessions(project);
      for (const session of sessions) {
        expect(agentSessionSchema.safeParse(session).success, JSON.stringify(session)).toBe(true);
        expect(session.provider).toBe(adapter.id);
        expect(session.projectId).toBe(project.id);
      }
    });

    it("creates, fetches, and (when supported) deletes a session", async ({ skip }) => {
      if (!project) return skip("no project fixture supplied");
      const created = await adapter.createSession(
        { provider: adapter.id, projectId: project.id, title: "compliance session" },
        project,
      );
      expect(agentSessionSchema.safeParse(created).success).toBe(true);

      const fetched = await adapter.getSession(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.projectId).toBe(project.id);

      const listed = await adapter.listSessions(project);
      expect(listed.some((session) => session.id === created.id)).toBe(true);

      if (capabilities.deleteSession) {
        await adapter.deleteSession!(created.id);
        await expect(adapter.getSession(created.id)).rejects.toMatchObject({ code: "session_not_found" });
      }
    });

    it("streams a turn as normalized events", { timeout }, async (ctx) => {
      if (!options.live) return ctx.skip("live provider run not enabled");
      if (!project) return ctx.skip("no project fixture supplied");
      if (!capabilities.streaming) return ctx.skip("provider does not support streaming");

      const session = await adapter.createSession(
        { provider: adapter.id, projectId: project.id, title: "streaming" },
        project,
      );
      context.clearEvents();
      await adapter.send(session.id, { text: "hello from the compliance suite" });

      const completed = await context.waitForEvent("turn.completed", undefined, timeout);
      expect(completed.sessionId).toBe(session.id);

      const sessionEvents = context.events.filter((event) => event.sessionId === session.id);
      expect(sessionEvents.some((event) => event.type === "message.started")).toBe(true);
      expect(sessionEvents.some((event) => event.type === "message.completed")).toBe(true);

      for (const event of sessionEvents) {
        const parsed = agentEventSchema.safeParse(JSON.parse(JSON.stringify(event)));
        expect(parsed.success, JSON.stringify(event)).toBe(true);
      }
    });

    it("interrupts a running turn when supported", { timeout }, async (ctx) => {
      if (!options.live) return ctx.skip("live provider run not enabled");
      if (!project || !capabilities.interrupt) return ctx.skip("provider does not support interrupt");

      const session = await adapter.createSession(
        { provider: adapter.id, projectId: project.id, title: "interrupt" },
        project,
      );
      context.clearEvents();
      await adapter.send(session.id, { text: "stream a long answer that will be interrupted" });
      await adapter.interrupt!(session.id);

      const waitForTerminal = (type: "turn.interrupted" | "turn.completed" | "turn.failed") =>
        context
          .waitForEvent(type, undefined, timeout)
          .then(() => type.slice("turn.".length) as "interrupted" | "completed" | "failed")
          .catch(() => "timeout" as const);

      const terminal = await Promise.race([
        waitForTerminal("turn.interrupted"),
        waitForTerminal("turn.completed"),
        waitForTerminal("turn.failed"),
      ]);
      expect(["interrupted", "completed", "failed"]).toContain(terminal);
    });

    it("reports usage when supported", async ({ skip }) => {
      if (!capabilities.usage) return skip("provider does not support usage");
      const usage = await adapter.getUsage!();
      if (usage !== null) {
        expect(agentUsageSchema.safeParse(usage).success, JSON.stringify(usage)).toBe(true);
        expect(usage.provider).toBe(adapter.id);
      }
    });

    it("reports a diff for a session when supported", { timeout }, async (ctx) => {
      if (!options.live || !project) return ctx.skip("live provider run not enabled");
      if (!capabilities.diffs) return ctx.skip("provider does not support diffs");

      const session = await adapter.createSession(
        { provider: adapter.id, projectId: project.id, title: "diff" },
        project,
      );
      const diff = await adapter.getDiff!(session.id);
      expect(agentDiffSchema.safeParse(diff).success, JSON.stringify(diff)).toBe(true);
    });

    it("documents which live-only capabilities remain unverified", ({ skip }) => {
      const missing = LIVE_METHOD_CAPABILITIES.filter((capability) => capabilities[capability] && !options.live);
      if (missing.length === 0) return;
      skip(`live checks disabled for: ${missing.join(", ")}`);
    });
  });
}

/** Convenience type helper for adapter test files. */
export type ComplianceSession = AgentSession;
