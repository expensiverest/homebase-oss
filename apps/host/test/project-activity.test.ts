import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectActivity } from "../src/projects/activity.js";
import { ProjectRegistry, rootIdForPath } from "../src/projects/project-registry.js";
import { PathAllowlist } from "../src/paths.js";
import { createTestHost, fakeGitReader } from "./helpers/host-fixture.js";
import { createHostRuntime } from "../src/server.js";
import { projectOverviewSchema, type AgentSession } from "@homebase/protocol";

describe("project activity and configured folders", () => {
  it("persists monotonic activity, ignores invalid IDs/timestamps", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hb-activity-"));
    try {
      const store = await ProjectActivity.open(dir);
      const id = "prj_123456abcdef";
      store.advance(id, "2026-09-30T10:00:00Z");
      store.advance(id, "2026-09-29T10:00:00Z");
      store.advance("unregistered", "bad");
      await store.flush();
      const restored = await ProjectActivity.open(dir);
      expect(restored.get(id)).toBe("2026-09-30T10:00:00.000Z");
      expect(JSON.parse(await readFile(store.file, "utf8")).projects).toEqual({ [id]: restored.get(id) });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("groups each project under its most-specific root with stable IDs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hb-roots-"));
    try {
      const nested = path.join(dir, "Work");
      for (const repo of ["Alpha", "Work", "Work/App", "Clients/App"])
        await mkdir(path.join(dir, repo, ".git"), { recursive: true });
      const { allowlist } = await PathAllowlist.create([dir, nested]);
      const activity = await ProjectActivity.open(path.join(dir, "state"));
      const registry = new ProjectRegistry({
        roots: allowlist.roots,
        allowlist,
        git: fakeGitReader,
        activity,
        unavailableRoots: [path.join(dir, "Missing")],
      });
      await registry.discover();
      const summaries = registry.summaries([]);
      expect(new Set(summaries.map((p) => p.id)).size).toBe(4);
      expect(
        summaries
          .filter((p) => p.path.startsWith(nested))
          .every((p) => p.rootId === rootIdForPath(allowlist.roots[1]!)),
      ).toBe(true);
      expect(registry.listRoots().find((r) => r.name === "Missing")).toMatchObject({
        available: false,
        projectCount: 0,
      });
      const a = summaries.find((p) => p.name === "Alpha")!,
        app = summaries.find((p) => p.path === path.join(nested, "App"))!;
      expect(registry.projectsForRoot(rootIdForPath(allowlist.roots[1]!), [])).toHaveLength(2);
      activity.advance(a.id, "2026-09-30T10:00:00Z");
      activity.advance(app.id, "2026-09-30T11:00:00Z");
      expect(
        registry
          .summaries([])
          .slice(0, 2)
          .map((p) => p.id),
      ).toEqual([app.id, a.id]);
      activity.advance(a.id, "2026-09-30T11:00:00Z");
      expect(registry.summaries([])[0]?.id).toBe(a.id);
      await activity.flush();
      expect(() => registry.projectsForRoot(dir, [])).toThrow(/not found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("updates from creation, send and provider history while overview remains cheap", async () => {
    const host = await createTestHost();
    try {
      const project = host.runtime.projects.list()[0]!;
      const created = await host.runtime.sessions.create({ provider: "mock", projectId: project.id });
      const overview = projectOverviewSchema.parse(
        await (await host.runtime.app.request("/api/v1/projects/overview")).json(),
      );
      expect(overview.recent[0]).toMatchObject({ id: project.id, knownSessionCount: 1 });
      await host.runtime.sessions.send(created.id, { text: "fixture only" });
      const future: AgentSession = { ...created, updatedAt: "2090-01-01T00:00:00Z" };
      host.runtime.bus.publish({
        type: "session.updated",
        provider: "mock",
        projectId: project.id,
        sessionId: created.id,
        occurredAt: future.updatedAt,
        data: { session: future },
      });
      const rootProjects = host.runtime.projects.summaries(host.runtime.sessions.listKnown());
      expect(rootProjects[0]?.lastActivityAt).toBe("2090-01-01T00:00:00.000Z");
      expect(rootProjects[0]?.knownSessionCount).toBe(1);
    } finally {
      await host.cleanup();
    }
  });
  it("preserves Recent across a real runtime restart without treating file views as activity", async () => {
    const host = await createTestHost();
    const stateDir = path.join(host.rootDir, ".homebase-test-state");
    try {
      const project = host.runtime.projects.list()[0]!;
      expect(
        projectOverviewSchema.parse(await (await host.runtime.app.request("/api/v1/projects/overview")).json()).recent,
      ).toEqual([]);
      await host.runtime.sessions.create({ provider: "mock", projectId: project.id });
      const before = host.runtime.projects.summaries([]).find((p) => p.id === project.id)!.lastActivityAt;
      await host.runtime.app.request(`/api/v1/projects/${project.id}/files`);
      expect(host.runtime.projects.summaries([]).find((p) => p.id === project.id)?.lastActivityAt).toBe(before);
      await host.runtime.close();
      const restored = await createHostRuntime({
        config: host.runtime.config,
        registrations: [],
        git: fakeGitReader,
        stateDir,
      });
      try {
        expect(restored.projects.summaries([])[0]).toMatchObject({ id: project.id, lastActivityAt: before });
      } finally {
        await restored.close();
      }
    } finally {
      await host.cleanup();
    }
  });
});
