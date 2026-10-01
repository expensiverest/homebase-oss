import { createTestAdapterContext } from "@homebase/adapter-sdk/testing";
import type { AgentSession } from "@homebase/protocol";
import { describe, expect, it } from "vitest";

import { createPublicId } from "@homebase/adapter-sdk";

import { OpenCodeAdapter } from "../src/adapter.js";
import {
  nativeAgentHidden,
  nativeAgentPlan,
  nativeAgentPrimary,
  nativeAgentSubagent,
  nativeFileDiffs,
  nativeForm,
  nativeModel,
  nativeSession,
  nativeUserMessage,
  nativeAssistantMessage,
  nativePermission,
} from "./fixtures.js";
import { createFakeFetch, errorResponse, jsonResponse, type FakeRoute } from "./helpers.js";

const PROJECT_PATH = "/home/example/projects/demo";
const SESSION = createPublicId("opencode", nativeSession.id);
const PROJECT_ID = "prj_1";

function baseRoutes(overrides: Record<string, () => Response | Promise<Response>> = {}): FakeRoute[] {
  const routes: FakeRoute[] = [
    { method: "GET", path: "/api/info", handler: () => jsonResponse({ version: "2.0.18", paths: {} }) },
    { method: "GET", path: "/api/model", handler: () => jsonResponse({ data: [nativeModel] }) },
    {
      method: "GET",
      path: "/api/agent",
      handler: () =>
        jsonResponse({ data: [nativeAgentPrimary, nativeAgentPlan, nativeAgentHidden, nativeAgentSubagent] }),
    },
    {
      method: "GET",
      path: "/api/session",
      handler: () => jsonResponse({ data: [nativeSession], cursor: { next: "provider-next", previous: null } }),
    },
    { method: "GET", path: `/api/session/${nativeSession.id}`, handler: () => jsonResponse({ data: nativeSession }) },
    { method: "POST", path: "/api/session", handler: () => jsonResponse({ data: nativeSession }) },
    { method: "DELETE", path: `/api/session/${nativeSession.id}`, handler: () => new Response(null, { status: 204 }) },
    {
      method: "GET",
      path: `/api/session/${nativeSession.id}/message`,
      handler: () =>
        jsonResponse({ data: [nativeAssistantMessage, nativeUserMessage], cursor: { next: null, previous: null } }),
    },
    {
      method: "POST",
      path: `/api/session/${nativeSession.id}/prompt`,
      handler: () => jsonResponse({ data: { id: "inbox_1" } }),
    },
    { method: "GET", path: "/api/session/active", handler: () => jsonResponse({ data: {} }) },
    {
      method: "POST",
      path: `/api/session/${nativeSession.id}/interrupt`,
      handler: () => jsonResponse({ interrupted: true }),
    },
    {
      method: "POST",
      path: `/api/session/${nativeSession.id}/model`,
      handler: () => new Response(null, { status: 204 }),
    },
    {
      method: "POST",
      path: `/api/session/${nativeSession.id}/agent`,
      handler: () => new Response(null, { status: 204 }),
    },
    { method: "GET", path: `/api/session/${nativeSession.id}/permission`, handler: () => jsonResponse({ data: [] }) },
    { method: "GET", path: `/api/session/${nativeSession.id}/form`, handler: () => jsonResponse({ data: [] }) },
    {
      method: "POST",
      path: `/api/session/${nativeSession.id}/permission/per_example1/reply`,
      handler: () => new Response(null, { status: 204 }),
    },
    {
      method: "POST",
      path: `/api/session/${nativeSession.id}/form/frm_example1/reply`,
      handler: () => new Response(null, { status: 204 }),
    },
    {
      method: "GET",
      path: `/api/session/${nativeSession.id}/diff`,
      handler: () => jsonResponse({ data: nativeFileDiffs }),
    },
  ];
  for (const [key, handler] of Object.entries(overrides)) {
    const [method, path] = key.split(" ");
    const index = routes.findIndex((route) => route.method === method && route.path === path);
    if (index >= 0) routes[index] = { method: method ?? "GET", path: path ?? "/", handler };
    else routes.push({ method: method ?? "GET", path: path ?? "/", handler });
  }
  return routes;
}

function createAdapter(routes: FakeRoute[] = baseRoutes()) {
  const { fetchFn, calls } = createFakeFetch(routes);
  const context = createTestAdapterContext({ projectPath: PROJECT_PATH, projectId: PROJECT_ID });
  const adapter = new OpenCodeAdapter({
    config: { baseUrl: "http://127.0.0.1:4096", requestTimeoutMs: 2_000, serverMode: "external" },
    fetchFn,
    startEventStream: false,
    spawnFn: () => {
      throw new Error("external-mode test adapter must never spawn OpenCode");
    },
    runFn: () => {
      throw new Error("external-mode test adapter must never run OpenCode");
    },
  });
  adapter.init(context);
  const project = { id: PROJECT_ID, name: "demo", path: PROJECT_PATH, providersAvailable: ["opencode"] };
  return { adapter, context, calls, project, fetchFn };
}

