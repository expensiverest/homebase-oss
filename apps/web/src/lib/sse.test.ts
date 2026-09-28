import { describe, expect, it } from "vitest";

import { parseSseStream, type SseMessage } from "./sse.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<SseMessage[]> {
  const messages: SseMessage[] = [];
  for await (const message of parseSseStream(streamOf(chunks) as unknown as AsyncIterable<Uint8Array>))
    messages.push(message);
  return messages;
}

describe("parseSseStream", () => {
  it("parses events split across chunk boundaries", async () => {
    const messages = await collect(['event: ready\ndata: {"a":', "1}\n\nid: 7\ndata: two\n\n"]);
    expect(messages).toEqual([
      { event: "ready", data: '{"a":1}' },
      { event: "message", data: "two", id: "7" },
    ]);
  });

  it("handles CRLF, multiline data, and comments/heartbeats", async () => {
    const messages = await collect([": heartbeat\r\n\r\nevent: delta\r\ndata: one\r\ndata: two\r\n\r\n"]);
    expect(messages).toEqual([{ event: "delta", data: "one\ntwo" }]);
  });

  it("ignores retry hints and unknown fields", async () => {
    const messages = await collect(["retry: 5000\nfoo: bar\ndata: payload\n\n"]);
    expect(messages).toEqual([{ event: "message", data: "payload" }]);
  });

  it("tolerates malformed and empty blocks", async () => {
    const messages = await collect(["garbage\n\n\n\n: only a comment\n\n", "event: fine\ndata: ok\n\n"]);
    expect(messages).toEqual([{ event: "fine", data: "ok" }]);
  });

  it("yields a final block without a trailing blank line", async () => {
    const messages = await collect(["event: ready\ndata: {}"]);
    expect(messages).toEqual([{ event: "ready", data: "{}" }]);
  });
});
