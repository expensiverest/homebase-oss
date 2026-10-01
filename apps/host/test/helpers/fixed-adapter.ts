import type { AdapterContext, AgentAdapter } from "@homebase/adapter-sdk";
import { AdapterError, createPublicId } from "@homebase/adapter-sdk";
import {
  defineCapabilities,
  nowTimestamp,
  type AgentCapabilities,
  type AgentDiff,
  type AgentMessage,
  type AgentMode,
  type AgentModel,
  type AgentPage,
  type AgentProject,
  type AgentSession,
  type AgentProviderUsage,
  type ApprovalResult,
  type CreateSessionInput,
  type PageRequest,
  type QuestionAnswer,
  type SendMessageInput,
  type SetModelInput,
  type SetModeInput,
} from "@homebase/protocol";

export interface FixedAdapterOptions {
  /** Fixed native session id shared with the other test provider to prove collisions. */
  nativeId?: string;
  /** Pool of native ids consumed by createSession/seedSession (defaults to [nativeId]). */
  nativeIds?: string[];
  /** Distinguishes history content per provider. */
  messageText?: string;
  /** When true every operation fails as provider_unavailable. */
  unavailable?: boolean;
}

/**
 * Minimal two-provider test adapter. It intentionally uses provider-native ids
 * that collide with a sibling adapter, and wraps them with `createPublicId` so
 * tests can prove Host routing is deterministic and collision-free.
 */