describe("detection", () => {
  it("reports a reachable, compatible server", async () => {
    const { adapter } = createAdapter();
    const detection = await adapter.detect();
    expect(detection).toMatchObject({ installed: true, authenticated: true, compatible: true, version: "2.0.18" });
  });

  it("reports authentication failures as installed-but-unauthenticated", async () => {
    const { adapter } = createAdapter(
      baseRoutes({ "GET /api/info": () => errorResponse(401, "UnauthorizedError", "nope") }),
    );
    const detection = await adapter.detect();
    expect(detection).toMatchObject({ installed: true, authenticated: false, compatible: true });
    expect(detection.warning).toContain("authentication");
  });

  it("reports unreachable servers without claiming installation", async () => {
    const { adapter } = createAdapter([]);
    const detection = await adapter.detect();
    expect(detection).toMatchObject({ installed: false, compatible: false });
  });
});

describe("catalogs", () => {
  it("retries the model catalog once when the server warms up", async () => {
    let calls = 0;
    const { adapter } = createAdapter(
      baseRoutes({
        "GET /api/model": () => {
          calls += 1;
          return calls === 1 ? jsonResponse({ data: [] }) : jsonResponse({ data: [nativeModel] });
        },
      }),
    );
    const models = await adapter.listModels({
      id: PROJECT_ID,
      name: "demo",
      path: PROJECT_PATH,
      providersAvailable: [],
    });
    expect(calls).toBe(2);
    expect(models[0]?.id).toBe("example-provider/example-model");
    expect(models[0]?.inputCapabilities).toEqual({ text: true, image: true, file: true });
  });

  it("filters hidden and subagent agents from modes", async () => {
    const { adapter } = createAdapter();
    const modes = await adapter.listModes({ id: PROJECT_ID, name: "demo", path: PROJECT_PATH, providersAvailable: [] });
    expect(modes.map((mode) => mode.id)).toEqual(["build", "plan"]);
  });

  it("warms the project catalog and retries an initially empty agent response", async () => {
    let probes = 0;
    const { adapter, calls, project } = createAdapter(
      baseRoutes({
        "GET /api/agent": () =>
          jsonResponse({ data: ++probes < 3 ? [] : [{ ...nativeAgentPrimary, mode: "all" }, nativeAgentPlan] }),
      }),
    );
    expect((await adapter.listModes(project)).map((mode) => mode.id)).toEqual(["build", "plan"]);
    expect(probes).toBe(3);
    expect(
      calls
        .filter((c) => c.url.pathname === "/api/agent")
        .every((c) => c.url.searchParams.get("location[directory]") === PROJECT_PATH),
    ).toBe(true);
    expect(calls.findIndex((c) => c.url.pathname === "/api/model")).toBeLessThan(
      calls.findIndex((c) => c.url.pathname === "/api/agent"),
    );
  });

  it("returns an honest empty catalog when only hidden or subagent modes are exposed", async () => {
    const { adapter, project } = createAdapter(
      baseRoutes({ "GET /api/agent": () => jsonResponse({ data: [nativeAgentHidden, nativeAgentSubagent] }) }),
    );
    expect(await adapter.listModes(project)).toEqual([]);
  });

  it("uses persisted cumulative session usage on reopen without adding message usage again", async () => {
    const current = {
      ...nativeSession,
      cost: 0.12,
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 20, write: 30 } },
    };
    const { adapter, calls } = createAdapter(
      baseRoutes({ [`GET /api/session/${nativeSession.id}`]: () => jsonResponse({ data: current }) }),
    );
    expect(await adapter.getSessionUsage(SESSION)).toMatchObject({
      provider: "opencode",
      sessionId: SESSION,
      costUsd: 0.12,
      tokens: { inputTokens: 60, outputTokens: 7, totalTokens: 67 },
    });
    expect(await adapter.getSessionUsage(SESSION)).toMatchObject({ tokens: { totalTokens: 67 } });
    expect(calls.some((c) => c.url.pathname.endsWith("/message"))).toBe(false);
    expect(await adapter.getProviderUsage()).toBeNull();
  });

  it("declares slashCommands and usage unsupported honestly", async () => {
    const { adapter } = createAdapter();
    const capabilities = await adapter.getCapabilities();
    expect(capabilities.queue).toBe(true);
    expect(capabilities.slashCommands).toBe(false);
    expect(capabilities.providerUsage).toBe(false);
    expect(capabilities.plans).toBe(false);
  });
});

