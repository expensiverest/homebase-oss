import { randomUUID } from "node:crypto";

import type { AdapterContext, AgentAdapter } from "@homebase/adapter-sdk";
import { AdapterError } from "@homebase/adapter-sdk";
import {
  defineCapabilities,
  nowTimestamp,
  type AgentCapabilities,
  type AgentDiff,
  type AgentEvent,
  type AgentEventType,
  type AgentMode,
  type AgentModel,
  type AgentProject,
  type AgentSession,
  type AgentUsage,
  type CreateSessionInput,
  type ProviderDetection,
  type SendMessageInput,
} from "@homebase/protocol";

/**
 * Minimal example adapter for adapter authors.
 *
 * It is intentionally small and honest: it streams text, but it declares no
 * approvals, questions, tools, models, modes, diffs, usage, or deletion. The
 * capability declarations and the absence of the matching methods are both
 * checked by the compliance suite.
 *
 * Copy this package as the starting point for a new provider adapter:
 * 1. replace the transport with your provider's documented interface,
 * 2. map native events to `AgentEvent`s,
 * 3. declare only capabilities you truly implement,
 * 4. run `defineAdapterComplianceSuite` with `live: true` for local checks.
 */
export class ExampleAdapter implements AgentAdapter {
  readonly id = "example";
  readonly displayName = "Example Echo Agent";

  readonly #capabilities: AgentCapabilities = defineCapabilities({
    // The example streams text. Everything else stays unsupported on purpose.
    streaming: true,
  });

  #context: AdapterContext | null = null;
  #counter = 0;
  readonly #sessions = new Map<string, AgentSession>();

  init(context: AdapterContext): void {
    this.#context = context;
  }

  async detect(): Promise<ProviderDetection> {
    return {
      installed: true,
      authenticated: null,
      compatible: true,
      version: "1.0.0-example",
      warning: "Example adapter: replies are generated locally and no provider CLI is used.",
    };
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    return { ...this.#capabilities };
  }

  async listModels(_project: AgentProject): Promise<AgentModel[]> {
    return [];
  }

  async listModes(_project: AgentProject): Promise<AgentMode[]> {
    return [];
  }

  async listSessions(project: AgentProject): Promise<AgentSession[]> {
    return [...this.#sessions.values()]
      .filter((session) => session.projectId === project.id)
      .map((session) => structuredClone(session));
  }

  async getSession(sessionId: string): Promise<AgentSession> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new AdapterError("session_not_found", `Unknown example session "${sessionId}".`);
    }
    return structuredClone(session);
  }

  async createSession(input: CreateSessionInput, project: AgentProject): Promise<AgentSession> {
    const timestamp = nowTimestamp();
    const session: AgentSession = {
      id: `exa_${randomUUID().slice(0, 8)}`,
      provider: this.id,
      projectId: project.id,
      title: input.title ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: "idle",
    };
    this.#sessions.set(session.id, session);
    this.#emit(session, "session.created", { session: structuredClone(session) });
    return structuredClone(session);
  }

  async send(sessionId: string, input: SendMessageInput): Promise<void> {
    const session = await this.getSession(sessionId);
    const turnId = `turn_${++this.#counter}`;
    const messageId = `msg_${++this.#counter}`;
    const partId = `part_${++this.#counter}`;
    const reply = `Echo: ${input.text}`;

    session.state = "working";
    session.updatedAt = nowTimestamp();
    this.#emit(session, "session.updated", { session: structuredClone(session) });
    this.#emit(session, "turn.started", { turnId });
    this.#emit(session, "message.started", {
      message: {
        id: messageId,
        sessionId,
        role: "assistant",
        createdAt: nowTimestamp(),
        state: "streaming",
        parts: [{ type: "text", id: partId, text: "" }],
      },
    });

    let streamed = "";
    for (const word of reply.split(" ")) {
      streamed += `${word} `;
      await new Promise((resolve) => setImmediate(resolve));
      this.#emit(session, "message.delta", { messageId, partId, delta: `${word} ` });
    }

    const finalText = streamed.trimEnd();
    this.#emit(session, "message.completed", {
      message: {
        id: messageId,
        sessionId,
        role: "assistant",
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
        state: "completed",
        parts: [{ type: "text", id: partId, text: finalText }],
      },
    });
    this.#emit(session, "turn.completed", { turnId });

    session.state = "idle";
    session.updatedAt = nowTimestamp();
    this.#sessions.set(session.id, session);
    this.#emit(session, "session.updated", { session: structuredClone(session) });
  }

  async getDiff(_sessionId: string): Promise<AgentDiff> {
    throw new AdapterError("unsupported_capability", "The example adapter does not support diffs.");
  }

  async getUsage(): Promise<AgentUsage | null> {
    return null;
  }

  #emit<T extends AgentEventType>(
    session: Pick<AgentSession, "id" | "projectId">,
    type: T,
    data: Extract<AgentEvent, { type: T }>["data"],
  ): void {
    if (!this.#context) {
      throw new AdapterError("internal", "ExampleAdapter.init() has not been called.");
    }
    this.#context.emit({
      type,
      provider: this.id,
      projectId: session.projectId,
      sessionId: session.id,
      occurredAt: nowTimestamp(),
      data,
    } as AgentEvent);
  }
}
