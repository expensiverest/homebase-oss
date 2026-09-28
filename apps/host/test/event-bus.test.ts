import { describe, expect, it } from "vitest";

import { EventBus } from "../src/events/index.js";

function turnEvent(turnId: string) {
  return {
    type: "turn.started" as const,
    provider: "mock",
    projectId: "prj_1",
    sessionId: "ses_1",
    data: { turnId },
  };
}

describe("EventBus", () => {
  it("assigns monotonically increasing sequences and ids", () => {
    const bus = new EventBus();
    const first = bus.publish(turnEvent("turn_1"));
    const second = bus.publish(turnEvent("turn_2"));

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(first.id).toBe("evt_1");
    expect(second.id).toBe("evt_2");
    expect(bus.latestSequence).toBe(2);
  });

  it("stamps occurredAt when the adapter omitted it and preserves provided values", () => {
    const bus = new EventBus();
    const stamped = bus.publish(turnEvent("turn_1"));
    expect(Number.isNaN(Date.parse(stamped.occurredAt))).toBe(false);

    const provided = bus.publish({
      ...turnEvent("turn_2"),
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(provided.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("replays buffered events after a sequence", () => {
    const bus = new EventBus();
    bus.publish(turnEvent("turn_1"));
    bus.publish(turnEvent("turn_2"));
    bus.publish(turnEvent("turn_3"));

    expect(bus.getAfter(1).map((event) => event.sequence)).toEqual([2, 3]);
    expect(bus.getAfter(3)).toEqual([]);
  });

  it("drops old events once the buffer is full and reports the floor", () => {
    const bus = new EventBus({ bufferSize: 3 });
    for (let index = 0; index < 5; index += 1) {
      bus.publish(turnEvent(`turn_${index}`));
    }

    expect(bus.bufferedCount).toBe(3);
    expect(bus.droppedBefore).toBe(2);
    expect(bus.getAfter(0).map((event) => event.sequence)).toEqual([3, 4, 5]);
  });

  it("delivers live events and supports replay-then-live subscriptions", () => {
    const bus = new EventBus();
    const seen: number[] = [];

    bus.publish(turnEvent("turn_1"));
    const unsubscribe = bus.subscribe((event) => seen.push(event.sequence), { since: 1 });
    bus.publish(turnEvent("turn_2"));
    unsubscribe();
    bus.publish(turnEvent("turn_3"));

    expect(seen).toEqual([2]);
    expect(bus.getAfter(0).map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("isolates listener failures", () => {
    const errors: unknown[] = [];
    const bus = new EventBus({ onListenerError: (error) => errors.push(error) });
    const seen: number[] = [];

    bus.subscribe(() => {
      throw new Error("listener exploded");
    });
    bus.subscribe((event) => seen.push(event.sequence));

    bus.publish(turnEvent("turn_1"));
    expect(seen).toEqual([1]);
    expect(errors).toHaveLength(1);
  });
});
