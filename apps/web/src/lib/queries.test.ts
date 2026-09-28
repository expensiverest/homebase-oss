import { QueryClient } from "@tanstack/react-query";
import type { AgentEvent } from "@homebase/protocol";
import { describe, expect, it, vi } from "vitest";

import { invalidateForEvent, qk } from "./queries.js";

function spyClient() {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  return { client, spy };
}

const sessionId = "ses_1";

function event(type: AgentEvent["type"], data: Record<string, unknown>, extra: Partial<AgentEvent> = {}): AgentEvent {
  return {
    type,
    provider: "mock",
    projectId: "prj_1",
    sessionId,
    occurredAt: "2026-01-01T00:00:00.000Z",
    data,
    ...extra,
  } as unknown as AgentEvent;
}

describe("event-driven invalidation", () => {
  it("ignores text deltas", () => {
    const { client, spy } = spyClient();
    invalidateForEvent(client, event("message.delta", { messageId: "m", partId: "p", delta: "x" }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes pending actions when an approval arrives", () => {
    const { client, spy } = spyClient();
    invalidateForEvent(client, event("approval.requested", { approval: { id: "a1", sessionId } }));
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.actions(sessionId) });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.session(sessionId) });
  });

  it("refreshes history, session, actions, and diff on a terminal turn", () => {
    const { client, spy } = spyClient();
    invalidateForEvent(client, event("turn.completed", { turnId: "t" }));
    for (const key of [qk.session(sessionId), qk.messages(sessionId), qk.actions(sessionId), qk.diff(sessionId)]) {
      expect(spy).toHaveBeenCalledWith({ queryKey: key });
    }
  });

  it("refreshes provider data but not conversations on provider updates", () => {
    const { client, spy } = spyClient();
    invalidateForEvent(client, event("provider.updated", { provider: { id: "mock" } }, { sessionId: null }));
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.providers });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: qk.messages(sessionId) });
  });

  it("refreshes project session lists on session changes", () => {
    const { client, spy } = spyClient();
    invalidateForEvent(client, event("session.created", { session: { id: "ses_2", projectId: "prj_9" } }));
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.sessions("prj_9") });
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.projects });
  });

  it("invalidates everything on resync", () => {
    const { client, spy } = spyClient();
    invalidateForEvent(client, { type: "resync" });
    expect(spy).toHaveBeenCalledWith();
  });
});
