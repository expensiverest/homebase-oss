import { randomUUID } from "node:crypto";

import {
  defineCapabilities,
  nowTimestamp,
  type AgentCapabilities,
  type AgentDiff,
  type AgentEvent,
  type AgentEventType,
  type AgentMessage,
  type AgentMode,
  type AgentModel,
  type AgentPage,
  type AgentProject,
  type AgentSession,
  type AgentToolCall,
  type AgentUsage,
  type ApprovalResult,
  type CreateSessionInput,
  type PageRequest,
  type ProviderDetection,
  type QuestionAnswer,
  type SendMessageInput,
  type SetModelInput,
  type SetModeInput,
} from "@homebase/protocol";

import type { AdapterContext, AgentAdapter } from "../adapter.js";
import { AdapterError, toAgentError } from "../errors.js";
import { createPublicId } from "../identity.js";

export interface MockAdapterOptions {
  id?: string;
  displayName?: string;
  /** Overrides for individual capability flags. */
  capabilities?: Partial<AgentCapabilities>;
  /** Delay between streamed chunks, in milliseconds. Use 0 in tests. */
  stepDelayMs?: number;
  /** Unresolved approvals/questions auto-resolve after this long. */
  approvalTimeoutMs?: number;
  detection?: Partial<ProviderDetection>;
}

interface MockSessionState {
  session: AgentSession;
  busy: boolean;
  abort: AbortController | null;
  queue: SendMessageInput[];
  /** History in chronological order. */
  messages: AgentMessage[];
}

const WORDS_PER_CHUNK = 2;
const DEFAULT_PAGE_SIZE = 50;

/**
 * Deterministic in-memory adapter used for Host development, protocol tests,
 * UI development, and as a worked example of the `AgentAdapter` contract.
 *
 * Prompt keywords trigger optional behavior:
 * - `approve` asks for approval before completing the turn
 * - `ask` asks a structured question
 * - `think` streams a reasoning part
 */
export class MockAdapter implements AgentAdapter {
  readonly id: string;
  readonly displayName: string;

  readonly #stepDelayMs: number;
  readonly #approvalTimeoutMs: number;
  readonly #detection: ProviderDetection;
  readonly #capabilities: AgentCapabilities;

  #context: AdapterContext | null = null;
  #counter = 0;
  readonly #sessions = new Map<string, MockSessionState>();
  readonly #pendingApprovals = new Map<string, (result: ApprovalResult) => void>();
  readonly #pendingQuestions = new Map<string, (answer: QuestionAnswer) => void>();

