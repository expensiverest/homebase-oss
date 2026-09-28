import { getTransport } from "./transport.js";

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * Minimal, tolerant SSE parser.
 *
 * Handles arbitrary chunk boundaries, LF/CRLF, comments/heartbeats, multiple
 * `data:` lines, `event:` names, and `id:` fields. Malformed blocks are
 * skipped rather than throwing.
 */
export async function* parseSseStream(body: AsyncIterable<Uint8Array>): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder();
  let buffer = "";

  const parseBlock = (block: string): SseMessage | null => {
    let event = "message";
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const rawLine of block.split("\n")) {
      if (rawLine.length === 0 || rawLine.startsWith(":")) continue;
      const colon = rawLine.indexOf(":");
      const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
      let value = colon === -1 ? "" : rawLine.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "id") id = value;
      else if (field === "data") dataLines.push(value);
      // `retry:` hints are accepted and ignored; reconnection is owned here.
    }
    if (dataLines.length === 0) return null;
    return { event, data: dataLines.join("\n"), ...(id !== undefined ? { id } : {}) };
  };

  for await (const chunk of body) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true }).replace(/\r\n?/g, "\n");
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const message = parseBlock(block);
      if (message) yield message;
    }
  }
  // A final block without a trailing blank line.
  const trailing = parseBlock(buffer);
  if (trailing) yield trailing;
}

export interface EventStreamOptions {
  url: string;
  headers?: Record<string, string>;
  signal: AbortSignal;
  onOpen?: () => void;
}

/** Opens an SSE stream over fetch (Authorization headers supported). */
export async function* openEventStream(options: EventStreamOptions): AsyncGenerator<SseMessage> {
  let response: Response;
  try {
    response = await getTransport().fetch(options.url, {
      headers: { accept: "text/event-stream", ...(options.headers ?? {}) },
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) return;
    throw error;
  }
  if (!response.ok || !response.body) {
    throw Object.assign(new Error(`Event stream failed with HTTP ${response.status}.`), { status: response.status });
  }
  options.onOpen?.();
  yield* parseSseStream(response.body as unknown as AsyncIterable<Uint8Array>);
}
