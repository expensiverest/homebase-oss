import type {
  AgentDiff,
  AgentProvider,
  AgentProject,
  AgentSession,
  AgentUsage,
  ApiErrorBody,
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
  for (const host of hosts) {
    await host.cleanup();
  }
  hosts = [];
});

async function setup(options: TestHostOptions = {}): Promise<TestHost> {
  const host = await createTestHost(options);
  hosts.push(host);
  return host;
}

async function getProjects(host: TestHost): Promise<AgentProject[]> {
  const response = await host.runtime.app.request("/api/v1/projects");
  expect(response.status).toBe(200);
  return (await jsonBody<{ projects: AgentProject[] }>(response)).projects;
}

async function createSession(
  host: TestHost,
  projectId: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return host.runtime.app.request("/api/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mock", projectId, title: "API session", ...extra }),
  });
}

describe("health and diagnostics", () => {
  it("reports status without leaking configuration", async () => {
    const host = await setup();
    const response = await host.runtime.app.request("/api/v1/health");
    expect(response.status).toBe(200);

    const body = await jsonBody<Record<string, unknown>>(response);
    expect(body.status).toBe("ok");
    expect(typeof body.latestSequence).toBe("number");
    expect(JSON.stringify(body)).not.toContain("devToken");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("providers", () => {
  it("lists registered providers with capabilities", async () => {
    const host = await setup();
    const response = await host.runtime.app.request("/api/v1/providers");
    expect(response.status).toBe(200);

    const { providers } = await jsonBody<{ providers: AgentProvider[] }>(response);
    const mock = providers.find((provider) => provider.id === "mock");
    expect(mock?.installed).toBe(true);
    expect(mock?.capabilities.approvals).toBe(true);
    expect(mock?.capabilities.slashCommands).toBe(false);
  });

  it("returns usage for providers that support it", async () => {
    const host = await setup();
    const response = await host.runtime.app.request("/api/v1/providers/mock/usage");
    expect(response.status).toBe(200);
    const { usage } = await jsonBody<{ usage: AgentUsage | null }>(response);
    expect(usage?.provider).toBe("mock");
  });

  it("rejects usage when the provider does not support it", async () => {
    const host = await setup({ registrations: [defaultMockRegistration({ capabilities: { usage: false } })] });
    const response = await host.runtime.app.request("/api/v1/providers/mock/usage");
    expect(response.status).toBe(409);

    const body = await jsonBody<ApiErrorBody>(response);
    expect(body.error.code).toBe("unsupported_capability");
  });

  it("returns stable errors for unknown providers", async () => {
    const host = await setup();
    const response = await host.runtime.app.request("/api/v1/providers/unknown");
    expect(response.status).toBe(404);
    expect((await jsonBody<ApiErrorBody>(response)).error.code).toBe("provider_not_found");
  });
});

describe("projects", () => {
  it("lists discovered projects with available providers", async () => {
    const host = await setup();
    const projects = await getProjects(host);
    expect(projects.map((project) => project.name).sort()).toEqual(["deep-repo", "repo-alpha", "repo-beta"]);
    for (const project of projects) {
      expect(project.providersAvailable).toEqual(["mock"]);
      expect(project.path.startsWith(host.rootDir)).toBe(true);
    }
  });

  it("returns a single project and its sessions", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    expect(project).toBeDefined();
    if (!project) return;

    const detail = await host.runtime.app.request(`/api/v1/projects/${project.id}`);
    expect(detail.status).toBe(200);

    const sessions = await host.runtime.app.request(`/api/v1/projects/${project.id}/sessions`);
    expect(sessions.status).toBe(200);
    expect((await jsonBody<{ sessions: AgentSession[] }>(sessions)).sessions).toEqual([]);
  });

  it("returns stable errors for unknown projects", async () => {
    const host = await setup();
    const response = await host.runtime.app.request("/api/v1/projects/prj_missing");
    expect(response.status).toBe(404);
    expect((await jsonBody<ApiErrorBody>(response)).error.code).toBe("project_not_found");
  });
});

describe("sessions", () => {
  it("creates, fetches, lists, and deletes a session", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    expect(project).toBeDefined();
    if (!project) return;

    const created = await createSession(host, project.id);
    expect(created.status).toBe(201);
    const { session } = await jsonBody<{ session: AgentSession }>(created);
    expect(session.projectId).toBe(project.id);
    expect(session.state).toBe("idle");

    const fetched = await host.runtime.app.request(`/api/v1/sessions/${session.id}`);
    expect(fetched.status).toBe(200);
    expect((await jsonBody<{ session: AgentSession }>(fetched)).session.id).toBe(session.id);

    const listed = await host.runtime.app.request(`/api/v1/projects/${project.id}/sessions`);
    expect((await jsonBody<{ sessions: AgentSession[] }>(listed)).sessions.map((entry) => entry.id)).toContain(
      session.id,
    );

    const deleted = await host.runtime.app.request(`/api/v1/sessions/${session.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);

    const missing = await host.runtime.app.request(`/api/v1/sessions/${session.id}`);
    expect(missing.status).toBe(404);
    expect((await jsonBody<ApiErrorBody>(missing)).error.code).toBe("session_not_found");
  });

  it("cannot be told to run in an arbitrary directory", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    expect(project).toBeDefined();
    if (!project) return;

    const response = await createSession(host, project.id, { path: "C:\\Users\\someone\\secrets" });
    expect(response.status).toBe(400);

    const body = await jsonBody<ApiErrorBody>(response);
    expect(body.error.code).toBe("invalid_request");
    expect(JSON.stringify(body.error.details)).toContain("path");
  });

  it("rejects unknown projects at creation time", async () => {
    const host = await setup();
    const response = await createSession(host, "prj_missing");
    expect(response.status).toBe(404);
    expect((await jsonBody<ApiErrorBody>(response)).error.code).toBe("project_not_found");
  });

  it("streams a turn and settles back to idle", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    const created = await createSession(host, project.id);
    const { session } = await jsonBody<{ session: AgentSession }>(created);

    const marker = host.runtime.bus.latestSequence;
    const sent = await host.runtime.app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello from the API test" }),
    });
    expect(sent.status).toBe(202);

    await waitForEvent(host.runtime, "turn.completed", (event) => event.sessionId === session.id, { since: marker });

    const fetched = await host.runtime.app.request(`/api/v1/sessions/${session.id}`);
    expect((await jsonBody<{ session: AgentSession }>(fetched)).session.state).toBe("idle");
  });

  it("routes approvals from the browser back to the provider", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    const created = await createSession(host, project.id);
    const { session } = await jsonBody<{ session: AgentSession }>(created);

    const promptMarker = host.runtime.bus.latestSequence;
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
        since: promptMarker,
      },
    );

    const replyMarker = host.runtime.bus.latestSequence;
    const resolved = await host.runtime.app.request(`/api/v1/approvals/${requested.data.approval.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optionId: "allow" }),
    });
    expect(resolved.status).toBe(202);

    await waitForEvent(host.runtime, "approval.resolved", () => true, { since: replyMarker });
    await waitForEvent(host.runtime, "turn.completed", (event) => event.sessionId === session.id, {
      since: replyMarker,
    });
  });

  it("routes questions from the browser back to the provider", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    const created = await createSession(host, project.id);
    const { session } = await jsonBody<{ session: AgentSession }>(created);

    const promptMarker = host.runtime.bus.latestSequence;
    await host.runtime.app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "ask me a question" }),
    });

    const requested = await waitForEvent(
      host.runtime,
      "question.requested",
      (event) => event.sessionId === session.id,
      {
        since: promptMarker,
      },
    );

    const replyMarker = host.runtime.bus.latestSequence;
    const resolved = await host.runtime.app.request(`/api/v1/questions/${requested.data.question.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: "q0", selectedOptionIds: ["first"] }] }),
    });
    expect(resolved.status).toBe(202);
    await waitForEvent(host.runtime, "question.resolved", () => true, { since: replyMarker });
  });

  it("switches model and mode", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    const created = await createSession(host, project.id);
    const { session } = await jsonBody<{ session: AgentSession }>(created);

    const model = await host.runtime.app.request(`/api/v1/sessions/${session.id}/model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: "mock-beta" }),
    });
    expect(model.status).toBe(202);

    const mode = await host.runtime.app.request(`/api/v1/sessions/${session.id}/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "plan" }),
    });
    expect(mode.status).toBe(202);

    const fetched = await host.runtime.app.request(`/api/v1/sessions/${session.id}`);
    const updated = (await jsonBody<{ session: AgentSession }>(fetched)).session;
    expect(updated.model?.modelId).toBe("mock-beta");
    expect(updated.mode).toBe("plan");
  });

  it("returns diffs", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    const created = await createSession(host, project.id);
    const { session } = await jsonBody<{ session: AgentSession }>(created);

    const response = await host.runtime.app.request(`/api/v1/sessions/${session.id}/diff`);
    expect(response.status).toBe(200);
    const { diff } = await jsonBody<{ diff: AgentDiff }>(response);
    expect(diff.files.length).toBeGreaterThan(0);
  });

  it("returns stable errors for unknown sessions and routes", async () => {
    const host = await setup();

    const missing = await host.runtime.app.request("/api/v1/sessions/ses_missing");
    expect(missing.status).toBe(404);
    expect((await jsonBody<ApiErrorBody>(missing)).error.code).toBe("session_not_found");

    const unknownRoute = await host.runtime.app.request("/api/v1/definitely-not-a-route");
    expect(unknownRoute.status).toBe(404);
    expect((await jsonBody<ApiErrorBody>(unknownRoute)).error.code).toBe("not_found");
  });
});
