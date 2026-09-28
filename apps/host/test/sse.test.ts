import { afterEach, describe, expect, it } from "vitest";

import { createTestHost, type TestHost, type TestHostOptions } from "./helpers/host-fixture.js";

let hosts: TestHost[] = [];
let closeStreams: Array<() => void> = [];

afterEach(async () => {
  for (const close of closeStreams) {
    close();
  }
  closeStreams = [];
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

async function openSse(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response has no body");

  const decoder = new TextDecoder();
  let buffer = "";
  let closed = false;

  return {
    response,
    async readUntil(marker: string, timeoutMs = 5_000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (!buffer.includes(marker)) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for "${marker}". Received so far:\n${buffer}`);
        }
        const { value, done } = await reader.read();
        if (done) throw new Error(`SSE stream ended early. Received:\n${buffer}`);
        buffer += decoder.decode(value, { stream: true });
      }
      return buffer;
    },
    close() {
      if (closed) return;
      closed = true;
      controller.abort();
      void reader.cancel().catch(() => undefined);
    },
  };
}

async function startBase(host: TestHost): Promise<string> {
  const address = await host.runtime.start();
  return `http://127.0.0.1:${address.port}`;
}

describe("SSE event stream", () => {
  it("sends ready and live normalized events with sequence ids", async () => {
    const host = await setup({ eventBufferSize: 50 });
    const base = await startBase(host);

    const sse = await openSse(`${base}/api/v1/events`);
    closeStreams.push(() => sse.close());
    expect(sse.response.headers.get("content-type")).toContain("text/event-stream");

    await sse.readUntil("event: ready");

    const published = host.runtime.bus.publish({
      type: "turn.started",
      provider: "mock",
      projectId: null,
      sessionId: "ses_sse",
      data: { turnId: "turn_sse" },
    });

    const text = await sse.readUntil("event: turn.started");
    expect(text).toContain(`id: ${published.sequence}`);
    expect(text).toContain(`"sequence":${published.sequence}`);
    expect(text).toContain(`"turnId":"turn_sse"`);
  });

  it("replays buffered events after Last-Event-ID", async () => {
    const host = await setup({ eventBufferSize: 50 });
    const base = await startBase(host);

    const first = host.runtime.bus.publish({
      type: "turn.started",
      provider: "mock",
      projectId: null,
      sessionId: "ses_sse",
      data: { turnId: "turn_one" },
    });
    host.runtime.bus.publish({
      type: "turn.started",
      provider: "mock",
      projectId: null,
      sessionId: "ses_sse",
      data: { turnId: "turn_two" },
    });

    const sse = await openSse(`${base}/api/v1/events`, { "last-event-id": String(first.sequence) });
    closeStreams.push(() => sse.close());

    const text = await sse.readUntil(`"turnId":"turn_two"`);
    expect(text).not.toContain(`"turnId":"turn_one"`);
  });

  it("asks the client to resync when the requested point was dropped", async () => {
    const host = await setup({ eventBufferSize: 3 });
    const base = await startBase(host);

    for (let index = 0; index < 5; index += 1) {
      host.runtime.bus.publish({
        type: "turn.started",
        provider: "mock",
        projectId: null,
        sessionId: "ses_sse",
        data: { turnId: `turn_${index}` },
      });
    }
    const droppedBefore = host.runtime.bus.droppedBefore;
    expect(droppedBefore).toBeGreaterThan(0);

    const sse = await openSse(`${base}/api/v1/events?since=0`);
    closeStreams.push(() => sse.close());

    const resync = await sse.readUntil("event: resync");
    expect(resync).toContain(`"droppedBefore":${droppedBefore}`);
    await sse.readUntil(`"turnId":"turn_4"`);
  });
});
