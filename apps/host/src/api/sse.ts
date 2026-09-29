import type { Context } from "hono";

import { HOMEBASE_PROTOCOL_VERSION } from "@homebase/protocol";

import type { ApiDependencies } from "./app.js";

const HEARTBEAT_MS = 15_000;

/**
 * SSE delivery of the normalized event stream.
 *
 * - Every event carries its global `sequence` as the SSE `id`.
 * - `Last-Event-ID` (or `?since=`) replays the buffered window after reconnect.
 * - If the requested point is older than the buffer, a `resync` event tells the
 *   client to refetch instead of pretending it can catch up.
 */
export function sseEventsHandler(c: Context, deps: ApiDependencies): Response {
  const principal = c.get("principal") as { kind: string; deviceId?: string };
  const rawSince = c.req.header("last-event-id") ?? c.req.query("since");
  const parsedSince = rawSince !== undefined && rawSince !== "" ? Number.parseInt(rawSince, 10) : Number.NaN;
  const since = Number.isFinite(parsedSince) ? Math.max(0, parsedSince) : undefined;

  const bus = deps.bus;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribeRevocation: (() => void) | undefined;
      let unsubscribe = () => {};

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        unsubscribeRevocation?.();
        try {
          controller.close();
        } catch {
          /* client already closed */
        }
      };

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const send = (eventName: string, data: unknown, id?: number) => {
        if (id !== undefined) write(`id: ${id}\n`);
        write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      write("retry: 3000\n\n");

      if (since !== undefined && since < bus.droppedBefore) {
        send("resync", { droppedBefore: bus.droppedBefore, latestSequence: bus.latestSequence });
      }

      unsubscribe = bus.subscribe(
        (event) => send(event.type, event, event.sequence),
        since !== undefined ? { since } : {},
      );
      send("ready", { latestSequence: bus.latestSequence, protocolVersion: HOMEBASE_PROTOCOL_VERSION });

      if (principal.kind === "device" && principal.deviceId) {
        const id = principal.deviceId;
        unsubscribeRevocation = deps.devices?.onRevoke((revokedId) => {
          if (revokedId === id) {
            send("auth.revoked", { reason: "device_revoked" });
            close();
          }
        });
      }
      const heartbeat = setInterval(() => {
        if (principal.kind === "device" && principal.deviceId && deps.devices?.get(principal.deviceId)?.revokedAt) {
          close();
          return;
        }
        write(": heartbeat\n\n");
      }, HEARTBEAT_MS);

      c.req.raw.signal.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
