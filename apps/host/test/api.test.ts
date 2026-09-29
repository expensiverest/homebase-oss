import { OpenCodeAdapter } from "@homebase/adapter-opencode";
import type {
  AgentDiff,
  AgentProvider,
  AgentProject,
  AgentSession,
  AgentUsage,
  ApiErrorBody,
} from "@homebase/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultRegistrations } from "../src/server.js";
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
      body: JSON.stringify({ optionId: "allow_once" }),
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

describe("message history and queue", () => {
  it("returns paged message history after a turn", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    const created = await createSession(host, project.id);
    const { session } = await jsonBody<{ session: AgentSession }>(created);
    const marker = host.runtime.bus.latestSequence;
    await host.runtime.app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "history please" }),
    });
    await waitForEvent(host.runtime, "turn.completed", (event) => event.sessionId === session.id, { since: marker });

    const response = await host.runtime.app.request(`/api/v1/sessions/${session.id}/messages?limit=10`);
    expect(response.status).toBe(200);
    const body = await jsonBody<{
      messages: Array<{ role: string }>;
      nextCursor: string | null;
      previousCursor: string | null;
    }>(response);
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages.map((message) => message.role)).toContain("user");
    expect(body.nextCursor).toBeNull();
  });

  it("rejects history for unknown sessions and invalid limits", async () => {
    const host = await setup();
    const missing = await host.runtime.app.request("/api/v1/sessions/ses_missing/messages");
    expect(missing.status).toBe(404);

    const badLimit = await host.runtime.app.request("/api/v1/sessions/ses_missing/messages?limit=nope");
    expect(badLimit.status).toBe(400);
    expect((await jsonBody<ApiErrorBody>(badLimit)).error.code).toBe("invalid_request");
  });

  it("accepts queued messages", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;
    const created = await createSession(host, project.id);
    const { session } = await jsonBody<{ session: AgentSession }>(created);

    const marker = host.runtime.bus.latestSequence;
    const response = await host.runtime.app.request(`/api/v1/sessions/${session.id}/queue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "queued work" }),
    });
    expect(response.status).toBe(202);
    await waitForEvent(host.runtime, "turn.completed", (event) => event.sessionId === session.id, { since: marker });
  });
});

describe("provider catalogs", () => {
  it("exposes models and modes through project/provider routes", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    const modelsResponse = await host.runtime.app.request(`/api/v1/projects/${project.id}/providers/mock/models`);
    expect(modelsResponse.status).toBe(200);
    const models = (await jsonBody<{ models: Array<{ id: string; inputCapabilities?: unknown }> }>(modelsResponse))
      .models;
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]?.inputCapabilities).toBeDefined();

    const modesResponse = await host.runtime.app.request(`/api/v1/projects/${project.id}/providers/mock/modes`);
    expect(modesResponse.status).toBe(200);
    expect((await jsonBody<{ modes: Array<{ id: string }> }>(modesResponse)).modes.length).toBeGreaterThan(0);
  });

  it("rejects unknown providers, unknown projects, and unsupported capabilities", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    const unknownProvider = await host.runtime.app.request(`/api/v1/projects/${project.id}/providers/nope/models`);
    expect(unknownProvider.status).toBe(404);
    expect((await jsonBody<ApiErrorBody>(unknownProvider)).error.code).toBe("provider_not_found");

    const unknownProject = await host.runtime.app.request("/api/v1/projects/prj_missing/providers/mock/models");
    expect(unknownProject.status).toBe(404);

    const limited = await setup({ registrations: [defaultMockRegistration({ capabilities: { models: false } })] });
    const [limitedProject] = await getProjects(limited);
    if (!limitedProject) return;
    const unsupported = await limited.runtime.app.request(
      `/api/v1/projects/${limitedProject.id}/providers/mock/models`,
    );
    expect(unsupported.status).toBe(409);
    expect((await jsonBody<ApiErrorBody>(unsupported)).error.code).toBe("unsupported_capability");
  });
});

describe("attachments", () => {
  async function upload(host: TestHost, filename: string, mimeType: string, bytes: Uint8Array): Promise<Response> {
    const form = new FormData();
    form.append("file", new File([bytes], filename, { type: mimeType }));
    return host.runtime.app.request("/api/v1/attachments", { method: "POST", body: form });
  }

  it("uploads attachments, returns refs, and serves the bytes back", async () => {
    const host = await setup();
    const response = await upload(host, "notes.txt", "text/plain", new TextEncoder().encode("hello attachment"));
    expect(response.status).toBe(201);
    const { attachments } = await jsonBody<{
      attachments: Array<{ id: string; kind: string; name: string; mimeType: string }>;
    }>(response);
    expect(attachments[0]).toMatchObject({ kind: "file", name: "notes.txt", mimeType: "text/plain" });

    const fetched = await host.runtime.app.request(`/api/v1/attachments/${attachments[0]?.id}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe("hello attachment");
    expect(fetched.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unsupported content and unknown ids", async () => {
    const host = await setup();
    const rejected = await upload(host, "app.exe", "application/octet-stream", new Uint8Array([1, 2, 3]));
    expect(rejected.status).toBe(400);
    expect((await jsonBody<ApiErrorBody>(rejected)).error.code).toBe("invalid_attachment");

    const missing = await host.runtime.app.request("/api/v1/attachments/att_missing");
    expect(missing.status).toBe(400);
    expect((await jsonBody<ApiErrorBody>(missing)).error.code).toBe("invalid_attachment");

    const empty = new FormData();
    const noFiles = await host.runtime.app.request("/api/v1/attachments", { method: "POST", body: empty });
    expect(noFiles.status).toBe(400);
  });

  it("lets sessions send attachment references that resolve host-side", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    const uploadResponse = await upload(host, "diagram.txt", "text/plain", new TextEncoder().encode("diagram"));
    const { attachments } = await jsonBody<{
      attachments: Array<{ id: string; kind: "file" | "image"; name: string; mimeType: string }>;
    }>(uploadResponse);

    const created = await createSession(host, project.id);
    const { session } = await jsonBody<{ session: AgentSession }>(created);
    const marker = host.runtime.bus.latestSequence;
    const sendResponse = await host.runtime.app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "see attached", attachments }),
    });
    expect(sendResponse.status).toBe(202);
    await waitForEvent(host.runtime, "turn.completed", (event) => event.sessionId === session.id, { since: marker });

    const history = await host.runtime.app.request(`/api/v1/sessions/${session.id}/messages?limit=10`);
    const messages = (
      await jsonBody<{ messages: Array<{ role: string; parts: Array<{ type: string; attachmentId?: string }> }> }>(
        history,
      )
    ).messages;
    const user = messages.find((message) => message.role === "user");
    expect(user?.parts.some((part) => part.type === "file" && part.attachmentId === attachments[0]?.id)).toBe(true);
  });
});

