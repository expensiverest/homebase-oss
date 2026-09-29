import {
  nowTimestamp,
  sequencedAgentEventSchema,
  type AgentAttachmentRef,
  type AgentEvent,
  type AgentMessage,
  type AgentToolCall,
  type SequencedAgentEvent,
} from "@homebase/protocol";
import { create } from "zustand";

import { openEventStream, type SseMessage } from "./sse.js";
import { authHeaders } from "./transport.js";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "auth-required";

export interface SessionOverlay {
  /** Live messages keyed by id, in arrival order. */
  messages: AgentMessage[];
  running: boolean;
  /** When the current turn started (the `turn.started` event's time); absent when not observed live. */
  runStartedAt?: string;
  /** Fetched history should be refetched (terminal event or resync). */
  stale: boolean;
}

export interface OverlayState {
  sessions: Record<string, SessionOverlay>;
  lastSequence: number;
}

export function createOverlayState(): OverlayState {
  return { sessions: {}, lastSequence: 0 };
}

function overlayFor(state: OverlayState, sessionId: string): SessionOverlay {
  return state.sessions[sessionId] ?? { messages: [], running: false, stale: false };
}

function withSession(state: OverlayState, sessionId: string, overlay: SessionOverlay): OverlayState {
  return { ...state, sessions: { ...state.sessions, [sessionId]: overlay } };
}

function upsertMessage(messages: AgentMessage[], message: AgentMessage): AgentMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index === -1) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}

function updateMessage(
  messages: AgentMessage[],
  messageId: string,
  update: (message: AgentMessage) => AgentMessage,
): AgentMessage[] {
  return messages.map((message) => (message.id === messageId ? update(message) : message));
}

function upsertToolPart(message: AgentMessage, toolCall: AgentToolCall): AgentMessage {
  const parts = [...message.parts];
  const index = parts.findIndex((part) => part.type === "tool_call" && part.toolCall.id === toolCall.id);
  if (index === -1) {
    parts.push({ type: "tool_call", id: `tool:${toolCall.id}`, toolCall });
  } else {
    parts[index] = { type: "tool_call", id: parts[index]?.id ?? toolCall.id, toolCall };
  }
  return { ...message, parts };
}

function placeholderMessage(sessionId: string, messageId: string): AgentMessage {
  return {
    id: messageId,
    sessionId,
    role: "assistant",
    createdAt: nowTimestamp(),
    state: "streaming",
    parts: [],
  };
}

/**
 * Pure overlay reducer for normalized events.
 *
 * Returns null when an event is a duplicate (sequence already applied) or has
 * no client-side overlay effect. Sequence numbers are the de-duplication
 * mechanism; messages upsert by message id, parts by part id, tools by tool
 * call id.
 */
