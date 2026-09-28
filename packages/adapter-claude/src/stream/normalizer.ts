import { nowTimestamp, type AgentEventType, type AgentMessage, type AgentToolCall } from "@homebase/protocol";

import type {
  NativeAssistantFrame,
  NativeContentBlock,
  NativeFrame,
  NativeResultFrame,
  NativeStreamEventFrame,
  NativeUsage,
  NativeUserFrame,
} from "../native.js";

export interface NormalizerDeps {
  /** Emits a normalized event for a native session (adapter maps to public id). */
  emit(type: AgentEventType, nativeSessionId: string, data: Record<string, unknown>): void;
  /** Marks a tool call as denied (approval rejection bookkeeping). */
  markDenied(nativeSessionId: string, toolUseId: string): void;
  isDenied(nativeSessionId: string, toolUseId: string): boolean;
  /** A result frame settled the turn; adapter updates session state/usage. */
  onResult(nativeSessionId: string, frame: NativeResultFrame): void;
  /** Model reported by an assistant frame (used for snapshot fidelity). */
  onModelSeen(nativeSessionId: string, model: string): void;
  onUsage(nativeSessionId: string, usage: NativeUsage): void;
  onRateLimit(nativeSessionId: string, info: NonNullable<NativeFrame["rate_limit_info"]>): void;
  onInit(nativeSessionId: string, frame: NativeFrame): void;
  logDebug(message: string, fields?: Record<string, unknown>): void;
}

interface Assembly {
  messageId: string;
  createdAt: string;
  parts: AgentMessage["parts"];
  partIdByIndex: Map<number, string>;
  textByIndex: Map<number, string>;
  toolPartIndex: Map<string, number>;
  stopSeen: boolean;
  model?: string;
}

interface Runtime {
  assembly: Assembly | null;
  /** Completed message snapshots still addressable by tool results. */
  snapshots: Map<string, AgentMessage>;
  toolMessage: Map<string, string>;
  activeTurn: boolean;
  turnCounter: number;
  turnId: string | null;
  unknownTypes: Set<string>;
}

/** Terminal classification: interrupted wins over the error flags. */
export function classifyResultFrame(frame: NativeResultFrame): "completed" | "failed" | "interrupted" {
  const reason = String(frame.terminal_reason ?? "");
  if (reason.startsWith("aborted_")) return "interrupted";
  if (frame.is_error === true || String(frame.subtype ?? "").startsWith("error")) return "failed";
  return "completed";
}

function isAborted(reason: string | undefined): boolean {
  return typeof reason === "string" && reason.startsWith("aborted_");
}

function toolContentToJson(content: unknown): AgentToolCall["output"] {
  if (typeof content === "string") return content.length > 0 ? { type: "text", text: content } : null;
  if (!Array.isArray(content)) return null;
  const mapped: Array<Record<string, string>> = [];
  for (const block of content) {
    if (typeof block === "string") {
      mapped.push({ type: "text", text: block });
      continue;
    }
    if (typeof block !== "object" || block === null) continue;
    const record = block as { type?: unknown; text?: unknown; name?: unknown; mime?: unknown };
    if (record.type === "text" && typeof record.text === "string") mapped.push({ type: "text", text: record.text });
    else if (record.type === "image")
      mapped.push({ type: "image", name: typeof record.name === "string" ? record.name : "image" });
    else if (typeof record.name === "string")
      mapped.push({ type: "file", name: record.name, mime: String(record.mime ?? "") });
  }
  return mapped.length > 0 ? (mapped as unknown as AgentToolCall["output"]) : null;
}

/**
 * Turns Claude stream-json frames into normalized Homebase events.
 *
 * Verified behaviors encoded here (Claude Code 2.1.268):
 * - one logical assistant message can span several frames sharing `message.id`;
 * - text deltas are non-authoritative; complete assistant frames hold the text;
 * - `thinking` blocks are empty strings plus a signature — no reasoning events;
 * - `terminal_reason` starting with `aborted_` means interrupted, even though
 *   the result also carries `is_error:true`;
 * - tool results arrive on `user` frames and bind by `tool_use_id`.
 * Unknown frames are ignored, never fatal.
 */
