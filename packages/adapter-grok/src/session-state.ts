import { createPublicId, type AdapterLogger } from "@homebase/adapter-sdk";
import {
  nowTimestamp,
  type AgentContentPart,
  type AgentEvent,
  type AgentMessage,
  type AgentMode,
  type AgentPage,
  type AgentSession,
  type AgentToolCall,
  type PageRequest,
  type ProjectId,
  type ProviderId,
  type SessionId,
} from "@homebase/protocol";
import type {
  ContentChunk,
  Plan,
  SessionConfigOption,
  SessionModeState,
  SessionNotification,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";

import {
  mergeToolCall,
  modelRefFromConfigOptions,
  modesFromModeState,
  planFromEntries,
  selectionFromConfigOptions,
} from "./mapper.js";

export interface GrokSessionRecord {
  nativeId: string;
  publicId: SessionId;
  projectId: ProjectId;
  cwd: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Session state. `unknown` is used for cold sessions discovered through
   * `session/list` that Homebase has not driven itself; `idle` is reserved for
   * sessions Homebase created or completed its own turn on.
   */
  state: AgentSession["state"];
  configOptions: SessionConfigOption[];
  availableModes: AgentMode[];
  modeId: string | null;
  /** True for provider sessions Homebase has not opened itself (listed only). */
  cold: boolean;
  /** Chronological normalized history, including the streaming message. */
  messages: AgentMessage[];
  tools: Map<string, AgentToolCall>;
  pendingPermissions: Set<string>;
  replaying: boolean;
  /**
   * The most recent locally accepted prompt whose provider echo has not been
   * fully associated yet. Real Grok does not live-echo user messages without an
   * extension Homebase deliberately does not use, so authoritative history is
   * recorded locally; if a provider does echo, the echo is merged here instead
   * of producing a duplicate user message.
   */
  pendingLocalUser: PendingLocalUser | null;
  /** Fallback counter used to build deterministic ids outside live turns. */
  fallbackCounter: number;
}

interface PendingLocalUser {
  messageId: string;
  text: string;
  /** True once the provider's live echo has been associated with this message. */
  echoSeen: boolean;
  /** ACP message ids observed for the associated echo. */
  nativeMessageIds: Set<string>;
}

export interface LocalUserAttachment {
  id: string;
  kind: "image" | "file";
  name: string;
  mimeType: string;
  sizeBytes?: number | null;
}

export interface LocalUserMessageInput {
  text: string;
  attachments?: LocalUserAttachment[];
}

interface TurnState {
  turnId: string;
  messageCounter: number;
  /** ACP messageId -> Homebase message id (deterministic once assigned). */
  messageIdByNative: Map<string, string>;
  currentMessageId: string | null;
  /** messageId -> reasoning part id. */
  reasoningPartByMessage: Map<string, string>;
  /** toolCallId -> part id. */
  toolPartById: Map<string, string>;
}

export type TurnOutcome = { kind: "completed" } | { kind: "interrupted" } | { kind: "failed"; message: string };

export interface GrokSessionTrackerOptions {
  provider: ProviderId;
  emit(event: AgentEvent): void;
  logger?: AdapterLogger;
  now?: () => string;
}

/**
 * Per-session normalized state for the Grok adapter.
 *
 * Owns message assembly (text, reasoning, tools, plans), the replay/live
 * distinction for `session/load`, and session metadata. It emits only
 * Homebase-normalized events and never exposes raw ACP payloads.
 */
export class GrokSessionTracker {
  readonly #provider: ProviderId;
  readonly #emit: (event: AgentEvent) => void;
  readonly #logger: AdapterLogger | undefined;
  readonly #now: () => string;
  readonly #sessions = new Map<string, GrokSessionRecord>();
  readonly #byPublicId = new Map<SessionId, GrokSessionRecord>();
  readonly #turns = new Map<string, TurnState>();

  constructor(options: GrokSessionTrackerOptions) {
    this.#provider = options.provider;
    this.#emit = options.emit;
    this.#logger = options.logger;
    this.#now = options.now ?? nowTimestamp;
  }

  registerSession(options: {
    nativeId: string;
    projectId: ProjectId;
    cwd: string;
    title?: string | null;
    configOptions?: SessionConfigOption[] | null;
    modeState?: SessionModeState | null;
    cold?: boolean;
  }): GrokSessionRecord {
    const existing = this.#sessions.get(options.nativeId);
    if (existing) {
      if (options.projectId) existing.projectId = options.projectId;
      if (options.cwd) existing.cwd = options.cwd;
      if (options.title !== undefined) existing.title = options.title;
      if (options.configOptions) existing.configOptions = options.configOptions;
      if (options.modeState) {
        existing.availableModes = modesFromModeState(options.modeState);
        existing.modeId = options.modeState.currentModeId;
      }
      if (options.cold === false) existing.cold = false;
      return existing;
    }
    const record: GrokSessionRecord = {
      nativeId: options.nativeId,
      publicId: createPublicId(this.#provider, options.nativeId),
      projectId: options.projectId,
      cwd: options.cwd,
      title: options.title ?? null,
      createdAt: this.#now(),
      updatedAt: this.#now(),
      // A cold/discovered session may be running elsewhere; claiming `idle`
      // would be false certainty, so it starts as `unknown` until Homebase's
      // own turn lifecycle gives evidence.
      state: options.cold ? "unknown" : "idle",
      configOptions: options.configOptions ?? [],
      availableModes: modesFromModeState(options.modeState),
      modeId: options.modeState?.currentModeId ?? null,
      cold: options.cold ?? false,
      messages: [],
      tools: new Map(),
      pendingPermissions: new Set(),
      replaying: false,
      pendingLocalUser: null,
      fallbackCounter: 0,
    };
    this.#sessions.set(options.nativeId, record);
    this.#byPublicId.set(record.publicId, record);
    return record;
  }

  get(nativeId: string): GrokSessionRecord | undefined {
    return this.#sessions.get(nativeId);
  }

  getByPublicId(publicId: SessionId): GrokSessionRecord | undefined {
    return this.#byPublicId.get(publicId);
  }

  all(): GrokSessionRecord[] {
    return [...this.#sessions.values()];
  }

  toAgentSession(record: GrokSessionRecord): AgentSession {
    const selection = selectionFromConfigOptions(record.configOptions);
    return {
      id: record.publicId,
      provider: this.#provider,
      projectId: record.projectId,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      state: this.#sessionState(record),
      model: modelRefFromConfigOptions(record.configOptions, this.#provider),
      mode: record.modeId,
      thinkingLevel: selection.thinkingLevel,
    };
  }

  #sessionState(record: GrokSessionRecord): AgentSession["state"] {
    // A pending approval is actionable and takes precedence over "working",
    // matching the shared Host/UI convention: the user must act before the
    // turn can continue.
    if (record.pendingPermissions.size > 0) return "waiting";
    if (this.#turns.has(record.nativeId)) return "working";
    return record.state;
  }

  /** True when a prompt turn is currently active for the session. */
  isWorking(nativeId: string): boolean {
    return this.#turns.has(nativeId);
  }

  setProject(record: GrokSessionRecord, projectId: ProjectId): void {
    record.projectId = projectId;
  }

  /**
   * Marks a cold (listed but not opened) session as opened. The state is
   * deliberately left alone: replaying history is not evidence that a remote
   * session is idle. Only Homebase's own turn lifecycle resolves `unknown`.
   */
  markOpened(record: GrokSessionRecord): void {
    record.cold = false;
  }

  /**
   * Records a prompt Homebase accepted through `send()` in authoritative
   * history. Real Grok persists the user message but does not live-echo it
   * without the `x.ai/userMessageEcho` extension, so Homebase must not depend
   * on `user_message_chunk` for its own sends. No live events are emitted: the
   * client already has the optimistic message and history is authoritative.
   */
  recordLocalUserMessage(nativeId: string, input: LocalUserMessageInput): AgentMessage {
    const record = this.#require(nativeId);
    const message: AgentMessage = {
      id: `ul_${++record.fallbackCounter}`,
      sessionId: record.publicId,
      role: "user",
      createdAt: this.#now(),
      updatedAt: this.#now(),
      state: "completed",
      parts: [{ type: "text", id: "p0", text: input.text }, ...localAttachmentParts(input.attachments ?? [])],
    };
    record.messages.push(message);
    record.pendingLocalUser = {
      messageId: message.id,
      text: input.text,
      echoSeen: false,
      nativeMessageIds: new Set(),
    };
    record.updatedAt = this.#now();
    return message;
  }

  /** Creates a turn and emits `turn.started`. */
  beginTurn(nativeId: string): TurnState {
    const record = this.#require(nativeId);
    const turnId = `turn_${this.#now()}_${Math.random().toString(36).slice(2, 8)}`;
    const turn: TurnState = {
      turnId,
      messageCounter: 0,
      messageIdByNative: new Map(),
      currentMessageId: null,
      reasoningPartByMessage: new Map(),
      toolPartById: new Map(),
    };
    this.#turns.set(nativeId, turn);
    record.state = "working";
    this.#emit({
      type: "turn.started",
      provider: this.#provider,
      projectId: record.projectId,
      sessionId: record.publicId,
      occurredAt: this.#now(),
      data: { turnId },
    });
    return turn;
  }

  /** Completes the turn: finishes streaming parts and emits the terminal event. */
  finishTurn(nativeId: string, outcome: TurnOutcome): void {
    const record = this.#require(nativeId);
    const turn = this.#turns.get(nativeId);
    if (!turn) return;
    this.#turns.delete(nativeId);
    // The prompt is settled: any provider echo association window is closed, so
    // an identical later prompt is never deduplicated against this one.
    record.pendingLocalUser = null;
    this.#completeCurrentMessage(
      record,
      turn,
      outcome.kind === "failed" ? "failed" : outcome.kind === "interrupted" ? "interrupted" : "completed",
    );
    record.state = outcome.kind === "failed" ? "failed" : "idle";
    record.updatedAt = this.#now();
    const base = {
      type: "turn.completed" as const,
      provider: this.#provider,
      projectId: record.projectId,
      sessionId: record.publicId,
      occurredAt: this.#now(),
      data: { turnId: turn.turnId },
    };
    if (outcome.kind === "completed") {
      this.#emit(base);
    } else if (outcome.kind === "interrupted") {
      this.#emit({
        type: "turn.interrupted",
        provider: this.#provider,
        projectId: record.projectId,
        sessionId: record.publicId,
        occurredAt: this.#now(),
        data: { turnId: turn.turnId },
      });
    } else {
      this.#emit({
        type: "turn.failed",
        provider: this.#provider,
        projectId: record.projectId,
        sessionId: record.publicId,
        occurredAt: this.#now(),
        data: {
          turnId: turn.turnId,
          error: {
            code: "provider_error",
            message: outcome.message.slice(0, 500),
            provider: this.#provider,
            retryable: false,
          },
        },
      });
    }
    this.#emitSessionUpdated(record);
  }

  /** Marks a session as replaying history via `session/load`. */
  beginReplay(nativeId: string): void {
    const record = this.#require(nativeId);
    record.replaying = true;
    // Replay is authoritative history from the provider; never inject a local
    // user message into it and never associate replay chunks with a live send.
    record.pendingLocalUser = null;
  }

  endReplay(nativeId: string): void {
    const record = this.#require(nativeId);
    record.replaying = false;
    record.updatedAt = this.#now();
  }

  isReplaying(nativeId: string): boolean {
    return this.#sessions.get(nativeId)?.replaying ?? false;
  }

  /**
   * Applies a `session/update`. Live updates emit normalized events; replay
   * updates only build history so a resumed session is not re-emitted as a new
   * live turn.
   */
  handleUpdate(notification: SessionNotification): void {
    const record = this.#sessions.get(notification.sessionId);
    if (!record) {
      this.#logger?.debug("Ignoring Grok update for an unknown session.");
      return;
    }
    const update = notification.update;
    switch (update.sessionUpdate) {
      case "user_message_chunk":
        this.#applyUserChunk(record, update);
        return;
      case "agent_message_chunk":
        this.#applyAgentChunk(record, update, "text");
        return;
      case "agent_thought_chunk":
        this.#applyAgentChunk(record, update, "reasoning");
        return;
      case "tool_call":
        this.#applyToolCall(record, update);
        return;
      case "tool_call_update":
        this.#applyToolUpdate(record, update);
        return;
      case "plan":
        this.#applyPlan(record, update);
        return;
      case "current_mode_update":
        record.modeId = update.currentModeId;
        record.updatedAt = this.#now();
        this.#emitSessionUpdated(record);
        return;
      case "config_option_update":
        record.configOptions = update.configOptions;
        record.updatedAt = this.#now();
        this.#emitSessionUpdated(record);
        return;
      case "session_info_update":
        if (update.title !== undefined) record.title = update.title;
        record.updatedAt = this.#now();
        this.#emitSessionUpdated(record);
        return;
      default:
        // Unknown/extension update kinds are ignored safely.
        return;
    }
  }

  #applyUserChunk(record: GrokSessionRecord, chunk: ContentChunk): void {
    const nativeId = chunk.messageId ?? null;
    const pending = record.pendingLocalUser;
    if (pending && !record.replaying) {
      // Deduplicate against the most recently accepted local prompt only, never
      // by global text matching. The first live echo associates with the local
      // message; continuation chunks (same ACP message id, or no id at all
      // while this prompt is the active association) are ignored because the
      // local text is authoritative for the submitted prompt.
      if (!pending.echoSeen) {
        pending.echoSeen = true;
        if (nativeId) pending.nativeMessageIds.add(nativeId);
        return;
      }
      if (nativeId === null || pending.nativeMessageIds.has(nativeId)) {
        return;
      }
      // A different ACP message id is a genuinely separate user message.
    }
    const text = chunk.content.type === "text" ? chunk.content.text : "";
    if (!text) return;
    const messageId = this.#nativeMessageId(record, nativeId, "user");
    const message = this.#ensureMessage(record, messageId, "user");
    this.#appendTextPart(message, text);
    message.state = "completed";
    message.updatedAt = this.#now();
  }

  #applyAgentChunk(record: GrokSessionRecord, chunk: ContentChunk, kind: "text" | "reasoning"): void {
    if (chunk.content.type !== "text") return;
    const turn = this.#turns.get(record.nativeId) ?? null;
    if (!turn && !record.replaying) return; // live chunk outside a turn is not state we can attribute
    const text = chunk.content.text;
    if (!text) return;
    const messageId = turn
      ? this.#resolveTurnMessageId(record, turn, chunk.messageId ?? null)
      : this.#nativeMessageId(record, chunk.messageId ?? null, "assistant");
    const message = this.#ensureMessage(record, messageId, "assistant");
    if (kind === "reasoning") {
      const partId = turn
        ? this.#reasoningPartId(turn, messageId)
        : (message.parts.find((part) => part.type === "reasoning")?.id ?? "r0");
      this.#appendTextPart(message, text, partId, "reasoning");
      if (!record.replaying) {
        this.#emit({
          type: "reasoning.delta",
          provider: this.#provider,
          projectId: record.projectId,
          sessionId: record.publicId,
          occurredAt: this.#now(),
          data: { messageId, partId, delta: text },
        });
      }
      return;
    }
    const partId = this.#textPartId(message);
    this.#appendTextPart(message, text, partId, "text");
    if (!record.replaying) {
      this.#emit({
        type: "message.delta",
        provider: this.#provider,
        projectId: record.projectId,
        sessionId: record.publicId,
        occurredAt: this.#now(),
        data: { messageId, partId, delta: text },
      });
    }
  }

  #applyToolCall(record: GrokSessionRecord, update: ToolCall): void {
    const turn = this.#turns.get(record.nativeId) ?? null;
    const message = this.#ensureToolMessage(record, turn);
    const current = record.tools.get(update.toolCallId) ?? null;
    const toolCall = mergeToolCall(current, update);
    const isNew = current === null;
    record.tools.set(toolCall.id, toolCall);
    this.#upsertToolPart(message, update.toolCallId, toolCall);
    if (!record.replaying) {
      this.#emit({
        type: isNew ? "tool.started" : "tool.updated",
        provider: this.#provider,
        projectId: record.projectId,
        sessionId: record.publicId,
        occurredAt: this.#now(),
        data: { toolCall },
      });
      this.#emitMessageUpdated(record, message);
    }
  }

  #applyToolUpdate(record: GrokSessionRecord, update: ToolCallUpdate): void {
    const current = record.tools.get(update.toolCallId) ?? null;
    if (!current) return; // updates for unknown tool calls are ignored
    const toolCall = mergeToolCall(current, update);
    record.tools.set(toolCall.id, toolCall);
    const turn = this.#turns.get(record.nativeId) ?? null;
    const message = this.#ensureToolMessage(record, turn);
    this.#upsertToolPart(message, update.toolCallId, toolCall);
    if (!record.replaying) {
      const type =
        toolCall.status === "completed"
          ? "tool.completed"
          : toolCall.status === "failed"
            ? "tool.failed"
            : "tool.updated";
      this.#emit({
        type,
        provider: this.#provider,
        projectId: record.projectId,
        sessionId: record.publicId,
        occurredAt: this.#now(),
        data: { toolCall },
      });
      this.#emitMessageUpdated(record, message);
    }
  }

  #applyPlan(record: GrokSessionRecord, update: Plan): void {
    const turn = this.#turns.get(record.nativeId) ?? null;
    const message = this.#ensureToolMessage(record, turn);
    const plan = planFromEntries("grok_plan", update.entries);
    const partId = "plan_0";
    const existingIndex = message.parts.findIndex((part) => part.type === "plan");
    const part: AgentContentPart = { type: "plan", id: partId, plan };
    if (existingIndex >= 0) message.parts[existingIndex] = part;
    else message.parts.push(part);
    message.updatedAt = this.#now();
    if (!record.replaying) {
      this.#emit({
        type: "plan.updated",
        provider: this.#provider,
        projectId: record.projectId,
        sessionId: record.publicId,
        occurredAt: this.#now(),
        data: { plan, messageId: message.id },
      });
      this.#emitMessageUpdated(record, message);
    }
  }

  /** Assembles a newest-first page from stored history. */
  listMessages(record: GrokSessionRecord, page: PageRequest = {}): AgentPage<AgentMessage> {
    const limit = Math.max(1, Math.min(page.limit ?? 50, 200));
    const total = record.messages.length;
    let end = total;
    if (page.cursor) {
      const decoded = decodeCursor(page.cursor);
      if (decoded !== null) end = Math.min(total, Math.max(0, decoded));
    }
    const start = Math.max(0, end - limit);
    const items = record.messages
      .slice(start, end)
      .reverse()
      .map((message) => structuredClone(message));
    return {
      items,
      nextCursor: start > 0 ? encodeCursor(start) : null,
      previousCursor: null,
    };
  }

  #require(nativeId: string): GrokSessionRecord {
    const record = this.#sessions.get(nativeId);
    if (!record) throw new Error(`Unknown Grok session "${nativeId}".`);
    return record;
  }

  #nativeMessageId(record: GrokSessionRecord, nativeId: string | null, role: "user" | "assistant"): string {
    if (nativeId) return `${role === "user" ? "um" : "am"}_${nativeId}`;
    const turn = this.#turns.get(record.nativeId);
    if (turn) return `${turn.turnId}_m${++turn.messageCounter}`;
    return `${role}_${++record.fallbackCounter}`;
  }

  #resolveTurnMessageId(record: GrokSessionRecord, turn: TurnState, nativeId: string | null): string {
    if (nativeId) {
      const existing = turn.messageIdByNative.get(nativeId);
      if (existing) return existing;
      const messageId = `am_${nativeId}`;
      turn.messageIdByNative.set(nativeId, messageId);
      if (turn.currentMessageId && turn.currentMessageId !== messageId) {
        this.#completeMessageById(record, turn.currentMessageId, "completed");
      }
      turn.currentMessageId = messageId;
      return messageId;
    }
    if (turn.currentMessageId) return turn.currentMessageId;
    const messageId = `${turn.turnId}_m${++turn.messageCounter}`;
    turn.currentMessageId = messageId;
    return messageId;
  }

  #ensureMessage(record: GrokSessionRecord, messageId: string, role: AgentMessage["role"]): AgentMessage {
    const existing = record.messages.find((message) => message.id === messageId);
    if (existing) return existing;
    const message: AgentMessage = {
      id: messageId,
      sessionId: record.publicId,
      role,
      createdAt: this.#now(),
      updatedAt: this.#now(),
      state: "streaming",
      parts: [],
    };
    record.messages.push(message);
    if (!record.replaying) {
      this.#emit({
        type: "message.started",
        provider: this.#provider,
        projectId: record.projectId,
        sessionId: record.publicId,
        occurredAt: this.#now(),
        data: { message: structuredClone(message) },
      });
    }
    return message;
  }

  #ensureToolMessage(record: GrokSessionRecord, turn: TurnState | null): AgentMessage {
    if (turn?.currentMessageId) {
      const existing = record.messages.find((message) => message.id === turn.currentMessageId);
      if (existing) return existing;
    }
    if (!turn) {
      // A tool update outside a known turn (for example during replay) attaches
      // to the most recent assistant message or creates a standalone one.
      for (let index = record.messages.length - 1; index >= 0; index -= 1) {
        const candidate = record.messages[index];
        if (candidate?.role === "assistant") return candidate;
      }
    }
    const messageId = turn ? `${turn.turnId}_m${++turn.messageCounter}` : `assistant_${++record.fallbackCounter}`;
    if (turn) turn.currentMessageId = messageId;
    return this.#ensureMessage(record, messageId, "assistant");
  }

  #textPartId(message: AgentMessage): string {
    const last = message.parts.at(-1);
    if (last?.type === "text") return last.id;
    return `p${message.parts.length}`;
  }

  #reasoningPartId(turn: TurnState, messageId: string): string {
    const existing = turn.reasoningPartByMessage.get(messageId);
    if (existing) return existing;
    const partId = `r${turn.reasoningPartByMessage.size}`;
    turn.reasoningPartByMessage.set(messageId, partId);
    return partId;
  }

  #appendTextPart(message: AgentMessage, text: string, partId?: string, kind: "text" | "reasoning" = "text"): void {
    const id = partId ?? this.#textPartId(message);
    const existing = message.parts.find((part) => part.id === id);
    if (existing && existing.type === kind) {
      existing.text += text;
    } else if (!existing) {
      message.parts.push(kind === "reasoning" ? { type: "reasoning", id, text } : { type: "text", id, text });
    }
    message.updatedAt = this.#now();
  }

  #upsertToolPart(message: AgentMessage, toolCallId: string, toolCall: AgentToolCall): void {
    const partId = `tool_${toolCallId}`;
    const index = message.parts.findIndex((part) => part.type === "tool_call" && part.id === partId);
    const part: AgentContentPart = { type: "tool_call", id: partId, toolCall };
    if (index >= 0) message.parts[index] = part;
    else message.parts.push(part);
    message.updatedAt = this.#now();
  }

  #emitMessageUpdated(record: GrokSessionRecord, message: AgentMessage): void {
    if (record.replaying) return;
    this.#emit({
      type: "message.updated",
      provider: this.#provider,
      projectId: record.projectId,
      sessionId: record.publicId,
      occurredAt: this.#now(),
      data: { message: structuredClone(message) },
    });
  }

  #completeMessageById(record: GrokSessionRecord, messageId: string, state: AgentMessage["state"]): void {
    const message = record.messages.find((candidate) => candidate.id === messageId);
    if (!message || message.state !== "streaming") return;
    message.state = state;
    message.updatedAt = this.#now();
    if (!record.replaying) {
      this.#emit({
        type: "message.completed",
        provider: this.#provider,
        projectId: record.projectId,
        sessionId: record.publicId,
        occurredAt: this.#now(),
        data: { message: structuredClone(message) },
      });
    }
  }

  #completeCurrentMessage(record: GrokSessionRecord, turn: TurnState, state: AgentMessage["state"]): void {
    if (turn.currentMessageId) {
      this.#completeMessageById(record, turn.currentMessageId, state);
      turn.currentMessageId = null;
      return;
    }
    // Complete any still-streaming message from this turn.
    for (const message of record.messages) {
      if (message.state === "streaming") {
        message.state = state;
        message.updatedAt = this.#now();
        if (!record.replaying) {
          this.#emit({
            type: "message.completed",
            provider: this.#provider,
            projectId: record.projectId,
            sessionId: record.publicId,
            occurredAt: this.#now(),
            data: { message: structuredClone(message) },
          });
        }
      }
    }
  }

  #emitSessionUpdated(record: GrokSessionRecord): void {
    record.updatedAt = this.#now();
    this.#emit({
      type: "session.updated",
      provider: this.#provider,
      projectId: record.projectId,
      sessionId: record.publicId,
      occurredAt: this.#now(),
      data: { session: this.toAgentSession(record) },
    });
  }

  addPendingPermission(nativeId: string, publicRequestId: string): void {
    this.#require(nativeId).pendingPermissions.add(publicRequestId);
  }

  removePendingPermission(nativeId: string, publicRequestId: string): void {
    this.#sessions.get(nativeId)?.pendingPermissions.delete(publicRequestId);
  }

  /** Replaces the session's config options and publishes a session update. */
  updateConfigOptions(record: GrokSessionRecord, options: SessionConfigOption[]): void {
    record.configOptions = options;
    this.#emitSessionUpdated(record);
  }

  /** Publishes a session update after external state (pending approvals) changed. */
  notifyStateChanged(record: GrokSessionRecord): void {
    this.#emitSessionUpdated(record);
  }

  updateMode(record: GrokSessionRecord, modeId: string): void {
    record.modeId = modeId;
    this.#emitSessionUpdated(record);
  }

  removeSession(nativeId: string): void {
    const record = this.#sessions.get(nativeId);
    if (!record) return;
    this.#sessions.delete(nativeId);
    this.#byPublicId.delete(record.publicId);
    this.#turns.delete(nativeId);
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");
}

/** Attachment metadata only; bytes continue to flow through the ACP prompt. */
function localAttachmentParts(attachments: LocalUserAttachment[]): AgentContentPart[] {
  return attachments.map((attachment, index) => {
    const id = `p${index + 1}`;
    if (attachment.kind === "image") {
      return {
        type: "image",
        id,
        attachmentId: attachment.id,
        mimeType: attachment.mimeType,
        name: attachment.name,
      };
    }
    return {
      type: "file",
      id,
      attachmentId: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      ...(attachment.sizeBytes !== undefined && attachment.sizeBytes !== null
        ? { sizeBytes: attachment.sizeBytes }
        : {}),
    };
  });
}

function decodeCursor(cursor: string): number | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: number; offset?: number };
    if (parsed.v !== 1 || typeof parsed.offset !== "number") return null;
    return parsed.offset;
  } catch {
    return null;
  }
}