export function reduceOverlay(state: OverlayState, event: SequencedAgentEvent): OverlayState | null {
  if (event.sequence <= state.lastSequence) return null;
  const advanced: OverlayState = { ...state, lastSequence: event.sequence };
  const sessionId = event.sessionId;

  switch (event.type) {
    case "session.created":
    case "session.updated": {
      let next = advanced;
      if (!next.sessions[event.data.session.id]) {
        next = withSession(next, event.data.session.id, { messages: [], running: false, stale: false });
      }
      return next;
    }
    case "session.deleted": {
      const sessions = { ...advanced.sessions };
      delete sessions[event.data.sessionId];
      return { ...advanced, sessions };
    }
    case "turn.started": {
      if (!sessionId) return advanced;
      const overlay = overlayFor(advanced, sessionId);
      return withSession(advanced, sessionId, {
        ...overlay,
        running: true,
        runStartedAt: event.occurredAt,
        stale: false,
      });
    }
    case "turn.completed":
    case "turn.failed":
    case "turn.interrupted": {
      if (!sessionId) return advanced;
      const overlay = overlayFor(advanced, sessionId);
      return withSession(advanced, sessionId, { ...overlay, running: false, runStartedAt: undefined, stale: true });
    }
    case "message.started":
    case "message.updated":
    case "message.completed": {
      const message = event.data.message;
      const overlay = overlayFor(advanced, message.sessionId);
      return withSession(advanced, message.sessionId, {
        ...overlay,
        messages: upsertMessage(overlay.messages, message),
      });
    }
    case "message.delta": {
      if (!sessionId) return advanced;
      const overlay = overlayFor(advanced, sessionId);
      const { messageId, partId, delta } = event.data;
      let messages = overlay.messages;
      let message = messages.find((candidate) => candidate.id === messageId);
      if (!message) {
        message = placeholderMessage(sessionId, messageId);
        messages = upsertMessage(messages, message);
      }
      messages = updateMessage(messages, messageId, (current) => {
        const parts = [...current.parts];
        const index = parts.findIndex((part) => part.id === partId);
        if (index === -1) {
          parts.push({ type: "text", id: partId, text: delta });
        } else {
          const part = parts[index];
          if (part && part.type === "text") parts[index] = { ...part, text: part.text + delta };
        }
        return { ...current, parts };
      });
      return withSession(advanced, sessionId, { ...overlay, messages });
    }
    case "reasoning.started": {
      if (!sessionId) return advanced;
      const overlay = overlayFor(advanced, sessionId);
      const { messageId, partId, text } = event.data;
      let messages = overlay.messages;
      if (!messages.some((candidate) => candidate.id === messageId)) {
        messages = upsertMessage(messages, placeholderMessage(sessionId, messageId));
      }
      messages = updateMessage(messages, messageId, (current) => {
        if (current.parts.some((part) => part.id === partId)) return current;
        return { ...current, parts: [...current.parts, { type: "reasoning", id: partId, text: text ?? "" }] };
      });
      return withSession(advanced, sessionId, { ...overlay, messages });
    }
    case "reasoning.delta": {
      if (!sessionId) return advanced;
      const overlay = overlayFor(advanced, sessionId);
      const { messageId, partId, delta } = event.data;
      let messages = overlay.messages;
      if (!messages.some((candidate) => candidate.id === messageId)) {
        messages = upsertMessage(messages, placeholderMessage(sessionId, messageId));
      }
      messages = updateMessage(messages, messageId, (current) => {
        const parts = [...current.parts];
        const index = parts.findIndex((part) => part.id === partId);
        if (index === -1) parts.push({ type: "reasoning", id: partId, text: delta });
        else {
          const part = parts[index];
          if (part?.type === "reasoning") parts[index] = { ...part, text: part.text + delta };
        }
        return { ...current, parts };
      });
      return withSession(advanced, sessionId, { ...overlay, messages });
    }
    case "reasoning.completed": {
      if (!sessionId) return advanced;
      const overlay = overlayFor(advanced, sessionId);
      const { messageId, partId, text } = event.data;
      if (text === undefined) return advanced;
      const messages = updateMessage(overlay.messages, messageId, (current) => {
        const parts = current.parts.map((part) =>
          part.id === partId && part.type === "reasoning" ? { ...part, text } : part,
        );
        return { ...current, parts };
      });
      return withSession(advanced, sessionId, { ...overlay, messages });
    }
    case "tool.started":
    case "tool.updated":
    case "tool.completed":
    case "tool.failed": {
      if (!sessionId) return advanced;
      const overlay = overlayFor(advanced, sessionId);
      const toolCall = event.data.toolCall;
      // Tool events do not carry a message id; update the newest message that
      // already contains this tool, or the newest streaming message.
      const target =
        overlay.messages.find((message) =>
          message.parts.some((part) => part.type === "tool_call" && part.toolCall.id === toolCall.id),
        ) ??
        [...overlay.messages].reverse().find((message) => message.state === "streaming") ??
        overlay.messages[overlay.messages.length - 1];
      if (!target) return advanced;
      const messages = updateMessage(overlay.messages, target.id, (message) => upsertToolPart(message, toolCall));
      return withSession(advanced, sessionId, { ...overlay, messages });
    }
    default:
      return advanced;
  }
}

export interface LiveStore extends OverlayState {
  connection: ConnectionStatus;
  resyncCount: number;
  setConnection(status: ConnectionStatus): void;
  apply(event: SequencedAgentEvent): void;
  markStale(sessionId: string): void;
  /** Append an optimistic user message until fetched history contains it. */
  addOptimisticUserMessage(sessionId: string, text: string, attachments: AgentAttachmentRef[]): void;
  /** Drop overlay messages now present in fetched history. */
  prune(sessionId: string, fetched: AgentMessage[]): void;
  resetOverlay(sessionId?: string): void;
}

function messageText(message: AgentMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n\n")
    .trim();
}

