import type { AgentProject, AgentSession, ApiErrorBody } from "@homebase/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { FixedAdapter } from "./helpers/fixed-adapter.js";
import { createTestHost, jsonBody, type TestHost, type TestHostOptions } from "./helpers/host-fixture.js";

let hosts: TestHost[] = [];

afterEach(async () => {
  for (const host of hosts) {
    await host.cleanup();
  }
  hosts = [];
});

function registrations(...adapters: FixedAdapter[]) {
  return adapters.map((adapter) => ({
    id: adapter.id,
    displayName: adapter.displayName,
    create: () => adapter,
  }));
}

async function setup(
  adapters: FixedAdapter[],
  options: Omit<TestHostOptions, "registrations"> = {},
): Promise<TestHost> {
  const host = await createTestHost({ ...options, registrations: registrations(...adapters) });
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
  title?: string,
): Promise<AgentSession> {
  const response = await host.runtime.app.request("/api/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, projectId, ...(title ? { title } : {}) }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await jsonBody<{ session: AgentSession }>(response)).session;
}

describe("multi-provider identity and routing", () => {
  it("keeps colliding native ids distinct and routes each to its own provider", async () => {
    const alpha = new FixedAdapter("alpha");
    const beta = new FixedAdapter("beta");
    const host = await setup([alpha, beta]);
    const [project] = await projects(host);
    if (!project) return;

    const alphaSession = await createSession(host, "alpha", project.id);
    const betaSession = await createSession(host, "beta", project.id);

    expect(alphaSession.id).not.toBe(betaSession.id);
    expect(alphaSession.id.startsWith("hb1~alpha~")).toBe(true);
    expect(betaSession.id.startsWith("hb1~beta~")).toBe(true);

    const fetchedAlpha = await host.runtime.app.request(`/api/v1/sessions/${alphaSession.id}`);
    const fetchedBeta = await host.runtime.app.request(`/api/v1/sessions/${betaSession.id}`);
    expect((await jsonBody<{ session: AgentSession }>(fetchedAlpha)).session.provider).toBe("alpha");
    expect((await jsonBody<{ session: AgentSession }>(fetchedBeta)).session.provider).toBe("beta");

    // History stays isolated even though the native ids collide.
    await host.runtime.app.request(`/api/v1/sessions/${alphaSession.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    await host.runtime.app.request(`/api/v1/sessions/${betaSession.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });

    const alphaMessages = await jsonBody<{ messages: Array<{ parts: Array<{ type: string; text?: string }> }> }>(
      await host.runtime.app.request(`/api/v1/sessions/${alphaSession.id}/messages`),
    );
    const betaMessages = await jsonBody<{ messages: Array<{ parts: Array<{ type: string; text?: string }> }> }>(
      await host.runtime.app.request(`/api/v1/sessions/${betaSession.id}/messages`),
    );
    expect(JSON.stringify(alphaMessages)).toContain("reply from alpha");
    expect(JSON.stringify(alphaMessages)).not.toContain("reply from beta");
    expect(JSON.stringify(betaMessages)).toContain("reply from beta");
  });

  it("routes unknown sessions deterministically without probing other adapters", async () => {
    const alpha = new FixedAdapter("alpha");
    alpha.seedSession("prj_seeded");
    const beta = new FixedAdapter("beta");
    const host = await setup([alpha, beta]);

    const fetched = await host.runtime.app.request(`/api/v1/sessions/${alpha.publicSessionId}`);
    expect(fetched.status).toBe(200);
    expect(alpha.calls.filter((call) => call.startsWith("getSession"))).toHaveLength(1);
    expect(beta.calls.filter((call) => call.startsWith("getSession"))).toHaveLength(0);

    // A beta-scoped id must not fall back to alpha either.
    const missing = await host.runtime.app.request(`/api/v1/sessions/${beta.publicSessionId}`);
    expect(missing.status).toBe(404);
    expect((await jsonBody<ApiErrorBody>(missing)).error.code).toBe("session_not_found");
    expect(alpha.calls.filter((call) => call.includes(beta.publicSessionId))).toHaveLength(0);
  });

  it("routes interrupts, approvals, and questions to the right provider", async () => {
    const alpha = new FixedAdapter("alpha");
    const beta = new FixedAdapter("beta");
    const alphaSession = alpha.seedSession("prj_seeded");
    const betaSession = beta.seedSession("prj_seeded");
    const host = await setup([alpha, beta]);

    const interrupt = await host.runtime.app.request(`/api/v1/sessions/${betaSession.id}/interrupt`, {
      method: "POST",
    });
    expect(interrupt.status).toBe(202);
    expect(beta.calls).toContain(`interrupt ${betaSession.id}`);
    expect(alpha.calls.filter((call) => call.startsWith("interrupt"))).toHaveLength(0);

    // Same native request id on both providers must not collide.
    const alphaRequest = alpha.emitApproval("same-approval", alphaSession.id);
    const betaRequest = beta.emitApproval("same-approval", betaSession.id);
    expect(alphaRequest).not.toBe(betaRequest);

    const resolveAlpha = await host.runtime.app.request(`/api/v1/approvals/${alphaRequest}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optionId: "allow_once" }),
    });
    expect(resolveAlpha.status).toBe(202);
    expect(alpha.resolvedApprovals.has(alphaRequest)).toBe(true);
    expect(beta.resolvedApprovals.has(alphaRequest)).toBe(false);

    const alphaQuestion = alpha.emitQuestion("same-question", alphaSession.id);
    const betaQuestion = beta.emitQuestion("same-question", betaSession.id);
    expect(alphaQuestion).not.toBe(betaQuestion);

    const resolveBeta = await host.runtime.app.request(`/api/v1/questions/${betaQuestion}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: "q0", selectedOptionIds: ["a"] }] }),
    });
    expect(resolveBeta.status).toBe(202);
    expect(beta.resolvedQuestions.has(betaQuestion)).toBe(true);
    expect(alpha.resolvedQuestions.has(betaQuestion)).toBe(false);
  });

  it("lists sessions from both providers and pages across them without duplicates", async () => {
    const alpha = new FixedAdapter("alpha", { nativeIds: ["alpha-a", "alpha-b", "alpha-c"] });
    const beta = new FixedAdapter("beta", { nativeIds: ["beta-a", "beta-b", "beta-c"] });
    const host = await setup([alpha, beta]);
    const [project] = await projects(host);
    if (!project) return;

    for (const [provider, title] of [
      ["alpha", "alpha one"],
      ["beta", "beta one"],
      ["alpha", "alpha two"],
    ] as const) {
      const created = await host.runtime.app.request("/api/v1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, projectId: project.id, title }),
      });
      expect(created.status).toBe(201);
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
      const url = `/api/v1/projects/${project.id}/sessions?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await host.runtime.app.request(url);
      expect(response.status).toBe(200);
      const page = await jsonBody<{ sessions: AgentSession[]; nextCursor: string | null }>(response);
      for (const session of page.sessions) {
        expect(seen.has(session.id), `duplicate session ${session.id}`).toBe(false);
        seen.add(session.id);
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    const providers = new Set([...seen].map((id) => id.split("~")[1]));
    expect(providers).toContain("alpha");
    expect(providers).toContain("beta");
  });

  it("keeps one unavailable provider from breaking the other", async () => {
    const broken = new FixedAdapter("broken", { unavailable: true });
    const healthy = new FixedAdapter("healthy");
    healthy.seedSession("prj_seeded");
    const host = await setup([broken, healthy]);
    const [project] = await projects(host);
    if (!project) return;

    const healthySession = await host.runtime.app.request(`/api/v1/sessions/${healthy.publicSessionId}`);
    expect(healthySession.status).toBe(200);

    const brokenResponse = await host.runtime.app.request(`/api/v1/sessions/${broken.publicSessionId}`);
    expect(brokenResponse.status).toBe(503);
    expect((await jsonBody<ApiErrorBody>(brokenResponse)).error.code).toBe("provider_unavailable");

    const listed = await host.runtime.app.request(`/api/v1/projects/${project.id}/sessions`);
    expect(listed.status).toBe(200);
    const page = await jsonBody<{ sessions: AgentSession[] }>(listed);
    expect(page.sessions.some((session) => session.provider === "healthy")).toBe(true);
  });
});
