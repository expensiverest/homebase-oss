import type { NativeEvent } from "./native.js";

export interface OpenCodeClientOptions {
  baseUrl: string;
  username: string;
  password?: string;
  requestTimeoutMs: number;
  fetchFn?: typeof fetch;
}

export interface OpenCodeRequestOptions {
  /** Deep-object `location[directory]` scope for catalog calls. */
  location?: string;
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
}

/** Transport failure carrying the OpenCode status and `_tag` for normalization. */
export class OpenCodeHttpError extends Error {
  readonly status: number;
  readonly tag: string;

  constructor(status: number, tag: string, message: string) {
    super(message);
    this.name = "OpenCodeHttpError";
    this.status = status;
    this.tag = tag;
  }
}

/**
 * The only place that knows OpenCode's HTTP details: Basic auth, the
 * `location[directory]` deep-object query, `_tag` error bodies, and the global
 * event stream. Everything above this file speaks `@homebase/protocol`.
 */
export class OpenCodeClient {
  readonly #baseUrl: string;
  readonly #auth: string | null;
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: OpenCodeClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#auth = options.password
      ? `Basic ${Buffer.from(`${options.username}:${options.password}`, "utf8").toString("base64")}`
      : null;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetch = options.fetchFn ?? fetch;
  }

  buildUrl(path: string, options: OpenCodeRequestOptions = {}): URL {
    const url = new URL(path, `${this.#baseUrl}/`);
    if (options.location !== undefined) {
      url.searchParams.set("location[directory]", options.location);
    }
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request<T>(method: string, path: string, options: OpenCodeRequestOptions = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(this.buildUrl(path, options), {
        method,
        headers: {
          accept: "application/json",
          ...(this.#auth ? { authorization: this.#auth } : {}),
          ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? this.#requestTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new OpenCodeHttpError(
        0,
        timedOut ? "Timeout" : "Unreachable",
        timedOut
          ? "The OpenCode server did not respond in time."
          : "The OpenCode server is unreachable. Check providers.opencode.config.baseUrl and that the server is running.",
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }
    if (!response.ok) {
      throw await this.#errorFromResponse(response, method, path);
    }

    const text = await response.text();
    if (text.trim().length === 0) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new OpenCodeHttpError(502, "BadResponse", "OpenCode returned a malformed JSON response.");
    }
  }

  get<T>(path: string, options?: OpenCodeRequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, body?: unknown, options?: OpenCodeRequestOptions): Promise<T> {
    return this.request<T>("POST", path, { ...options, body: body ?? {} });
  }

  /**
   * Opens `GET /api/event` and yields parsed events. The caller owns
   * reconnecting; an abort ends the generator.
   */
  async *events(signal: AbortSignal): AsyncGenerator<NativeEvent> {
    let response: Response;
    try {
      response = await this.#fetch(this.buildUrl("/api/event"), {
        headers: {
          accept: "text/event-stream",
          ...(this.#auth ? { authorization: this.#auth } : {}),
        },
        signal,
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return;
      throw new OpenCodeHttpError(0, "Unreachable", "The OpenCode event stream is unreachable.");
    }
    if (!response.ok || !response.body) {
      throw new OpenCodeHttpError(response.status, `HTTP${response.status}`, "OpenCode refused the event stream.");
    }
    yield* parseEventStream(response.body);
  }

  async #errorFromResponse(response: Response, method: string, path: string): Promise<OpenCodeHttpError> {
    let tag = `HTTP${response.status}`;
    let message = `OpenCode ${method} ${path} failed with HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { _tag?: unknown; message?: unknown };
      if (typeof body._tag === "string") tag = body._tag;
      if (typeof body.message === "string" && body.message.length > 0) message = body.message;
    } catch {
      // Non-JSON error bodies stay generic so nothing unsanitized leaks upward.
    }
    return new OpenCodeHttpError(response.status, tag, message);
  }
}

/** Minimal SSE parser: yields JSON event objects; comments and malformed blocks are skipped. */
export async function* parseEventStream(body: AsyncIterable<Uint8Array>): AsyncGenerator<NativeEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, "\n");
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data.length === 0) continue;
      try {
        const event = JSON.parse(data) as NativeEvent;
        if (event && typeof event.type === "string" && typeof event.id === "string") {
          yield event;
        }
      } catch {
        // Ignore malformed blocks; the stream continues.
      }
    }
  }
}
