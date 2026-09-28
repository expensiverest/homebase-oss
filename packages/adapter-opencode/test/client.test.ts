import { describe, expect, it } from "vitest";

import { OpenCodeClient, OpenCodeHttpError, parseEventStream } from "../src/client.js";
import { createFakeFetch, errorResponse, jsonResponse } from "./helpers.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("OpenCodeClient", () => {
  it("builds location deep-object and plain query parameters", () => {
    const client = new OpenCodeClient({
      baseUrl: "http://127.0.0.1:4096/",
      username: "opencode",
      requestTimeoutMs: 1000,
    });
    const url = client.buildUrl("/api/model", {
      location: "C:\\projects\\demo",
      query: { limit: 10, skip: undefined },
    });
    expect(url.pathname).toBe("/api/model");
    expect(url.searchParams.get("location[directory]")).toBe("C:\\projects\\demo");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.has("skip")).toBe(false);
  });

  it("sends Basic auth only when a password is configured", async () => {
    const { fetchFn, calls } = createFakeFetch([
      { method: "GET", path: "/api/info", handler: () => jsonResponse({ version: "2.0.18" }) },
    ]);
    const withPassword = new OpenCodeClient({
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      password: "secret-value",
      requestTimeoutMs: 1000,
      fetchFn,
    });
    await withPassword.get("/api/info");
    expect(calls[0]?.url.searchParams.has("password")).toBe(false);

    const withoutPassword = new OpenCodeClient({
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      requestTimeoutMs: 1000,
      fetchFn,
    });
    await withoutPassword.get("/api/info");
    expect(calls).toHaveLength(2);
  });

  it("returns undefined for 204 responses and parses JSON otherwise", async () => {
    const { fetchFn } = createFakeFetch([
      { method: "DELETE", path: "/api/session/ses_1", handler: () => new Response(null, { status: 204 }) },
      { method: "GET", path: "/api/info", handler: () => jsonResponse({ version: "2.0.18" }) },
    ]);
    const client = new OpenCodeClient({
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      requestTimeoutMs: 1000,
      fetchFn,
    });
    expect(await client.request("DELETE", "/api/session/ses_1")).toBeUndefined();
    expect(await client.get<{ version: string }>("/api/info")).toEqual({ version: "2.0.18" });
  });

  it("surfaces OpenCode _tag errors and rejects malformed success bodies", async () => {
    const { fetchFn } = createFakeFetch([
      {
        method: "GET",
        path: "/api/session/ses_missing",
        handler: () => errorResponse(404, "SessionNotFoundError", "no such session"),
      },
      { method: "GET", path: "/api/info", handler: () => new Response("<html>login</html>", { status: 200 }) },
    ]);
    const client = new OpenCodeClient({
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      requestTimeoutMs: 1000,
      fetchFn,
    });

    await expect(client.get("/api/session/ses_missing")).rejects.toMatchObject({
      status: 404,
      tag: "SessionNotFoundError",
    });
    await expect(client.get("/api/info")).rejects.toMatchObject({ status: 502, tag: "BadResponse" });
  });

  it("maps network failures and timeouts without leaking internals", async () => {
    const refusing = new OpenCodeClient({
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      requestTimeoutMs: 1000,
      fetchFn: (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch,
    });
    await expect(refusing.get("/api/info")).rejects.toMatchObject({ status: 0, tag: "Unreachable" });

    const timingOut = new OpenCodeClient({
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      requestTimeoutMs: 1000,
      fetchFn: (() => Promise.reject(new DOMException("timed out", "TimeoutError"))) as typeof fetch,
    });
    await expect(timingOut.get("/api/info")).rejects.toMatchObject({ status: 0, tag: "Timeout" });
  });
});

describe("SSE parsing", () => {
  it("parses events across arbitrary chunk boundaries and skips noise", async () => {
    const stream = streamFromChunks([
      'data: {"id":"evt_1","type":"server.connected","data":{}}\n\n: heartbeat\n\nda',
      'ta: {"id":"evt_2","type":"session.updated","data":{"sessionID":"ses_1"}}\r\n\r\n',
      'data: not-json\n\ndata: {"id":"evt_3","type":"form.created","data":{}}\n\n',
    ]);
    const events = [];
    for await (const event of parseEventStream(stream)) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["server.connected", "session.updated", "form.created"]);
  });

  it("throws a transport error when the stream request fails", async () => {
    const client = new OpenCodeClient({
      baseUrl: "http://127.0.0.1:4096",
      username: "opencode",
      requestTimeoutMs: 1000,
      fetchFn: (() => Promise.resolve(new Response(null, { status: 503 }))) as typeof fetch,
    });
    const iterator = client.events(new AbortController().signal);
    await expect(iterator.next()).rejects.toBeInstanceOf(OpenCodeHttpError);
  });
});
