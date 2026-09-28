import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ClaudeAdapter } from "@homebase/adapter-claude";
import type { AgentProject, AgentSession } from "@homebase/protocol";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestHost,
  defaultMockRegistration,
  jsonBody,
  waitForEvent,
  type TestHost,
} from "./helpers/host-fixture.js";

const fakeCli = fileURLToPath(
  new URL("../../../packages/adapter-claude/test/fixtures/fake-claude.mjs", import.meta.url),
);

let hosts: TestHost[] = [];
let configDirs: string[] = [];

afterEach(async () => {
  for (const host of hosts) await host.cleanup();
  hosts = [];
  for (const dir of configDirs) rmSync(dir, { recursive: true, force: true });
  configDirs = [];
});

async function setup(): Promise<TestHost> {
  const configDir = mkdtempSync(path.join(tmpdir(), "hb-host-claude-"));
  configDirs.push(configDir);
  const host = await createTestHost({
    registrations: [
      defaultMockRegistration(),
      {
        id: "claude",
        displayName: "Claude Code",
        create: (config) =>
          new ClaudeAdapter({
            config: {
              ...config,
              executable: process.execPath,
              configDir,
              idleTimeoutMs: 60_000,
              startupTimeoutMs: 20_000,
              approvalTimeoutMs: 30_000,
            },
            launchPrefix: [fakeCli],
            extraEnv: { CLAUDE_CONFIG_DIR: configDir },
          }),
      },
    ],
  });
  hosts.push(host);
  return host;
}

async function projects(host: TestHost): Promise<AgentProject[]> {
  const response = await host.runtime.app.request("/api/v1/projects");
  return (await jsonBody<{ projects: AgentProject[] }>(response)).projects;
}

async function createSession(
  host: TestHost,
  provider: string,
  projectId: string,
  title: string,
): Promise<AgentSession> {
  const response = await host.runtime.app.request("/api/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, projectId, title }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await jsonBody<{ session: AgentSession }>(response)).session;
}

describe("OpenCode + Claude coexistence through the Host", () => {
  it("lists both providers' sessions in one project with distinct scoped ids", async () => {
    const host = await setup();
    const [project] = await projects(host);
    if (!project) return;

    const mockSession = await createSession(host, "mock", project.id, "mock session");
    const claudeSession = await createSession(host, "claude", project.id, "claude session");

    expect(mockSession.id.startsWith("hb1~mock~")).toBe(true);
    expect(claudeSession.id.startsWith("hb1~claude~")).toBe(true);
    expect(mockSession.id).not.toBe(claudeSession.id);

    const seen: AgentSession[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
      const url = `/api/v1/projects/${project.id}/sessions?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await host.runtime.app.request(url);
      expect(response.status).toBe(200);
      const page = await jsonBody<{ sessions: AgentSession[]; nextCursor: string | null }>(response);
      expect(page.sessions.length).toBeLessThanOrEqual(1);
      seen.push(...page.sessions);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen.map((session) => session.provider).sort()).toEqual(["claude", "mock"]);
  });

  it("streams a Claude turn without touching the sibling provider", async () => {
    const host = await setup();
    const [project] = await projects(host);
    if (!project) return;

    const mockSession = await createSession(host, "mock", project.id, "mock session");
    const claudeSession = await createSession(host, "claude", project.id, "claude session");

    const marker = host.runtime.bus.latestSequence;
    const send = await host.runtime.app.request(`/api/v1/sessions/${claudeSession.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello team" }),
    });
    expect(send.status).toBe(202);

    await waitForEvent(host.runtime, "turn.completed", (event) => event.sessionId === claudeSession.id, {
      since: marker,
    });

    const history = await host.runtime.app.request(`/api/v1/sessions/${claudeSession.id}/messages`);
    const historyBody = await jsonBody<{
      messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>;
    }>(history);
    expect(historyBody.messages.length).toBeGreaterThan(0);
    expect(JSON.stringify(historyBody)).toContain("fake reply to: hello team");

    const mockAfter = await host.runtime.app.request(`/api/v1/sessions/${mockSession.id}`);
    expect((await jsonBody<{ session: AgentSession }>(mockAfter)).session.state).toBe("idle");

    // Interrupt routing stays provider-scoped too.
    const interrupt = await host.runtime.app.request(`/api/v1/sessions/${claudeSession.id}/interrupt`, {
      method: "POST",
    });
    expect(interrupt.status).toBe(202);
  });
});