export class ClaudeStreamNormalizer {
  readonly #deps: NormalizerDeps;
  readonly #runtimes = new Map<string, Runtime>();

  constructor(deps: NormalizerDeps) {
    this.#deps = deps;
  }

  /** True while a turn is running for the session. */
  isRunning(nativeSessionId: string): boolean {
    return this.#runtimes.get(nativeSessionId)?.activeTurn ?? false;
  }

  forget(nativeSessionId: string): void {
    this.#runtimes.delete(nativeSessionId);
  }

  feed(frame: NativeFrame, nativeSessionId: string): void {
    const runtime = this.#runtime(nativeSessionId);
    switch (frame.type) {
      case "system":
        if (frame.subtype === "init") this.#deps.onInit(nativeSessionId, frame);
        return;
      case "stream_event":
        this.#onStreamEvent(frame as NativeStreamEventFrame, runtime, nativeSessionId);
        return;
      case "assistant":
        this.#onAssistant(frame as NativeAssistantFrame, runtime, nativeSessionId);
        return;
      case "user":
        this.#onUser(frame as NativeUserFrame, runtime, nativeSessionId);
        return;
      case "result":
        this.#onResult(frame as NativeResultFrame, runtime, nativeSessionId);
        return;
      case "rate_limit_event": {
        const info = (frame as { rate_limit_info?: Record<string, unknown> }).rate_limit_info;
        if (info) this.#deps.onRateLimit(nativeSessionId, info as never);
        return;
      }
      case "control_response":
        return; // controller correlates these
      default: {
        if (!runtime.unknownTypes.has(frame.type)) {
          runtime.unknownTypes.add(frame.type);
          this.#deps.logDebug("Ignoring unrecognized Claude frame type.", { type: frame.type });
        }
        return;
      }
    }
  }