describe("sessions", () => {
  it("lists root sessions for a project and filters child sessions", async () => {
    const withChild = { ...nativeSession, id: "ses_child", parentID: "ses_example123" };
    const { adapter, project } = createAdapter(
      baseRoutes({
        "GET /api/session": () =>
          jsonResponse({ data: [withChild, nativeSession], cursor: { next: null, previous: null } }),
      }),
    );
    const page = await adapter.listSessions(project, { limit: 50 });
    expect(page.items.map((session) => session.id)).toEqual([SESSION]);
    expect(page.nextCursor).toBeNull();
  });

  it("normalizes a provider next cursor on a short page", async () => {
    const { adapter, project } = createAdapter();
    const page = await adapter.listSessions(project, { limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("rejects sessions outside the configured project roots", async () => {
    const outside = { ...nativeSession, id: "ses_outside", location: { directory: "/elsewhere/private" } };
    const { adapter } = createAdapter(
      baseRoutes({ [`GET /api/session/${outside.id}`]: () => jsonResponse({ data: outside }) }),
    );
    await expect(adapter.getSession(createPublicId("opencode", outside.id))).rejects.toMatchObject({
      code: "session_not_found",
    });
  });

  it("creates sessions scoped to the project directory", async () => {
    const { adapter, calls, project } = createAdapter();
    const session = await adapter.createSession({ provider: "opencode", projectId: PROJECT_ID }, project);
    expect(session.id).toBe(SESSION);
    const createCall = calls.find((call) => call.method === "POST" && call.url.pathname === "/api/session");
    expect((createCall?.body as { location?: { directory?: string } })?.location?.directory).toBe(PROJECT_PATH);
  });

  it("maps message history with newest-first ordering and opaque cursors", async () => {
    const { adapter } = createAdapter();
    const page = await adapter.listMessages(SESSION, { limit: 50 });
    expect(page.items.map((message) => message.role)).toEqual(["assistant", "user"]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("prompt semantics", () => {
  it("sends plainly when idle and queues when active", async () => {
    const { adapter, calls } = createAdapter();
    await adapter.send(SESSION, { text: "hello" });
    const idlePrompt = calls.filter((call) => call.method === "POST" && call.url.pathname.endsWith("/prompt")).at(-1);
    expect((idlePrompt?.body as { delivery?: string }).delivery).toBeUndefined();

    const { adapter: activeAdapter, calls: activeCalls } = createAdapter(
      baseRoutes({
        "GET /api/session/active": () => jsonResponse({ data: { [nativeSession.id]: { type: "running" } } }),
      }),
    );
    await activeAdapter.send(SESSION, { text: "hello" });
    const activePrompt = activeCalls
      .filter((call) => call.method === "POST" && call.url.pathname.endsWith("/prompt"))
      .at(-1);
    expect((activePrompt?.body as { delivery?: string }).delivery).toBe("queue");
  });

  it("steers only active runs and queues explicitly", async () => {
    const { adapter: idleAdapter, calls: idleCalls } = createAdapter();
    await idleAdapter.steer(SESSION, { text: "steer" });
    const idleSteer = idleCalls
      .filter((call) => call.method === "POST" && call.url.pathname.endsWith("/prompt"))
      .at(-1);
    expect((idleSteer?.body as { delivery?: string }).delivery).toBeUndefined();

    const { adapter, calls } = createAdapter(
      baseRoutes({
        "GET /api/session/active": () => jsonResponse({ data: { [nativeSession.id]: { type: "running" } } }),
      }),
    );
    await adapter.steer(SESSION, { text: "steer" });
    const steerCall = calls.filter((call) => call.method === "POST" && call.url.pathname.endsWith("/prompt")).at(-1);
    expect((steerCall?.body as { delivery?: string }).delivery).toBe("steer");

    await adapter.queue(SESSION, { text: "queue me" });
    const queueCall = calls.filter((call) => call.method === "POST" && call.url.pathname.endsWith("/prompt")).at(-1);
    expect((queueCall?.body as { delivery?: string }).delivery).toBe("queue");
  });

  it("interrupts through the provider endpoint", async () => {
    const { adapter, calls } = createAdapter();
    await adapter.interrupt(SESSION);
    expect(calls.some((call) => call.method === "POST" && call.url.pathname.endsWith("/interrupt"))).toBe(true);
  });

  it("converts resolved attachments to provider data URLs", async () => {
    const bytes = new TextEncoder().encode("hello attachment");
    const { fetchFn, calls } = createFakeFetch(baseRoutes());
    const context = createTestAdapterContext({
      projectPath: PROJECT_PATH,
      projectId: PROJECT_ID,
      attachments: new Map([
        ["att_1", { id: "att_1", filename: "notes.txt", mimeType: "text/plain", size: bytes.byteLength, bytes }],
      ]),
    });
    const adapter = new OpenCodeAdapter({
      config: { baseUrl: "http://127.0.0.1:4096", requestTimeoutMs: 2_000, serverMode: "external" },
      fetchFn,
      startEventStream: false,
    });
    adapter.init(context);
    await adapter.send(SESSION, {
      text: "see attached",
      attachments: [{ id: "att_1", kind: "file", name: "notes.txt", mimeType: "text/plain" }],
    });
    const prompt = calls.filter((call) => call.method === "POST" && call.url.pathname.endsWith("/prompt")).at(-1);
    const files = (prompt?.body as { files?: Array<{ uri: string; name: string }> }).files;
    expect(files?.[0]?.name).toBe("notes.txt");
    expect(files?.[0]?.uri.startsWith("data:text/plain;base64,")).toBe(true);
  });
});

describe("approvals and questions", () => {
  it("reconciles pending approvals on session load and replies with decisions", async () => {
    const { adapter, context, calls } = createAdapter(
      baseRoutes({
        [`GET /api/session/${nativeSession.id}/permission`]: () => jsonResponse({ data: [nativePermission] }),
      }),
    );
    await adapter.getSession(SESSION);
    const requested = context.events.find((event) => event.type === "approval.requested");
    expect(requested?.type).toBe("approval.requested");

    await adapter.resolveApproval(nativePermission.id, { optionId: "allow_always" });
    const reply = calls.find(
      (call) => call.method === "POST" && call.url.pathname.endsWith(`/permission/${nativePermission.id}/reply`),
    );
    expect(reply?.body).toEqual({ decision: "always" });
  });

  it("reconciles pending forms and answers them", async () => {
    const { adapter, context, calls } = createAdapter(
      baseRoutes({ [`GET /api/session/${nativeSession.id}/form`]: () => jsonResponse({ data: [nativeForm] }) }),
    );
    await adapter.getSession(SESSION);
    expect(context.events.some((event) => event.type === "question.requested")).toBe(true);

    await adapter.answerQuestion(nativeForm.id, { answers: [{ questionId: "q0", selectedOptionIds: ["Blue"] }] });
    const reply = calls.find(
      (call) => call.method === "POST" && call.url.pathname.endsWith(`/form/${nativeForm.id}/reply`),
    );
    expect(reply?.body).toEqual({ answer: { q0: "Blue" } });
  });

  it("rejects unknown approval and question ids", async () => {
    const { adapter } = createAdapter();
    await expect(adapter.resolveApproval("per_missing", { optionId: "allow_once" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      adapter.answerQuestion("frm_missing", { answers: [{ questionId: "q0", text: "x" }] }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("model, mode, and diff operations", () => {
  it("switches models with composite refs", async () => {
    const { adapter, calls } = createAdapter();
    await adapter.setModel(SESSION, { modelId: "example-provider/example-model", thinkingLevel: "high" });
    const call = calls.find((entry) => entry.method === "POST" && entry.url.pathname.endsWith("/model"));
    expect(call?.body).toEqual({ model: { id: "example-model", providerID: "example-provider", variant: "high" } });
  });

  it("switches modes through the agent endpoint", async () => {
    const { adapter, calls } = createAdapter();
    await adapter.setMode(SESSION, { mode: "plan" });
    const call = calls.find((entry) => entry.method === "POST" && entry.url.pathname.endsWith("/agent"));
    expect(call?.body).toEqual({ agent: "plan" });
  });

  it("returns diffs with project-relative paths", async () => {
    const { adapter } = createAdapter();
    const diff = await adapter.getDiff(SESSION);
    expect(diff.files.map((file) => file.path)).toEqual(["README.md", "src/new.ts"]);
    expect(JSON.stringify(diff)).not.toContain("/home/example");
  });
});

describe("adapter identity", () => {
  it("exposes a provider-neutral surface only", async () => {
    const { adapter } = createAdapter();
    expect(adapter.id).toBe("opencode");
    expect(adapter.displayName).toBe("OpenCode");
    const session: AgentSession = await adapter.getSession(SESSION);
    expect(Object.keys(session).sort()).toEqual(
      [
        "createdAt",
        "id",
        "mode",
        "model",
        "projectId",
        "provider",
        "state",
        "thinkingLevel",
        "title",
        "updatedAt",
      ].sort(),
    );
  });
});
