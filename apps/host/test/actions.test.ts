import { AdapterError, createPublicId, type AdapterContext, type AgentAdapter } from "@homebase/adapter-sdk";
import {
  defineCapabilities,
  type AgentApprovalRequest,
  type AgentProject,
  type AgentQuestionRequest,
  type AgentSession,
  type ApiErrorBody,
  type ProviderDetection,
} from "@homebase/protocol";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestHost,
  defaultMockRegistration,
  jsonBody,
  waitForEvent,
  type TestHost,
  type TestHostOptions,
} from "./helpers/host-fixture.js";

let hosts: TestHost[] = [];

afterEach(async () => {
  for (const host of hosts) await host.cleanup();
  hosts = [];
});

async function setup(options: TestHostOptions = {}): Promise<TestHost> {
  const host = await createTestHost(options);
  hosts.push(host);
  return host;
}

async function projects(host: TestHost): Promise<AgentProject[]> {
  const response = await host.runtime.app.request("/api/v1/projects");
  return (await jsonBody<{ projects: AgentProject[] }>(response)).projects;
}

async function createSession(host: TestHost, projectId: string): Promise<AgentSession> {
  const response = await host.runtime.app.request("/api/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mock", projectId }),
  });
  return (await jsonBody<{ session: AgentSession }>(response)).session;
}

async function fetchActions(
  host: TestHost,
  sessionId: string,
): Promise<{ approvals: AgentApprovalRequest[]; questions: AgentQuestionRequest[] }> {
  const response = await host.runtime.app.request(`/api/v1/sessions/${sessionId}/actions`);
  expect(response.status, await response.clone().text()).toBe(200);
  return jsonBody(response);
}