  constructor(options: MockAdapterOptions = {}) {
    this.id = options.id ?? "mock";
    this.displayName = options.displayName ?? "Mock Agent";
    this.#stepDelayMs = options.stepDelayMs ?? 5;
    this.#approvalTimeoutMs = options.approvalTimeoutMs ?? 30_000;
    this.#detection = {
      installed: true,
      authenticated: true,
      compatible: true,
      version: "0.0.1-mock",
      ...options.detection,
    };
    this.#capabilities = defineCapabilities({
      resume: true,
      deleteSession: true,
      streaming: true,
      interrupt: true,
      steer: true,
      queue: true,
      models: true,
      modelSwitching: true,
      thinkingLevels: true,
      modes: true,
      attachments: true,
      imageInput: true,
      tools: true,
      approvals: true,
      questions: true,
      plans: true,
      diffs: true,
      usage: true,
      // Deliberately unsupported: proves shared code can gate features per provider.
      slashCommands: false,
      ...options.capabilities,
    });
  }

  init(context: AdapterContext): void {
    this.#context = context;
  }

  async detect(): Promise<ProviderDetection> {
    return { ...this.#detection };
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    return { ...this.#capabilities };
  }

  async listModels(_project: AgentProject): Promise<AgentModel[]> {
    return [
      {
        id: "mock-alpha",
        provider: this.id,
        name: "Mock Alpha",
        description: "Deterministic model with thinking levels",
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        thinkingLevels: [
          { id: "low", name: "Low" },
          { id: "medium", name: "Medium" },
          { id: "high", name: "High" },
        ],
        defaultThinkingLevel: "medium",
        inputCapabilities: { text: true, image: true, file: true },
      },
      {
        id: "mock-beta",
        provider: this.id,
        name: "Mock Beta",
        description: "Fast deterministic text-only model",
        contextWindow: 32_000,
        maxOutputTokens: 4_096,
        inputCapabilities: { text: true, image: false, file: false },
      },
    ];
  }

  async listModes(_project: AgentProject): Promise<AgentMode[]> {
    return [
      { id: "default", name: "Standard", description: "Answer directly and use tools as needed." },
      { id: "plan", name: "Plan", description: "Produce a plan before making changes." },
    ];
  }

  async listSessions(project: AgentProject, page: PageRequest = {}): Promise<AgentPage<AgentSession>> {
    const sessions = [...this.#sessions.values()]
      .filter((state) => state.session.projectId === project.id)
      .map((state) => structuredClone(state.session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return paginate(sessions, page);
  }

  async getSession(sessionId: string): Promise<AgentSession> {
    return structuredClone(this.#require(sessionId).session);
  }

  async createSession(input: CreateSessionInput, project: AgentProject): Promise<AgentSession> {
    const timestamp = nowTimestamp();
    const session: AgentSession = {
      id: createPublicId(this.id, `ses_mock_${randomUUID().slice(0, 8)}`),
      provider: this.id,
      projectId: project.id,
      title: input.title ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: "idle",
      model: input.model ?? { provider: this.id, modelId: "mock-alpha", thinkingLevel: "medium" },
      mode: input.mode ?? "default",
      thinkingLevel: input.thinkingLevel ?? null,
    };
    this.#sessions.set(session.id, { session, busy: false, abort: null, queue: [], messages: [] });
    this.#emit(session, "session.created", { session: structuredClone(session) });
    return structuredClone(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const state = this.#require(sessionId);
    state.abort?.abort();
    this.#sessions.delete(sessionId);
    this.#emit(state.session, "session.deleted", { sessionId });
  }

  async listMessages(sessionId: string, page: PageRequest = {}): Promise<AgentPage<AgentMessage>> {
    const state = this.#require(sessionId);
    const newestFirst = [...state.messages].reverse();
    return paginate(
      newestFirst.map((message) => structuredClone(message)),
      page,
      100,
    );
  }

  async send(sessionId: string, input: SendMessageInput): Promise<void> {
    const state = this.#require(sessionId);
    await this.#recordUserMessage(state, input);
    if (state.busy) {
      state.queue.push(input);
      return;
    }
    void this.#runTurn(state, input.text);
  }

  async interrupt(sessionId: string): Promise<void> {
    const state = this.#require(sessionId);
    state.abort?.abort();
  }

  async steer(sessionId: string, input: SendMessageInput): Promise<void> {
    const state = this.#require(sessionId);
    if (!state.busy) {
      throw new AdapterError("session_not_active", "The session is not currently working.");
    }
    await this.#recordUserMessage(state, input);
    state.queue.push(input);
  }

  async queue(sessionId: string, input: SendMessageInput): Promise<void> {
    const state = this.#require(sessionId);
    if (!state.busy) {
      // Nothing to queue behind: behave like a normal send.
      await this.send(sessionId, input);
      return;
    }
    await this.#recordUserMessage(state, input);
    state.queue.push(input);
  }

  async resolveApproval(requestId: string, result: ApprovalResult): Promise<void> {
    const resolve = this.#pendingApprovals.get(requestId);
    if (!resolve) {
      throw new AdapterError("not_found", `No pending approval with id "${requestId}".`);
    }
    this.#pendingApprovals.delete(requestId);
    resolve(result);
  }

  async answerQuestion(requestId: string, answer: QuestionAnswer): Promise<void> {
    const resolve = this.#pendingQuestions.get(requestId);
    if (!resolve) {
      throw new AdapterError("not_found", `No pending question with id "${requestId}".`);
    }
    this.#pendingQuestions.delete(requestId);
    resolve(answer);
  }

  async setModel(sessionId: string, input: SetModelInput): Promise<void> {
    const state = this.#require(sessionId);
    state.session.model = {
      provider: this.id,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel ?? null,
    };
    state.session.thinkingLevel = input.thinkingLevel ?? null;
    state.session.updatedAt = nowTimestamp();
    this.#emit(state.session, "session.updated", { session: structuredClone(state.session) });
  }

  async setMode(sessionId: string, input: SetModeInput): Promise<void> {
    const state = this.#require(sessionId);
    state.session.mode = input.mode;
    state.session.updatedAt = nowTimestamp();
    this.#emit(state.session, "session.updated", { session: structuredClone(state.session) });
  }

  async getDiff(sessionId: string): Promise<AgentDiff> {
    const state = this.#require(sessionId);
    return {
      provider: this.id,
      projectId: state.session.projectId,
      sessionId,
      files: [
        {
          path: "src/example.ts",
          status: "modified",
          additions: 12,
          deletions: 3,
          patch: "@@ -1,3 +1,12 @@\n-export const answer = 41;\n+export const answer = 42;\n",
        },
        { path: "docs/notes.md", status: "added", additions: 4, deletions: 0 },
      ],
    };
  }

  async getUsage(): Promise<AgentUsage | null> {
    return {
      provider: this.id,
      planName: "Mock Plan",
      windows: [
        { id: "session", label: "Session", unit: "percent", usedPercent: 12.5 },
        { id: "weekly", label: "Week", unit: "percent", usedPercent: 47, resetsAt: "2026-01-07T00:00:00.000Z" },
      ],
      fetchedAt: nowTimestamp(),
    };
  }

  #require(sessionId: string): MockSessionState {
    const state = this.#sessions.get(sessionId);
    if (!state) {
      throw new AdapterError("session_not_found", `Unknown session "${sessionId}".`);
    }
    return state;
  }

  async #recordUserMessage(state: MockSessionState, input: SendMessageInput): Promise<void> {
    const parts: AgentMessage["parts"] = [{ type: "text", id: `part_${++this.#counter}`, text: input.text }];
    for (const ref of input.attachments ?? []) {
      if (!this.#context) {
        throw new AdapterError("internal", "MockAdapter.init() has not been called.");
      }
      const resolved = await this.#context.resolveAttachment(ref.id);
      parts.push({
        type: ref.kind === "image" ? "image" : "file",
        id: `part_${++this.#counter}`,
        attachmentId: resolved.id,
        name: resolved.filename,
        mimeType: resolved.mimeType,
        ...(ref.kind === "image" ? {} : { sizeBytes: resolved.size }),
      });
    }
    const message: AgentMessage = {
      id: `msg_${++this.#counter}`,
      sessionId: state.session.id,
      role: "user",
      createdAt: nowTimestamp(),
      state: "completed",
      parts,
    };
    state.messages.push(message);
    state.session.updatedAt = message.createdAt;
  }

  #emit<T extends AgentEventType>(
    session: Pick<AgentSession, "id" | "projectId"> | null,
    type: T,
    data: Extract<AgentEvent, { type: T }>["data"],
  ): void {
    const context = this.#context;
    if (!context) {
      throw new AdapterError("internal", "MockAdapter.init() has not been called.");
    }
    context.emit({
      type,
      provider: this.id,
      projectId: session?.projectId ?? null,
      sessionId: session?.id ?? null,
      occurredAt: nowTimestamp(),
      data,
    } as AgentEvent);
  }

  async #runTurn(state: MockSessionState, text: string): Promise<void> {
    const session = state.session;
    const turnId = `turn_${++this.#counter}`;
    const controller = new AbortController();
    state.busy = true;
    state.abort = controller;

    session.state = "working";
    session.updatedAt = nowTimestamp();
    this.#emit(session, "session.updated", { session: structuredClone(session) });
    this.#emit(session, "turn.started", { turnId });

    const message: AgentMessage = {
      id: `msg_${randomUUID().slice(0, 8)}`,
      sessionId: session.id,
      role: "assistant",
      createdAt: nowTimestamp(),
      state: "streaming",
      parts: [],
    };
    const textPartId = `part_${++this.#counter}`;
    const textPart = { type: "text" as const, id: textPartId, text: "" };
    const attachmentNote = (state.messages.at(-1)?.parts ?? [])
      .filter((part) => part.type === "image" || part.type === "file")
      .map((part) => (part.type === "image" || part.type === "file" ? part.name : undefined))
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    message.parts.push(textPart);
    this.#emit(session, "message.started", { message: structuredClone(message) });

    let replyText = `Mock reply to "${text}".`;
    if (attachmentNote.length > 0) {
      replyText += ` Received attachments: ${attachmentNote.join(", ")}.`;
    }

    try {
      if (/\bthink\b/i.test(text)) {
        const reasoningPartId = `part_${++this.#counter}`;
        const reasoningText = `Considering: ${text}`;
        this.#emit(session, "reasoning.started", { messageId: message.id, partId: reasoningPartId, text: "" });
        for (const chunk of splitChunks(text)) {
          await this.#sleep(controller.signal);
          this.#emit(session, "reasoning.delta", {
            messageId: message.id,
            partId: reasoningPartId,
            delta: ` ${chunk}`,
          });
        }
        this.#emit(session, "reasoning.completed", {
          messageId: message.id,
          partId: reasoningPartId,
          text: reasoningText,
        });
        message.parts.push({ type: "reasoning", id: reasoningPartId, text: reasoningText });
        this.#emit(session, "message.updated", { message: structuredClone(message) });
      }

      if (/\bapprove\b/i.test(text)) {
        const approved = await this.#requestApproval(session, text, controller.signal);
        replyText += approved ? " Approval granted." : " Approval denied.";
      }

      if (/\bask\b/i.test(text)) {
        const answer = await this.#requestQuestion(session, controller.signal);
        const selected = answer.answers[0]?.selectedOptionIds?.[0] ?? answer.answers[0]?.text ?? "no answer";
        replyText += ` You chose: ${selected}.`;
      }

      const toolCall: AgentToolCall = {
        id: `tool_${++this.#counter}`,
        name: "mock_tool",
        status: "running",
        title: "Mock tool",
        input: { command: text },
        startedAt: nowTimestamp(),
      };
      this.#emit(session, "tool.started", { toolCall });
      await this.#sleep(controller.signal);
      const completedTool: AgentToolCall = {
        ...toolCall,
        status: "completed",
        output: { ok: true },
        completedAt: nowTimestamp(),
      };
      this.#emit(session, "tool.completed", { toolCall: completedTool });
      message.parts.push({ type: "tool_call", id: completedTool.id, toolCall: completedTool });
      this.#emit(session, "message.updated", { message: structuredClone(message) });

      for (const chunk of splitChunks(replyText)) {
        await this.#sleep(controller.signal);
        textPart.text += chunk;
        this.#emit(session, "message.delta", { messageId: message.id, partId: textPartId, delta: chunk });
      }

      message.state = "completed";
      message.updatedAt = nowTimestamp();
      this.#emit(session, "message.completed", { message: structuredClone(message) });
      state.messages.push(structuredClone(message));
      this.#emit(session, "turn.completed", { turnId });
    } catch (error) {
      if (controller.signal.aborted) {
        message.state = "interrupted";
        message.updatedAt = nowTimestamp();
        this.#emit(session, "message.completed", { message: structuredClone(message) });
        state.messages.push(structuredClone(message));
        this.#emit(session, "turn.interrupted", { turnId });
      } else {
        this.#emit(session, "turn.failed", { turnId, error: toAgentError(error, { provider: this.id }) });
      }
    } finally {
      state.busy = false;
      state.abort = null;
      session.state = "idle";
      session.updatedAt = nowTimestamp();
      this.#emit(session, "session.updated", { session: structuredClone(session) });

      const next = state.queue.shift();
      if (next) {
        void this.#runTurn(state, next.text);
      }
    }
  }

  async #requestApproval(session: AgentSession, text: string, signal: AbortSignal): Promise<boolean> {
    const requestId = `apr_${++this.#counter}`;
    this.#emit(session, "approval.requested", {
      approval: {
        id: requestId,
        sessionId: session.id,
        provider: this.id,
        createdAt: nowTimestamp(),
        kind: "command",
        title: `Run command: ${text}`,
        detail: text,
        options: [
          { id: "allow_once", label: "Allow once", kind: "allow_once" },
          { id: "allow_always", label: "Always allow", kind: "allow_always" },
          { id: "deny", label: "Deny", kind: "deny" },
        ],
      },
    });

    const result = await new Promise<ApprovalResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingApprovals.delete(requestId);
        resolve({ optionId: "deny" });
      }, this.#approvalTimeoutMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          this.#pendingApprovals.delete(requestId);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
      this.#pendingApprovals.set(requestId, (approvalResult) => {
        clearTimeout(timer);
        resolve(approvalResult);
      });
    });

    this.#emit(session, "approval.resolved", {
      resolution: {
        requestId,
        optionId: result.optionId,
        resolvedAt: nowTimestamp(),
        resolvedBy: "user",
      },
    });
    return result.optionId !== "deny";
  }

  async #requestQuestion(session: AgentSession, signal: AbortSignal): Promise<QuestionAnswer> {
    const requestId = `qst_${++this.#counter}`;
    this.#emit(session, "question.requested", {
      question: {
        id: requestId,
        sessionId: session.id,
        provider: this.id,
        createdAt: nowTimestamp(),
        title: "Mock question",
        questions: [
          {
            id: "q0",
            header: "Mock choice",
            question: "Which option should the mock use?",
            kind: "single_select",
            options: [
              { id: "first", label: "First option" },
              { id: "second", label: "Second option" },
            ],
          },
        ],
      },
    });

    const answer = await new Promise<QuestionAnswer>((resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          this.#pendingQuestions.delete(requestId);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
      this.#pendingQuestions.set(requestId, resolve);
    });

    this.#emit(session, "question.resolved", {
      resolution: { requestId, answers: answer.answers, resolvedAt: nowTimestamp() },
    });
    return answer;
  }

  #sleep(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    if (this.#stepDelayMs <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, this.#stepDelayMs);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function paginate<T>(items: T[], page: PageRequest, defaultLimit = DEFAULT_PAGE_SIZE): AgentPage<T> {
  const limit = Math.max(1, Math.min(page.limit ?? defaultLimit, 500));
  let offset = 0;
  if (page.cursor) {
    const match = /^mock:(\d+)$/.exec(page.cursor);
    if (!match) {
      throw new AdapterError("invalid_request", "Invalid mock cursor.");
    }
    offset = Number(match[1]);
  }
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  return {
    items: slice,
    nextCursor: nextOffset < items.length ? `mock:${nextOffset}` : null,
    previousCursor: offset > 0 ? `mock:${Math.max(0, offset - limit)}` : null,
  };
}

function splitChunks(text: string): string[] {
  const chunks = text.match(/\S+\s*/g);
  if (!chunks) return [text];

  const grouped: string[] = [];
  for (let index = 0; index < chunks.length; index += WORDS_PER_CHUNK) {
    grouped.push(chunks.slice(index, index + WORDS_PER_CHUNK).join(""));
  }
  return grouped;
}
