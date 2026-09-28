import { nowTimestamp, type AgentEvent, type SequencedAgentEvent } from "@homebase/protocol";

export interface EventBusOptions {
  /** Maximum number of recent events kept for replay after reconnect. */
  bufferSize?: number;
  onListenerError?: (error: unknown) => void;
}

/**
 * The Host's global normalized event bus.
 *
 * Every provider event flows through here. The bus assigns the global,
 * monotonically increasing `sequence` that clients use to resume after a
 * disconnect or app suspension, and keeps a bounded replay buffer.
 */
export class EventBus {
  #sequence = 0;
  #buffer: SequencedAgentEvent[] = [];
  readonly #listeners = new Set<(event: SequencedAgentEvent) => void>();
  readonly #bufferSize: number;
  readonly #onListenerError: ((error: unknown) => void) | undefined;

  constructor(options: EventBusOptions = {}) {
    this.#bufferSize = options.bufferSize ?? 10_000;
    this.#onListenerError = options.onListenerError;
  }

  get latestSequence(): number {
    return this.#sequence;
  }

  /** Highest sequence no longer replayable; 0 while nothing has been dropped. */
  get droppedBefore(): number {
    const first = this.#buffer[0];
    return first ? first.sequence - 1 : 0;
  }

  get bufferedCount(): number {
    return this.#buffer.length;
  }

  /** Stamps and stores an event, then fans it out to subscribers. */
  publish(event: AgentEvent): SequencedAgentEvent {
    const sequence = ++this.#sequence;
    const sequenced = {
      ...event,
      id: `evt_${sequence}`,
      sequence,
      occurredAt: event.occurredAt ?? nowTimestamp(),
    } as SequencedAgentEvent;

    this.#buffer.push(sequenced);
    if (this.#buffer.length > this.#bufferSize) {
      this.#buffer.splice(0, this.#buffer.length - this.#bufferSize);
    }

    for (const listener of [...this.#listeners]) {
      try {
        listener(sequenced);
      } catch (error) {
        this.#onListenerError?.(error);
      }
    }

    return sequenced;
  }

  /**
   * Subscribes to events. With `since`, buffered events newer than that
   * sequence are delivered first (replay semantics for SSE reconnect).
   */
  subscribe(listener: (event: SequencedAgentEvent) => void, options: { since?: number } = {}): () => void {
    if (options.since !== undefined) {
      for (const event of this.getAfter(options.since)) {
        listener(event);
      }
    }
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Buffered events with a sequence greater than the given value. */
  getAfter(sequence: number): SequencedAgentEvent[] {
    return this.#buffer.filter((event) => event.sequence > sequence);
  }
}