describe("pending actions read model", () => {
  it("survives a browser-style refetch and disappears on resolution", async () => {
    const host = await setup();
    const [project] = await projects(host);
    if (!project) return;
    const session = await createSession(host, project.id);

    const marker = host.runtime.bus.latestSequence;
    await host.runtime.app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "approve this command" }),
    });
    const requested = await waitForEvent(
      host.runtime,
      "approval.requested",
      (event) => event.sessionId === session.id,
      {
        since: marker,
      },
    );

    // Simulates a reload: rebuild the card from the Host, not from events.
    const beforeResolution = await fetchActions(host, session.id);
    expect(beforeResolution.approvals).toHaveLength(1);
    expect(beforeResolution.approvals[0]?.id).toBe(requested.data.approval.id);
    expect(beforeResolution.approvals[0]?.options.length).toBeGreaterThan(0);

    const resolved = await host.runtime.app.request(`/api/v1/approvals/${requested.data.approval.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optionId: "allow_once" }),
    });
    expect(resolved.status).toBe(202);

    const after = await fetchActions(host, session.id);
    expect(after.approvals).toHaveLength(0);
    await waitForEvent(host.runtime, "turn.completed", (event) => event.sessionId === session.id, { since: marker });
    expect((await fetchActions(host, session.id)).approvals).toHaveLength(0);
  });

  it("returns pending questions and clears them once answered", async () => {
    const host = await setup();
    const [project] = await projects(host);
    if (!project) return;
    const session = await createSession(host, project.id);

    const marker = host.runtime.bus.latestSequence;
    await host.runtime.app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "ask me something" }),
    });
    const requested = await waitForEvent(
      host.runtime,
      "question.requested",
      (event) => event.sessionId === session.id,
      {
        since: marker,
      },
    );

    const before = await fetchActions(host, session.id);
    expect(before.questions).toHaveLength(1);
    expect(before.questions[0]?.questions.length).toBeGreaterThan(0);

    await host.runtime.app.request(`/api/v1/questions/${requested.data.question.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: "q0", selectedOptionIds: ["first"] }] }),
    });
    expect((await fetchActions(host, session.id)).questions).toHaveLength(0);
  });

  it("drops stale actions when the run terminates", async () => {
    const host = await setup();
    const [project] = await projects(host);
    if (!project) return;
    const session = await createSession(host, project.id);

    const marker = host.runtime.bus.latestSequence;
    await host.runtime.app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "approve this command" }),
    });
    await waitForEvent(host.runtime, "approval.requested", (event) => event.sessionId === session.id, {
      since: marker,
    });
    expect((await fetchActions(host, session.id)).approvals).toHaveLength(1);

    const resolutionMarker = host.runtime.bus.latestSequence;
    await host.runtime.app.request(`/api/v1/sessions/${session.id}/interrupt`, { method: "POST" });
    await waitForEvent(host.runtime, "approval.resolved", (event) => event.sessionId === session.id, {
      since: resolutionMarker,
    });
    await waitForEvent(host.runtime, "turn.interrupted", (event) => event.sessionId === session.id, {
      since: resolutionMarker,
    });
    expect((await fetchActions(host, session.id)).approvals).toHaveLength(0);
  });

  it("returns 404 for unknown sessions and keeps sessions isolated", async () => {
    const host = await setup();
    const [project] = await projects(host);
    if (!project) return;
    const first = await createSession(host, project.id);
    const second = await createSession(host, project.id);

    const marker = host.runtime.bus.latestSequence;
    await host.runtime.app.request(`/api/v1/sessions/${first.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "approve this command" }),
    });
    await waitForEvent(host.runtime, "approval.requested", (event) => event.sessionId === first.id, { since: marker });

    expect((await fetchActions(host, first.id)).approvals).toHaveLength(1);
    expect((await fetchActions(host, second.id)).approvals).toHaveLength(0);

    const missing = await host.runtime.app.request("/api/v1/sessions/ses_missing/actions");
    expect(missing.status).toBe(404);
    expect((await jsonBody<ApiErrorBody>(missing)).error.code).toBe("session_not_found");
  });
});

describe("provider refresh", () => {
  it("re-runs detection and returns the refreshed provider list", async () => {
    let available = false;
    const flaky: AgentAdapter = {
      id: "flaky",
      displayName: "Flaky",
      async detect(): Promise<ProviderDetection> {
        return available
          ? { installed: true, authenticated: true, compatible: true, version: "1.0.0" }
          : { installed: false, authenticated: null, compatible: false, warning: "not running" };
      },
      async getCapabilities() {
        return defineCapabilities({});
      },
      async listModels(_project: AgentProject) {
        return [];
      },
      async listModes(_project: AgentProject) {
        return [];
      },
      async listSessions() {
        return { items: [], nextCursor: null, previousCursor: null };
      },
      async getSession(): Promise<AgentSession> {
        throw new AdapterError("session_not_found", "none");
      },
      async createSession(_input, _project): Promise<AgentSession> {
        throw new AdapterError("provider_error", "unavailable");
      },
      async listMessages() {
        return { items: [], nextCursor: null, previousCursor: null };
      },
      async send(): Promise<void> {
        throw new AdapterError("provider_error", "unavailable");
      },
      async getSessionUsage() {
        return null;
      },
      async getProviderUsage() {
        return null;
      },
      init(_context: AdapterContext): void {
        // no-op
      },
    };

    const host = await setup({
      registrations: [defaultMockRegistration(), { id: "flaky", displayName: "Flaky", create: () => flaky }],
    });

    const first = await host.runtime.app.request("/api/v1/providers");
    const initial = (await jsonBody<{ providers: Array<{ id: string; installed: boolean }> }>(first)).providers.find(
      (provider) => provider.id === "flaky",
    );
    expect(initial?.installed).toBe(false);

    available = true;
    const refresh = await host.runtime.app.request("/api/v1/providers/refresh", { method: "POST" });
    expect(refresh.status).toBe(200);
    const refreshed = await jsonBody<{ providers: Array<{ id: string; installed: boolean }> }>(refresh);
    expect(refreshed.providers.find((provider) => provider.id === "flaky")?.installed).toBe(true);

    const events = host.runtime.bus
      .getAfter(0)
      .filter((event) => event.type === "provider.updated" || event.type === "provider.connected");
    expect(events.some((event) => event.provider === "flaky")).toBe(true);
  });

  it("reports unknown providers scoped ids correctly", async () => {
    const host = await setup();
    const response = await host.runtime.app.request(`/api/v1/sessions/${createPublicId("ghost", "abc")}`);
    expect(response.status).toBe(404);
  });
});
