import type { ApiErrorBody } from "@homebase/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { Authenticator } from "../src/auth/index.js";
import { createTestHost, jsonBody, type TestHost } from "./helpers/host-fixture.js";

const TOKEN = "test-token-test-token-test-token-test-token";

let hosts: TestHost[] = [];

afterEach(async () => {
  for (const host of hosts) {
    await host.cleanup();
  }
  hosts = [];
});

describe("Authenticator", () => {
  it("accepts the configured token and rejects others", () => {
    const auth = new Authenticator({ mode: "dev-token", devToken: TOKEN });
    expect(auth.authenticate(`Bearer ${TOKEN}`, "client").ok).toBe(true);
    expect(auth.authenticate("Bearer nope", "client")).toMatchObject({ ok: false, status: 401 });
    expect(auth.authenticate(undefined, "client")).toMatchObject({ ok: false, status: 401 });
  });

  it("throttles repeated failures and locks out the client key", async () => {
    const auth = new Authenticator({ mode: "dev-token", devToken: TOKEN, maxFailures: 3, lockoutMs: 50 });
    expect(auth.authenticate("Bearer wrong", "client").status).toBe(401);
    expect(auth.authenticate("Bearer wrong", "client").status).toBe(401);
    expect(auth.authenticate("Bearer wrong", "client").status).toBe(429);
    // A bad actor sharing the Serve loopback address cannot lock out a valid credential.
    expect(auth.authenticate(`Bearer ${TOKEN}`, "client").ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(auth.authenticate(`Bearer ${TOKEN}`, "client").ok).toBe(true);
  });

  it("allows anonymous access when auth mode is none", () => {
    const auth = new Authenticator({ mode: "none" });
    expect(auth.authenticate(undefined, "client").ok).toBe(true);
  });
});

describe("authenticated API", () => {
  it("protects API routes while keeping health available", async () => {
    const host = await createTestHost({
      config: { auth: { mode: "dev-token", devToken: TOKEN } },
    });
    hosts.push(host);

    const unauthorized = await host.runtime.app.request("/api/v1/projects");
    expect(unauthorized.status).toBe(401);
    expect((await jsonBody<ApiErrorBody>(unauthorized)).error.code).toBe("invalid_request");

    const health = await host.runtime.app.request("/api/v1/health");
    expect(health.status).toBe(200);

    const authorized = await host.runtime.app.request("/api/v1/projects", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(authorized.status).toBe(200);

    const wrongToken = await host.runtime.app.request("/api/v1/projects", {
      headers: { authorization: "Bearer wrong-wrong-wrong" },
    });
    expect(wrongToken.status).toBe(401);
  });
});