describe("session pagination", () => {
  it("pages merged sessions with opaque cursors and rejects bad cursors", async () => {
    const host = await setup();
    const [project] = await getProjects(host);
    if (!project) return;

    for (const title of ["one", "two", "three"]) {
      await createSession(host, project.id, { title });
    }

    const first = await host.runtime.app.request(`/api/v1/projects/${project.id}/sessions?limit=2`);
    expect(first.status).toBe(200);
    const firstPage = await jsonBody<{ sessions: AgentSession[]; nextCursor: string | null }>(first);
    expect(firstPage.sessions).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTypeOf("string");

    const second = await host.runtime.app.request(
      `/api/v1/projects/${project.id}/sessions?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
    );
    const secondPage = await jsonBody<{ sessions: AgentSession[] }>(second);
    expect(secondPage.sessions).toHaveLength(1);
    const firstIds = new Set(firstPage.sessions.map((session) => session.id));
    expect(secondPage.sessions.every((session) => !firstIds.has(session.id))).toBe(true);

    const bad = await host.runtime.app.request(`/api/v1/projects/${project.id}/sessions?cursor=not-a-cursor`);
    expect(bad.status).toBe(400);
    expect((await jsonBody<ApiErrorBody>(bad)).error.code).toBe("invalid_request");
  });
});

describe("default registrations", () => {
  it("includes the OpenCode, Claude, and Grok reference providers", () => {
    const ids = createDefaultRegistrations().map((registration) => registration.id);
    expect(ids).toContain("mock");
    expect(ids).toContain("opencode");
    expect(ids).toContain("claude");
    expect(ids).toContain("grok");
  });

  it("starts and reports a useful status when OpenCode is unreachable", async () => {
    const host = await setup({
      registrations: [
        {
          id: "opencode",
          displayName: "OpenCode",
          create: (config) =>
            new OpenCodeAdapter({
              // External mode keeps this deterministic: no CLI detection or
              // managed-server spawn depends on the contributor's machine.
              config: { ...config, serverMode: "external", baseUrl: "http://127.0.0.1:9", requestTimeoutMs: 500 },
              startEventStream: false,
            }),
        },
      ],
    });

    const health = await host.runtime.app.request("/api/v1/health");
    expect(health.status).toBe(200);

    const providers = (
      await jsonBody<{ providers: AgentProvider[] }>(await host.runtime.app.request("/api/v1/providers"))
    ).providers;
    const opencode = providers.find((provider) => provider.id === "opencode");
    expect(opencode?.installed).toBe(false);
    expect(opencode?.warning).toContain("http://127.0.0.1:9");
  });
});