  #runtime(nativeSessionId: string): Runtime {
    let runtime = this.#runtimes.get(nativeSessionId);
    if (!runtime) {
      runtime = {
        assembly: null,
        snapshots: new Map(),
        toolMessage: new Map(),
        activeTurn: false,
        turnCounter: 0,
        turnId: null,
        unknownTypes: new Set(),
      };
      this.#runtimes.set(nativeSessionId, runtime);
    }
    return runtime;
  }

  #ensureAssembly(runtime: Runtime, nativeSessionId: string, messageId: string): Assembly {
    let assembly = runtime.assembly;
    if (assembly && assembly.messageId !== messageId) {
      // A new message started; the previous one is complete.
      this.#finalize(runtime, nativeSessionId, "completed");
      assembly = null;
    }
    if (!assembly) {
      assembly = {
        messageId,
        createdAt: nowTimestamp(),
        parts: [],
        partIdByIndex: new Map(),
        textByIndex: new Map(),
        toolPartIndex: new Map(),
        stopSeen: false,
      };
      runtime.assembly = assembly;
      this.#ensureTurn(runtime, nativeSessionId);
      this.#deps.emit("message.started", nativeSessionId, {
        message: this.#snapshot(assembly, nativeSessionId),
      });
    }
    return assembly;
  }

  /** Ends the active turn and returns its turn id, or null when idle. */
  endTurn(nativeSessionId: string): string | null {
    const runtime = this.#runtimes.get(nativeSessionId);
    if (!runtime?.activeTurn) return null;
    runtime.activeTurn = false;
    const turnId = runtime.turnId;
    runtime.turnId = null;
    return turnId;
  }

  #ensureTurn(runtime: Runtime, nativeSessionId: string): void {
    if (runtime.activeTurn) return;
    runtime.activeTurn = true;
    runtime.turnCounter += 1;
    runtime.turnId = `turn_${nativeSessionId}_${runtime.turnCounter}`;
    this.#deps.emit("turn.started", nativeSessionId, { turnId: runtime.turnId });
  }

  #textPartId(assembly: Assembly, index: number): string {
    const existing = assembly.partIdByIndex.get(index);
    if (existing) return existing;
    const partId = `${assembly.messageId}:text:${index}`;
    assembly.partIdByIndex.set(index, partId);
    assembly.textByIndex.set(index, "");
    assembly.parts.push({ type: "text", id: partId, text: "" });
    return partId;
  }

  #toolCall(assembly: Assembly, toolUseId: string): AgentToolCall | undefined {
    const index = assembly.toolPartIndex.get(toolUseId);
    if (index === undefined) return undefined;
    const part = assembly.parts[index];
    return part?.type === "tool_call" ? part.toolCall : undefined;
  }

  #upsertTool(assembly: Assembly, toolCall: AgentToolCall): void {
    const index = assembly.toolPartIndex.get(toolCall.id);
    if (index === undefined) {
      assembly.toolPartIndex.set(toolCall.id, assembly.parts.length);
      assembly.parts.push({ type: "tool_call", id: toolCall.id, toolCall });
      return;
    }
    const part = assembly.parts[index];
    if (part?.type === "tool_call") part.toolCall = toolCall;
  }

  #snapshot(assembly: Assembly, nativeSessionId: string): AgentMessage {
    return {
      id: assembly.messageId,
      sessionId: nativeSessionId,
      role: "assistant",
      createdAt: assembly.createdAt,
      updatedAt: nowTimestamp(),
      state: "streaming",
      parts: structuredClone(assembly.parts),
    };
  }

  #onStreamEvent(frame: NativeStreamEventFrame, runtime: Runtime, nativeSessionId: string): void {
    const event = frame.event ?? {};
    switch (event.type) {
      case "message_start": {
        const messageId = event.message?.id;
        if (!messageId) return;
        const assembly = this.#ensureAssembly(runtime, nativeSessionId, messageId);
        if (typeof event.message?.model === "string") assembly.model = event.message.model;
        return;
      }
      case "content_block_start": {
        const assembly = runtime.assembly;
        if (!assembly) return;
        const index = typeof event.index === "number" ? event.index : 0;
        const block = event.content_block ?? {};
        if (block.type === "text") {
          this.#textPartId(assembly, index);
          this.#deps.emit("message.updated", nativeSessionId, { message: this.#snapshot(assembly, nativeSessionId) });
        } else if (block.type === "tool_use") {
          const toolUseId = typeof block.id === "string" ? block.id : `${assembly.messageId}:tool:${index}`;
          const name = typeof block.name === "string" ? block.name : "tool";
          const existing = this.#toolCall(assembly, toolUseId);
          const toolCall: AgentToolCall = existing ?? {
            id: toolUseId,
            name,
            status: "running",
            title: name,
            startedAt: nowTimestamp(),
          };
          this.#upsertTool(assembly, toolCall);
          runtime.toolMessage.set(toolUseId, assembly.messageId);
          if (!existing) this.#deps.emit("tool.started", nativeSessionId, { toolCall });
          else this.#deps.emit("tool.updated", nativeSessionId, { toolCall });
          this.#deps.emit("message.updated", nativeSessionId, { message: this.#snapshot(assembly, nativeSessionId) });
        }
        return;
      }
      case "content_block_delta": {
        const assembly = runtime.assembly;
        if (!assembly) return;
        const delta = event.delta ?? {};
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          const index = typeof event.index === "number" ? event.index : 0;
          const partId = this.#textPartId(assembly, index);
          const text = (assembly.textByIndex.get(index) ?? "") + delta.text;
          assembly.textByIndex.set(index, text);
          const part = assembly.parts.find((candidate) => candidate.id === partId);
          if (part?.type === "text") part.text = text;
          this.#deps.emit("message.delta", nativeSessionId, {
            messageId: assembly.messageId,
            partId,
            delta: delta.text,
          });
        }
        return;
      }
      case "message_delta": {
        if (event.usage) this.#deps.onUsage(nativeSessionId, event.usage);
        return;
      }
      case "message_stop": {
        if (runtime.assembly) runtime.assembly.stopSeen = true;
        return;
      }
      default:
        return;
    }
  }

  #onAssistant(frame: NativeAssistantFrame, runtime: Runtime, nativeSessionId: string): void {
    const messageId = frame.message?.id;
    if (!messageId) return;

    // Late assistant frames can arrive after the message was completed (for
    // example a tool_use block following the streamed text); merge into the
    // existing snapshot instead of starting a phantom second message.
    const snapshot = runtime.assembly?.messageId === messageId ? null : runtime.snapshots.get(messageId);
    if (snapshot) {
      this.#mergeAssistantBlocks(snapshot.parts, messageId, frame.message?.content ?? [], runtime, nativeSessionId);
      this.#deps.emit("message.updated", nativeSessionId, { message: structuredClone(snapshot) });
      return;
    }

    const assembly = this.#ensureAssembly(runtime, nativeSessionId, messageId);
    const model = frame.message?.model;
    if (typeof model === "string" && model.length > 0 && !model.startsWith("<")) {
      assembly.model = model;
      this.#deps.onModelSeen(nativeSessionId, model);
    }
    if (frame.message?.usage) this.#deps.onUsage(nativeSessionId, frame.message.usage);

    this.#mergeAssistantBlocks(
      assembly.parts,
      messageId,
      frame.message?.content ?? [],
      runtime,
      nativeSessionId,
      assembly,
    );
    this.#deps.emit("message.updated", nativeSessionId, { message: this.#snapshot(assembly, nativeSessionId) });
    if (assembly.stopSeen) {
      this.#finalize(runtime, nativeSessionId, "completed");
    }
  }

  /**
   * Applies assistant content blocks to a part list. Text is authoritative
   * (replaces accumulated deltas) and tool blocks upsert by tool id.
   */
  #mergeAssistantBlocks(
    parts: AgentMessage["parts"],
    messageId: string,
    content: NativeContentBlock[],
    runtime: Runtime,
    nativeSessionId: string,
    assembly?: Assembly,
  ): void {
    const findTool = (toolUseId: string): AgentToolCall | undefined => {
      const part = parts.find((candidate) => candidate.type === "tool_call" && candidate.toolCall.id === toolUseId);
      return part?.type === "tool_call" ? part.toolCall : undefined;
    };
    const upsertTool = (toolCall: AgentToolCall): void => {
      const index = parts.findIndex(
        (candidate) => candidate.type === "tool_call" && candidate.toolCall.id === toolCall.id,
      );
      if (index >= 0) {
        const part = parts[index];
        if (part?.type === "tool_call") part.toolCall = toolCall;
        return;
      }
      parts.push({ type: "tool_call", id: toolCall.id, toolCall });
    };

    let textIndex = 0;
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        const partId = assembly ? this.#textPartId(assembly, textIndex) : `${messageId}:text:${textIndex}`;
        const existing = parts.find((candidate) => candidate.id === partId);
        if (existing?.type === "text") existing.text = block.text;
        else parts.push({ type: "text", id: partId, text: block.text });
        if (assembly) assembly.textByIndex.set(textIndex, block.text);
        textIndex += 1;
      } else if (block.type === "tool_use") {
        const toolUseId = typeof block.id === "string" ? block.id : undefined;
        if (!toolUseId) continue;
        const name = typeof block.name === "string" ? block.name : "tool";
        const existing = findTool(toolUseId);
        const toolCall: AgentToolCall = {
          ...(existing ?? { id: toolUseId, name, status: "running" as const, startedAt: nowTimestamp() }),
          status:
            existing?.status === "completed" || existing?.status === "failed" || existing?.status === "denied"
              ? existing.status
              : "running",
          input: (block.input as AgentToolCall["input"]) ?? existing?.input ?? null,
        };
        upsertTool(toolCall);
        if (assembly) {
          const partIndex = assembly.parts.findIndex(
            (candidate) => candidate.type === "tool_call" && candidate.toolCall.id === toolUseId,
          );
          if (partIndex >= 0) assembly.toolPartIndex.set(toolUseId, partIndex);
        }
        runtime.toolMessage.set(toolUseId, messageId);
        if (!existing) this.#deps.emit("tool.started", nativeSessionId, { toolCall });
        else this.#deps.emit("tool.updated", nativeSessionId, { toolCall });
      }
      // `thinking` blocks are empty strings plus a signature: intentionally dropped.
    }
  }

  #onUser(frame: NativeUserFrame, runtime: Runtime, nativeSessionId: string): void {
    const content = frame.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content as NativeContentBlock[]) {
      if (block.type !== "tool_result") continue;
      const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
      if (!toolUseId) continue;
      const isError = block.is_error === true;
      const denied = this.#deps.isDenied(nativeSessionId, toolUseId);
      const messageId = runtime.toolMessage.get(toolUseId);
      const snapshot = messageId
        ? (runtime.snapshots.get(messageId) ??
          (runtime.assembly?.messageId === messageId ? this.#snapshot(runtime.assembly, nativeSessionId) : undefined))
        : undefined;
      const part = snapshot?.parts.find(
        (candidate) => candidate.type === "tool_call" && candidate.toolCall.id === toolUseId,
      );
      const existing = part?.type === "tool_call" ? part.toolCall : undefined;
      const toolCall: AgentToolCall = {
        ...(existing ?? { id: toolUseId, name: "tool", status: "running" as const }),
        status: denied ? "denied" : isError ? "failed" : "completed",
        output: toolContentToJson(block.content),
        ...(isError || denied
          ? { error: denied ? "The operator denied this tool call." : textFromToolContent(block.content) }
          : {}),
        completedAt: nowTimestamp(),
      };

      if (snapshot) {
        const target = snapshot.parts.find(
          (candidate) => candidate.type === "tool_call" && candidate.toolCall.id === toolUseId,
        );
        if (target?.type === "tool_call") target.toolCall = toolCall;
        this.#deps.emit("message.updated", nativeSessionId, { message: structuredClone(snapshot) });
      }
      if (toolCall.status === "completed") this.#deps.emit("tool.completed", nativeSessionId, { toolCall });
      else this.#deps.emit("tool.failed", nativeSessionId, { toolCall });
    }
  }

  #onResult(frame: NativeResultFrame, runtime: Runtime, nativeSessionId: string): void {
    const interrupted = isAborted(frame.terminal_reason);
    const failed = !interrupted && (frame.is_error === true || String(frame.subtype ?? "").startsWith("error"));

    for (const denial of frame.permission_denials ?? []) {
      if (typeof denial.tool_use_id === "string") this.#deps.markDenied(nativeSessionId, denial.tool_use_id);
    }

    this.#finalize(runtime, nativeSessionId, interrupted ? "interrupted" : failed ? "failed" : "completed");
    this.#deps.onResult(nativeSessionId, frame);
  }

  #finalize(runtime: Runtime, nativeSessionId: string, state: AgentMessage["state"]): void {
    const assembly = runtime.assembly;
    if (!assembly) return;
    runtime.assembly = null;
    const message: AgentMessage = {
      ...this.#snapshot(assembly, nativeSessionId),
      state,
    };
    runtime.snapshots.set(assembly.messageId, message);
    if (runtime.snapshots.size > 40) {
      const oldest = runtime.snapshots.keys().next().value;
      if (typeof oldest === "string") runtime.snapshots.delete(oldest);
    }
    this.#deps.emit("message.completed", nativeSessionId, { message });
  }
}

function textFromToolContent(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 500);
  if (!Array.isArray(content)) return "The tool failed.";
  const texts = content
    .map((block) =>
      typeof block === "string"
        ? block
        : typeof block === "object" && block !== null && (block as { type?: string }).type === "text"
          ? String((block as { text?: unknown }).text ?? "")
          : "",
    )
    .filter((text) => text.length > 0);
  const joined = texts.join("\n").trim();
  return joined.length > 0 ? joined.slice(0, 500) : "The tool failed.";
}