export const useLive = create<LiveStore>((set, get) => ({
  ...createOverlayState(),
  connection: "connecting",
  resyncCount: 0,
  setConnection: (connection) => set({ connection }),
  apply: (event) => {
    const next = reduceOverlay(get(), event);
    if (!next) return;
    set(next);
    persistSequence(event.sequence);
  },
  markStale: (sessionId) => {
    const overlay = overlayFor(get(), sessionId);
    set(withSession(get(), sessionId, { ...overlay, stale: true }));
  },
  addOptimisticUserMessage: (sessionId, text, attachments) => {
    const overlay = overlayFor(get(), sessionId);
    const id = `optimistic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const parts: AgentMessage["parts"] = [{ type: "text", id: `${id}:text`, text }];
    attachments.forEach((attachment, index) => {
      if (attachment.kind === "image") {
        parts.push({
          type: "image",
          id: `${id}:att:${index}`,
          attachmentId: attachment.id,
          mimeType: attachment.mimeType,
          name: attachment.name,
        });
      } else {
        parts.push({
          type: "file",
          id: `${id}:att:${index}`,
          attachmentId: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        });
      }
    });
    const message: AgentMessage = {
      id,
      sessionId,
      role: "user",
      createdAt: nowTimestamp(),
      state: "completed",
      parts,
    };
    set(withSession(get(), sessionId, { ...overlay, messages: upsertMessage(overlay.messages, message) }));
  },
  prune: (sessionId, fetched) => {
    const overlay = get().sessions[sessionId];
    if (!overlay) return;
    const fetchedIds = new Set(fetched.map((message) => message.id));
    const fetchedUserText = new Set(fetched.filter((message) => message.role === "user").map(messageText));
    const messages = overlay.messages.filter((message) => {
      // Optimistic user messages are replaced as soon as history contains them,
      // even mid-run; id-matched messages wait until the run ends so an older
      // fetched snapshot never clobbers a streaming one.
      if (message.role === "user" && fetchedUserText.has(messageText(message))) return false;
      if (!overlay.running && fetchedIds.has(message.id)) return false;
      return true;
    });
    set(withSession(get(), sessionId, { ...overlay, messages }));
  },
  resetOverlay: (sessionId) => {
    if (!sessionId) {
      set({ ...createOverlayState(), resyncCount: get().resyncCount + 1 });
      return;
    }
    const sessions = { ...get().sessions };
    delete sessions[sessionId];
    set({ sessions, resyncCount: get().resyncCount + 1 });
  },
}));

const SEQUENCE_KEY = "hb.lastSequence";

function persistSequence(sequence: number): void {
  try {
    sessionStorage.setItem(SEQUENCE_KEY, String(sequence));
  } catch {
    // Storage can be unavailable in private modes; replay is best-effort.
  }
}

export function readLastSequence(): number {
  try {
    const raw = sessionStorage.getItem(SEQUENCE_KEY);
    const value = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function clearLastSequence(): void {
  try {
    sessionStorage.removeItem(SEQUENCE_KEY);
  } catch {
    // ignore
  }
}

export type InvalidationEvent = AgentEvent | { type: "resync" };
type Invalidator = (event: InvalidationEvent) => void;

let invalidator: Invalidator | null = null;

export function registerInvalidator(next: Invalidator | null): void {
  invalidator = next;
}

let controller: AbortController | null = null;
let running = false;
let retryDelayMs = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleMessage(message: SseMessage): void {
  if (message.event === "auth.revoked") {
    window.dispatchEvent(new Event("homebase:auth-lost"));
    return;
  }
  if (message.event === "ready") {
    useLive.getState().setConnection("connected");
    return;
  }
  if (message.event === "resync") {
    useLive.getState().resetOverlay();
    invalidator?.({ type: "resync" });
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(message.data);
  } catch {
    return;
  }
  const parsed = sequencedAgentEventSchema.safeParse(json);
  if (!parsed.success) {
    if (import.meta.env.DEV) console.warn("Ignoring malformed Homebase event", parsed.error.issues);
    return;
  }
  useLive.getState().apply(parsed.data as SequencedAgentEvent);
  invalidator?.(parsed.data as SequencedAgentEvent);
}

async function runLoop(): Promise<void> {
  running = true;
  while (running) {
    controller = new AbortController();
    const since = Math.max(useLive.getState().lastSequence, readLastSequence());
    try {
      useLive.getState().setConnection(since > 0 ? "reconnecting" : "connecting");
      const stream = openEventStream({
        url: since > 0 ? `/api/v1/events?since=${since}` : "/api/v1/events",
        headers: authHeaders(),
        signal: controller.signal,
        onOpen: () => {
          retryDelayMs = 1_000;
          useLive.getState().setConnection("connected");
        },
      });
      for await (const message of stream) {
        if (!running) break;
        handleMessage(message);
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        useLive.getState().setConnection("auth-required");
        running = false;
        return;
      }
    }
    if (!running) return;
    useLive.getState().setConnection("reconnecting");
    const jitter = Math.floor(Math.random() * retryDelayMs * 0.4);
    await sleep(retryDelayMs + jitter);
    retryDelayMs = Math.min(retryDelayMs * 2, 15_000);
  }
}

/** Starts (or restarts) the single global event stream. */
export function startLiveStream(): void {
  if (running) return;
  void runLoop();
}

export function stopLiveStream(): void {
  running = false;
  controller?.abort();
  controller = null;
}

/** Used after app suspension to restore the stream quickly. */
export function reconnectNow(): void {
  retryDelayMs = 250;
  controller?.abort();
  if (!running) startLiveStream();
}

export function installVisibilityReconnect(): () => void {
  const handler = () => {
    if (document.visibilityState === "visible") reconnectNow();
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