export class FixedAdapter implements AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly calls: string[] = [];
  readonly resolvedApprovals = new Map<string, ApprovalResult>();
  readonly resolvedQuestions = new Map<string, QuestionAnswer>();

  readonly #nativeIds: string[];
  readonly #messageText: string;
  readonly #unavailable: boolean;
  #context: AdapterContext | null = null;
  readonly #sessions = new Map<string, AgentSession>();
  readonly #messages = new Map<string, AgentMessage[]>();
  #counter = 0;
  #nativeCursor = 0;

  constructor(id: string, options: FixedAdapterOptions = {}) {
    this.id = id;
    this.displayName = id;
    this.#nativeIds = options.nativeIds ?? [options.nativeId ?? "same-id"];
    this.#messageText = options.messageText ?? `reply from ${id}`;
    this.#unavailable = options.unavailable ?? false;
  }

  /** Public session id this adapter derives from its first fixed native id. */
  get publicSessionId(): string {
    return createPublicId(this.id, this.#nativeIds[0] ?? "same-id");
  }

  #nextNativeId(): string {
    const nativeId = this.#nativeIds[this.#nativeCursor % this.#nativeIds.length] ?? "same-id";
    this.#nativeCursor += 1;
    return nativeId;
  }

  /** Seeds a session so Host routing can be tested without a prior create. */
  seedSession(projectId: string, title?: string, nativeId?: string): AgentSession {
    const timestamp = nowTimestamp();
    const publicId = createPublicId(this.id, nativeId ?? this.#nextNativeId());
    const session: AgentSession = {
      id: publicId,
      provider: this.id,
      projectId,
      title: title ?? `${this.id} session`,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: "idle",
    };
    this.#sessions.set(publicId, session);
    return session;
  }

  emitApproval(nativeRequestId: string, sessionId: string): string {
    const requestId = createPublicId(this.id, nativeRequestId);
    this.#requireContext().emit({
      type: "approval.requested",
      provider: this.id,
      projectId: this.#sessions.get(sessionId)?.projectId ?? null,
      sessionId,
      occurredAt: nowTimestamp(),
      data: {
        approval: {
          id: requestId,
          sessionId,
          provider: this.id,
          createdAt: nowTimestamp(),
          kind: "tool",
          title: `Approval from ${this.id}`,
          options: [
            { id: "allow_once", label: "Allow once", kind: "allow_once" },
            { id: "deny", label: "Deny", kind: "deny" },
          ],
        },
      },
    });
    return requestId;
  }

  emitQuestion(nativeRequestId: string, sessionId: string): string {
    const requestId = createPublicId(this.id, nativeRequestId);
    this.#requireContext().emit({
      type: "question.requested",
      provider: this.id,
      projectId: this.#sessions.get(sessionId)?.projectId ?? null,
      sessionId,
      occurredAt: nowTimestamp(),
      data: {
        question: {
          id: requestId,
          sessionId,
          provider: this.id,
          createdAt: nowTimestamp(),
          title: `Question from ${this.id}`,
          questions: [{ id: "q0", question: "Pick one", kind: "single_select", options: [{ id: "a", label: "A" }] }],
        },
      },
    });
    return requestId;
  }

  async detect() {
    return {
      installed: true,
      authenticated: true,
      compatible: true,
      version: "1.0.0-test",
    };
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    return defineCapabilities({
      resume: true,
      deleteSession: true,
      streaming: true,
      interrupt: true,
      steer: true,
      queue: true,
      models: true,
      modes: true,
      approvals: true,
      questions: true,
      diffs: true,
    });
  }

  async listModels(_project: AgentProject): Promise<AgentModel[]> {
    return [];
  }

  async listModes(_project: AgentProject): Promise<AgentMode[]> {
    return [];
  }

  async listSessions(_project: AgentProject, page: PageRequest = {}): Promise<AgentPage<AgentSession>> {
    this.calls.push("listSessions");
    this.#assertAvailable();
    const items = [...this.#sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const limit = Math.min(page.limit ?? 50, 100);
    const offset = page.cursor ? Number.parseInt(page.cursor.replace(`${this.id}:`, ""), 10) : 0;
    const slice = items.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return {
      items: slice,
      nextCursor: nextOffset < items.length ? `${this.id}:${nextOffset}` : null,
      previousCursor: null,
    };
  }

  async getSession(sessionId: string): Promise<AgentSession> {
    this.calls.push(`getSession ${sessionId}`);
    this.#assertAvailable();
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new AdapterError("session_not_found", `Unknown session "${sessionId}".`);
    }
    return structuredClone(session);
  }

  async createSession(input: CreateSessionInput, project: AgentProject): Promise<AgentSession> {
    this.calls.push("createSession");
    const session = this.seedSession(project.id, input.title ?? undefined);
    this.#requireContext().emit({
      type: "session.created",
      provider: this.id,
      projectId: project.id,
      sessionId: session.id,
      occurredAt: nowTimestamp(),
      data: { session },
    });
    return structuredClone(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.calls.push(`deleteSession ${sessionId}`);
    this.#sessions.delete(sessionId);
    this.#messages.delete(sessionId);
  }

  async listMessages(sessionId: string, page: PageRequest = {}): Promise<AgentPage<AgentMessage>> {
    this.calls.push(`listMessages ${sessionId}`);
    this.#assertAvailable();
    if (!this.#sessions.has(sessionId)) {
      throw new AdapterError("session_not_found", `Unknown session "${sessionId}".`);
    }
    const items = [...(this.#messages.get(sessionId) ?? [])].reverse();
    const limit = Math.min(page.limit ?? 50, 200);
    return { items: items.slice(0, limit), nextCursor: null, previousCursor: null };
  }

  async send(sessionId: string, input: SendMessageInput): Promise<void> {
    this.calls.push(`send ${sessionId}`);
    this.#assertAvailable();
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new AdapterError("session_not_found", `Unknown session "${sessionId}".`);
    }
    const timestamp = nowTimestamp();
    const messages = this.#messages.get(sessionId) ?? [];
    messages.push({
      id: `msg_${++this.#counter}`,
      sessionId,
      role: "user",
      createdAt: timestamp,
      state: "completed",
      parts: [{ type: "text", id: `part_${this.#counter}`, text: input.text }],
    });
    messages.push({
      id: `msg_${++this.#counter}`,
      sessionId,
      role: "assistant",
      createdAt: timestamp,
      state: "completed",
      parts: [{ type: "text", id: `part_${this.#counter}`, text: `${this.#messageText}: ${input.text}` }],
    });
    this.#messages.set(sessionId, messages);
  }

  async interrupt(sessionId: string): Promise<void> {
    this.calls.push(`interrupt ${sessionId}`);
  }

  async steer(sessionId: string, _input: SendMessageInput): Promise<void> {
    this.calls.push(`steer ${sessionId}`);
  }

  async queue(sessionId: string, _input: SendMessageInput): Promise<void> {
    this.calls.push(`queue ${sessionId}`);
  }

  async resolveApproval(requestId: string, result: ApprovalResult): Promise<void> {
    this.calls.push(`resolveApproval ${requestId}`);
    this.resolvedApprovals.set(requestId, result);
    this.#requireContext().emit({
      type: "approval.resolved",
      provider: this.id,
      projectId: null,
      sessionId: null,
      occurredAt: nowTimestamp(),
      data: {
        resolution: { requestId, optionId: result.optionId, resolvedAt: nowTimestamp(), resolvedBy: "user" },
      },
    });
  }

  async answerQuestion(requestId: string, answer: QuestionAnswer): Promise<void> {
    this.calls.push(`answerQuestion ${requestId}`);
    this.resolvedQuestions.set(requestId, answer);
    this.#requireContext().emit({
      type: "question.resolved",
      provider: this.id,
      projectId: null,
      sessionId: null,
      occurredAt: nowTimestamp(),
      data: {
        resolution: { requestId, answers: answer.answers, resolvedAt: nowTimestamp() },
      },
    });
  }

  async setModel(sessionId: string, _input: SetModelInput): Promise<void> {
    this.calls.push(`setModel ${sessionId}`);
  }

  async setMode(sessionId: string, _input: SetModeInput): Promise<void> {
    this.calls.push(`setMode ${sessionId}`);
  }

  async getDiff(sessionId: string): Promise<AgentDiff> {
    this.calls.push(`getDiff ${sessionId}`);
    return { provider: this.id, sessionId, files: [] };
  }

  async getProviderUsage(): Promise<AgentProviderUsage | null> {
    return null;
  }

  async getSessionUsage(_sessionId: string): Promise<null> {
    return null;
  }

  init(context: AdapterContext): void {
    this.#context = context;
  }

  #requireContext(): AdapterContext {
    if (!this.#context) throw new AdapterError("internal", "init() was not called");
    return this.#context;
  }

  #assertAvailable(): void {
    if (this.#unavailable) {
      throw new AdapterError("provider_unavailable", `${this.id} is unavailable.`, { retryable: true });
    }
  }
}
