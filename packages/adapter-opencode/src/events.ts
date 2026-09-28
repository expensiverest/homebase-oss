import type { AdapterLogger } from "@homebase/adapter-sdk";
import {
  nowTimestamp,
  type AgentEvent,
  type AgentEventType,
  type AgentMessage,
  type AgentQuestionAnswerItem,
  type AgentSession,
  type AgentSessionState,
  type AgentToolCall,
} from "@homebase/protocol";

import { decisionToOptionId, toApprovalRequest, toQuestionRequest } from "./mapper.js";
import type { NativeEvent, NativeForm, NativePermissionRequest } from "./native.js";

interface AssistantAssembly {
  messageId: string;
  createdAt: string;
  parts: AgentMessage["parts"];
  textByIndex: Map<number, string>;
  reasoningByIndex: Map<number, string>;
  textPartId: Map<number, string>;
  reasoningPartId: Map<number, string>;
  toolPartIndex: Map<string, number>;
}

export interface SessionTrackerDeps {
  emit(event: AgentEvent): void;
  sessionSnapshot(sessionId: string): AgentSession | undefined;
  /** Applies state/model/mode changes to the adapter's session cache. */
  patchSession(sessionId: string, patch: Partial<AgentSession>): void;
  logger: AdapterLogger;
}

/**
 * Normalizes OpenCode's live event stream into Homebase events.
 *
 * Verified against OpenCode 2.0.18: text/reasoning deltas are addressed by
 * `assistantMessageID` + `ordinal`; tool calls move through
 * `session.tool.input.started` → `input.ended` → `called` → `success|failed`;
 * runs settle with `session.execution.succeeded|failed|interrupted`.
 * Unknown event types are ignored, never fatal.
 */
export class SessionEventTracker {
  readonly #deps: SessionTrackerDeps;
  readonly #assemblies = new Map<string, AssistantAssembly>();
  readonly #turnIds = new Map<string, string>();
  readonly #executing = new Set<string>();
  readonly #pendingPermissions = new Map<string, { sessionId: string; toolCallId: string | null }>();
  readonly #pendingForms = new Map<string, { sessionId: string; native: NativeForm }>();
  readonly #deniedTools = new Set<string>();
  readonly #unknownTypes = new Set<string>();

  constructor(deps: SessionTrackerDeps) {
    this.#deps = deps;
  }

  /** True while an execution is running for the session. */
  isExecuting(sessionId: string): boolean {
    return this.#executing.has(sessionId);
  }

  hasPending(sessionId: string): boolean {
    for (const pending of this.#pendingPermissions.values()) {
      if (pending.sessionId === sessionId) return true;
    }
    for (const pending of this.#pendingForms.values()) {
      if (pending.sessionId === sessionId) return true;
    }
    return false;
  }

  pendingPermission(requestId: string): { sessionId: string; toolCallId: string | null } | undefined {
    return this.#pendingPermissions.get(requestId);
  }

  pendingForm(requestId: string): { sessionId: string; native: NativeForm } | undefined {
    return this.#pendingForms.get(requestId);
  }

  /** Optimistically marks the tool behind a rejected approval as denied. */
  noteApprovalDecision(requestId: string, decision: "once" | "always" | "reject"): void {
    const pending = this.#pendingPermissions.get(requestId);
    if (decision === "reject" && pending?.toolCallId) {
      this.#deniedTools.add(pending.toolCallId);
    }
  }

  /** Registers a pending request discovered by reconciliation. */
  registerPermission(request: NativePermissionRequest, publicSessionId: string): void {
    if (this.#pendingPermissions.has(request.id)) return;
    const approval = { ...toApprovalRequest(request), sessionId: publicSessionId };
    this.#pendingPermissions.set(request.id, { sessionId: publicSessionId, toolCallId: approval.toolCallId ?? null });
    this.#emit(publicSessionId, "approval.requested", { approval });
    this.#refreshWaiting(publicSessionId);
  }

  /** Registers a pending form discovered by reconciliation. */
  registerForm(form: NativeForm, publicSessionId: string): void {
    if (this.#pendingForms.has(form.id)) return;
    const question = toQuestionRequest(form);
    if (!question) return;
    this.#pendingForms.set(form.id, { sessionId: publicSessionId, native: form });
    this.#emit(publicSessionId, "question.requested", { question: { ...question, sessionId: publicSessionId } });
    this.#refreshWaiting(publicSessionId);
  }

  /** True when a tracked approval/form is no longer pending provider-side. */
  isTrackedPermission(requestId: string): boolean {
    return this.#pendingPermissions.has(requestId);
  }

  isTrackedForm(requestId: string): boolean {
    return this.#pendingForms.has(requestId);
  }

  trackedPermissions(): string[] {
    return [...this.#pendingPermissions.keys()];
  }

  trackedForms(): string[] {
    return [...this.#pendingForms.keys()];
  }

  /** Marks a tracked request resolved because the provider no longer lists it. */
  resolveVanished(requestId: string): void {
    const permission = this.#pendingPermissions.get(requestId);
    if (permission) {
      this.#pendingPermissions.delete(requestId);
      this.#emit(permission.sessionId, "approval.resolved", {
        resolution: { requestId, optionId: "unknown", resolvedAt: nowTimestamp(), resolvedBy: "system" },
      });
      this.#refreshWaiting(permission.sessionId);
      return;
    }
    const form = this.#pendingForms.get(requestId);
    if (form) {
      this.#pendingForms.delete(requestId);
      this.#emit(form.sessionId, "question.resolved", {
        resolution: { requestId, answers: [], resolvedAt: nowTimestamp() },
      });
      this.#refreshWaiting(form.sessionId);
    }
  }

  /** Handles one native event. The caller guarantees the session is known. */
  handle(event: NativeEvent, sessionId: string): void {
    const data = event.data ?? {};
    switch (event.type) {
      case "session.execution.started": {
        this.#executing.add(sessionId);
        const turnId = event.id;
        this.#turnIds.set(sessionId, turnId);
        this.#emit(sessionId, "turn.started", { turnId });
        this.#setState(sessionId, this.hasPending(sessionId) ? "waiting" : "working");
        return;
      }
      case "session.execution.succeeded": {
        this.#executing.delete(sessionId);
        this.#emit(sessionId, "turn.completed", { turnId: this.#turnIds.get(sessionId) ?? event.id });
        this.#turnIds.delete(sessionId);
        this.#setState(sessionId, this.hasPending(sessionId) ? "waiting" : "idle");
        return;
      }
      case "session.execution.failed": {
        this.#executing.delete(sessionId);
        this.#emit(sessionId, "turn.failed", {
          turnId: this.#turnIds.get(sessionId) ?? event.id,
          error: toNeutralError(data.error),
        });
        this.#turnIds.delete(sessionId);
        this.#setState(sessionId, "failed");
        return;
      }
      case "session.execution.interrupted": {
        this.#executing.delete(sessionId);
        this.#emit(sessionId, "turn.interrupted", { turnId: this.#turnIds.get(sessionId) ?? event.id });
        this.#turnIds.delete(sessionId);
        this.#setState(sessionId, this.hasPending(sessionId) ? "waiting" : "idle");
        return;
      }
      case "session.step.started": {
        const messageId = stringField(data, "assistantMessageID");
        if (!messageId) return;
        this.#finalizeAssembly(sessionId, "completed");
        this.#assemblies.set(sessionId, {
          messageId,
          createdAt: event.created !== undefined ? new Date(event.created).toISOString() : nowTimestamp(),
          parts: [],
          textByIndex: new Map(),
          reasoningByIndex: new Map(),
          textPartId: new Map(),
          reasoningPartId: new Map(),
          toolPartIndex: new Map(),
        });
        this.#emit(sessionId, "message.started", { message: this.#messageSnapshot(sessionId, "streaming") });
        return;
      }
      case "session.step.streamed":
        return;
      case "session.step.ended": {
        this.#finalizeAssembly(sessionId, "completed");
        return;
      }
      case "session.step.failed": {
        const error = data.error as { type?: string } | undefined;
        this.#finalizeAssembly(sessionId, error?.type === "aborted" ? "interrupted" : "failed");
        return;
      }
      case "session.text.started": {
        const assembly = this.#assembly(sessionId);
        const ordinal = numberField(data, "ordinal") ?? 0;
        this.#ensureTextPart(assembly, ordinal);
        this.#emit(sessionId, "message.updated", { message: this.#messageSnapshot(sessionId, "streaming") });
        return;
      }
      case "session.text.delta": {
        const assembly = this.#assembly(sessionId);
        const ordinal = numberField(data, "ordinal") ?? 0;
        const delta = stringField(data, "delta") ?? "";
        const partId = this.#ensureTextPart(assembly, ordinal);
        assembly.textByIndex.set(ordinal, (assembly.textByIndex.get(ordinal) ?? "") + delta);
        this.#emit(sessionId, "message.delta", { messageId: assembly.messageId, partId, delta });
        return;
      }
      case "session.text.ended": {
        const assembly = this.#assembly(sessionId);
        const ordinal = numberField(data, "ordinal") ?? 0;
        const text = stringField(data, "text");
        if (text !== undefined) {
          this.#ensureTextPart(assembly, ordinal);
          assembly.textByIndex.set(ordinal, text);
          this.#updateTextPart(assembly, ordinal, text);
        }
        return;
      }
      case "session.reasoning.started": {
        const assembly = this.#assembly(sessionId);
        const ordinal = numberField(data, "ordinal") ?? 0;
        const partId = this.#ensureReasoningPart(assembly, ordinal);
        this.#emit(sessionId, "reasoning.started", { messageId: assembly.messageId, partId, text: "" });
        return;
      }
      case "session.reasoning.delta": {
        const assembly = this.#assembly(sessionId);
        const ordinal = numberField(data, "ordinal") ?? 0;
        const delta = stringField(data, "delta") ?? "";
        const partId = this.#ensureReasoningPart(assembly, ordinal);
        assembly.reasoningByIndex.set(ordinal, (assembly.reasoningByIndex.get(ordinal) ?? "") + delta);
        this.#emit(sessionId, "reasoning.delta", { messageId: assembly.messageId, partId, delta });
        return;
      }
      case "session.reasoning.ended": {
        const assembly = this.#assembly(sessionId);
        const ordinal = numberField(data, "ordinal") ?? 0;
        const text = stringField(data, "text") ?? assembly.reasoningByIndex.get(ordinal) ?? "";
        const partId = this.#ensureReasoningPart(assembly, ordinal);
        assembly.reasoningByIndex.set(ordinal, text);
        this.#updateReasoningPart(assembly, ordinal, text);
        this.#emit(sessionId, "reasoning.completed", { messageId: assembly.messageId, partId, text });
        return;
      }
      case "session.tool.input.started": {
        const assembly = this.#assembly(sessionId);
        const toolId = stringField(data, "id");
        const name = stringField(data, "name") ?? "tool";
        if (!toolId) return;
        const toolCall: AgentToolCall = {
          id: toolId,
          name,
          status: "running",
          title: name,
          startedAt: event.created !== undefined ? new Date(event.created).toISOString() : nowTimestamp(),
        };
        this.#upsertToolPart(assembly, toolCall);
        this.#emit(sessionId, "tool.started", { toolCall });
        this.#emit(sessionId, "message.updated", { message: this.#messageSnapshot(sessionId, "streaming") });
        return;
      }
      case "session.tool.input.ended":
        return;
      case "session.tool.called": {
        const assembly = this.#assembly(sessionId);
        const toolId = stringField(data, "id");
        if (!toolId) return;
        const existing = this.#toolCall(assembly, toolId);
        const toolCall: AgentToolCall = {
          ...(existing ?? { id: toolId, name: "tool", status: "running" }),
          input: (data.input as AgentToolCall["input"]) ?? null,
        };
        this.#upsertToolPart(assembly, toolCall);
        this.#emit(sessionId, "tool.updated", { toolCall });
        return;
      }
      case "session.tool.progress": {
        const assembly = this.#assembly(sessionId);
        const toolId = stringField(data, "id");
        if (!toolId) return;
        const existing = this.#toolCall(assembly, toolId);
        if (!existing) return;
        this.#emit(sessionId, "tool.updated", { toolCall: existing });
        return;
      }
      case "session.tool.success": {
        const assembly = this.#assembly(sessionId);
        const toolId = stringField(data, "id");
        if (!toolId) return;
        const existing = this.#toolCall(assembly, toolId) ?? { id: toolId, name: "tool", status: "running" as const };
        const toolCall: AgentToolCall = {
          ...existing,
          status: "completed",
          output: mapToolContent(data.content),
          completedAt: event.created !== undefined ? new Date(event.created).toISOString() : nowTimestamp(),
        };
        this.#upsertToolPart(assembly, toolCall);
        this.#emit(sessionId, "tool.completed", { toolCall });
        this.#emit(sessionId, "message.updated", { message: this.#messageSnapshot(sessionId, "streaming") });
        return;
      }
      case "session.tool.failed": {
        const assembly = this.#assembly(sessionId);
        const toolId = stringField(data, "id");
        if (!toolId) return;
        const existing = this.#toolCall(assembly, toolId) ?? { id: toolId, name: "tool", status: "running" as const };
        const denied = this.#deniedTools.has(toolId);
        const toolCall: AgentToolCall = {
          ...existing,
          status: denied ? "denied" : "failed",
          error: denied ? "The user denied this tool call." : toErrorMessage(data.error),
          output: mapToolContent(data.content),
          completedAt: event.created !== undefined ? new Date(event.created).toISOString() : nowTimestamp(),
        };
        this.#upsertToolPart(assembly, toolCall);
        this.#emit(sessionId, "tool.failed", { toolCall });
        this.#emit(sessionId, "message.updated", { message: this.#messageSnapshot(sessionId, "streaming") });
        return;
      }
      case "session.model.selected": {
        const model = data.model as { id?: string; providerID?: string; variant?: string } | undefined;
        if (!model?.id || !model.providerID) return;
        this.#deps.patchSession(sessionId, {
          model: {
            provider: "opencode",
            modelId: `${model.providerID}/${model.id}`,
            thinkingLevel: model.variant ?? null,
          },
          thinkingLevel: model.variant ?? null,
          updatedAt: nowTimestamp(),
        });
        this.#emitSessionUpdated(sessionId);
        return;
      }
      case "session.agent.selected": {
        const agent = stringField(data, "agent");
        if (!agent) return;
        this.#deps.patchSession(sessionId, { mode: agent, updatedAt: nowTimestamp() });
        this.#emitSessionUpdated(sessionId);
        return;
      }
      case "session.deleted": {
        this.#cleanup(sessionId);
        this.#emit(sessionId, "session.deleted", { sessionId });
        return;
      }
      case "permission.asked": {
        const request = permissionRequestFromEvent(data);
        if (!request) return;
        const approval = { ...toApprovalRequest(request), sessionId };
        this.#pendingPermissions.set(request.id, { sessionId, toolCallId: approval.toolCallId ?? null });
        this.#emit(sessionId, "approval.requested", { approval });
        this.#refreshWaiting(sessionId);
        return;
      }
      case "permission.replied": {
        const requestId = stringField(data, "requestID") ?? stringField(data, "id");
        const reply = stringField(data, "reply") ?? stringField(data, "decision") ?? "reject";
        if (!requestId) return;
        const pending = this.#pendingPermissions.get(requestId);
        this.#pendingPermissions.delete(requestId);
        if (reply === "reject" && pending?.toolCallId) {
          this.#deniedTools.add(pending.toolCallId);
        }
        this.#emit(sessionId, "approval.resolved", {
          resolution: {
            requestId,
            optionId: decisionToOptionId(reply),
            resolvedAt: nowTimestamp(),
            resolvedBy: "user",
          },
        });
        this.#refreshWaiting(sessionId);
        return;
      }
      case "form.created": {
        const form = data.form as NativeForm | undefined;
        if (!form?.id || !form.sessionID) return;
        const question = toQuestionRequest(form);
        if (!question) return;
        this.#pendingForms.set(form.id, { sessionId, native: form });
        this.#emit(sessionId, "question.requested", { question: { ...question, sessionId } });
        this.#refreshWaiting(sessionId);
        return;
      }
      case "form.replied": {
        const formId = stringField(data, "id");
        if (!formId) return;
        const pending = this.#pendingForms.get(formId);
        this.#pendingForms.delete(formId);
        this.#emit(sessionId, "question.resolved", {
          resolution: {
            requestId: formId,
            answers: pending ? nativeAnswerToItems(pending.native, data.answer) : [],
            resolvedAt: nowTimestamp(),
          },
        });
        this.#refreshWaiting(sessionId);
        return;
      }
      case "form.cancelled": {
        const formId = stringField(data, "id");
        if (!formId) return;
        this.#pendingForms.delete(formId);
        this.#emit(sessionId, "question.resolved", {
          resolution: { requestId: formId, answers: [], resolvedAt: nowTimestamp() },
        });
        this.#refreshWaiting(sessionId);
        return;
      }
      default: {
        if (!this.#unknownTypes.has(event.type)) {
          this.#unknownTypes.add(event.type);
          this.#deps.logger.debug("Ignoring unrecognized OpenCode event type.", { type: event.type });
        }
        return;
      }
    }
  }

  /** Drops all runtime state for a session (deleted or out of scope). */
  #cleanup(sessionId: string): void {
    this.#assemblies.delete(sessionId);
    this.#turnIds.delete(sessionId);
    this.#executing.delete(sessionId);
    for (const [id, pending] of [...this.#pendingPermissions]) {
      if (pending.sessionId === sessionId) this.#pendingPermissions.delete(id);
    }
    for (const [id, pending] of [...this.#pendingForms]) {
      if (pending.sessionId === sessionId) this.#pendingForms.delete(id);
    }
  }

  #assembly(sessionId: string): AssistantAssembly {
    let assembly = this.#assemblies.get(sessionId);
    if (!assembly) {
      // Some providers/deltas can arrive without a step.started; synthesize one.
      assembly = {
        messageId: `msg_live_${sessionId}`,
        createdAt: nowTimestamp(),
        parts: [],
        textByIndex: new Map(),
        reasoningByIndex: new Map(),
        textPartId: new Map(),
        reasoningPartId: new Map(),
        toolPartIndex: new Map(),
      };
      this.#assemblies.set(sessionId, assembly);
      this.#emit(sessionId, "message.started", { message: this.#messageSnapshot(sessionId, "streaming") });
    }
    return assembly;
  }

  #ensureTextPart(assembly: AssistantAssembly, ordinal: number): string {
    const existing = assembly.textPartId.get(ordinal);
    if (existing) return existing;
    const partId = `${assembly.messageId}:text:${ordinal}`;
    assembly.textPartId.set(ordinal, partId);
    assembly.textByIndex.set(ordinal, "");
    assembly.parts.push({ type: "text", id: partId, text: "" });
    return partId;
  }

  #ensureReasoningPart(assembly: AssistantAssembly, ordinal: number): string {
    const existing = assembly.reasoningPartId.get(ordinal);
    if (existing) return existing;
    const partId = `${assembly.messageId}:reasoning:${ordinal}`;
    assembly.reasoningPartId.set(ordinal, partId);
    assembly.reasoningByIndex.set(ordinal, "");
    assembly.parts.push({ type: "reasoning", id: partId, text: "" });
    return partId;
  }

  #updateTextPart(assembly: AssistantAssembly, ordinal: number, text: string): void {
    const partId = assembly.textPartId.get(ordinal);
    const part = assembly.parts.find((candidate) => candidate.id === partId);
    if (part && part.type === "text") part.text = text;
  }

  #updateReasoningPart(assembly: AssistantAssembly, ordinal: number, text: string): void {
    const partId = assembly.reasoningPartId.get(ordinal);
    const part = assembly.parts.find((candidate) => candidate.id === partId);
    if (part && part.type === "reasoning") part.text = text;
  }

  #toolCall(assembly: AssistantAssembly, toolId: string): AgentToolCall | undefined {
    const index = assembly.toolPartIndex.get(toolId);
    if (index === undefined) return undefined;
    const part = assembly.parts[index];
    return part?.type === "tool_call" ? part.toolCall : undefined;
  }

  #upsertToolPart(assembly: AssistantAssembly, toolCall: AgentToolCall): void {
    const index = assembly.toolPartIndex.get(toolCall.id);
    if (index === undefined) {
      const partIndex = assembly.parts.length;
      assembly.parts.push({ type: "tool_call", id: toolCall.id, toolCall });
      assembly.toolPartIndex.set(toolCall.id, partIndex);
      return;
    }
    const part = assembly.parts[index];
    if (part?.type === "tool_call") {
      part.toolCall = toolCall;
    }
  }

  #messageSnapshot(sessionId: string, state: AgentMessage["state"]): AgentMessage {
    const assembly = this.#assembly(sessionId);
    return {
      id: assembly.messageId,
      sessionId,
      role: "assistant",
      createdAt: assembly.createdAt,
      updatedAt: nowTimestamp(),
      state,
      parts: structuredClone(assembly.parts),
    };
  }

  #finalizeAssembly(sessionId: string, state: AgentMessage["state"]): void {
    const assembly = this.#assemblies.get(sessionId);
    if (!assembly) return;
    for (const [ordinal, text] of assembly.textByIndex) this.#updateTextPart(assembly, ordinal, text);
    for (const [ordinal, text] of assembly.reasoningByIndex) this.#updateReasoningPart(assembly, ordinal, text);
    this.#emit(sessionId, "message.completed", { message: this.#messageSnapshot(sessionId, state) });
    this.#assemblies.delete(sessionId);
  }

  #setState(sessionId: string, state: AgentSessionState): void {
    this.#deps.patchSession(sessionId, { state, updatedAt: nowTimestamp() });
    this.#emitSessionUpdated(sessionId);
  }

  #refreshWaiting(sessionId: string): void {
    const session = this.#deps.sessionSnapshot(sessionId);
    if (!session) return;
    const nextState: AgentSessionState = this.hasPending(sessionId)
      ? "waiting"
      : this.#executing.has(sessionId)
        ? "working"
        : session.state === "waiting"
          ? "idle"
          : session.state;
    if (nextState !== session.state) {
      this.#setState(sessionId, nextState);
    }
  }

  #emitSessionUpdated(sessionId: string): void {
    const session = this.#deps.sessionSnapshot(sessionId);
    if (!session) return;
    this.#emit(sessionId, "session.updated", { session });
  }

  #emit<T extends AgentEventType>(sessionId: string, type: T, data: Extract<AgentEvent, { type: T }>["data"]): void {
    const session = this.#deps.sessionSnapshot(sessionId);
    this.#deps.emit({
      type,
      provider: "opencode",
      projectId: session?.projectId ?? null,
      sessionId,
      occurredAt: nowTimestamp(),
      data,
    } as AgentEvent);
  }
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toNeutralError(error: unknown): { code: "provider_error"; message: string } {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return { code: "provider_error", message };
    }
  }
  if (typeof error === "string" && error.length > 0) {
    return { code: "provider_error", message: error };
  }
  return { code: "provider_error", message: "The run failed." };
}

function toErrorMessage(error: unknown): string {
  return toNeutralError(error).message;
}

function mapToolContent(content: unknown): AgentToolCall["output"] | null {
  if (!Array.isArray(content) || content.length === 0) return null;
  const mapped: Array<Record<string, string>> = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { type?: unknown; text?: unknown; mime?: unknown; name?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      mapped.push({ type: "text", text: record.text });
    } else if (record.type === "file") {
      mapped.push({
        type: "file",
        name: typeof record.name === "string" ? record.name : "file",
        mime: String(record.mime ?? ""),
      });
    }
  }
  return mapped.length > 0 ? mapped : null;
}

function permissionRequestFromEvent(data: Record<string, unknown>): NativePermissionRequest | null {
  const candidate = (data.request ?? data) as Partial<NativePermissionRequest>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.sessionID !== "string" ||
    typeof candidate.action !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    sessionID: candidate.sessionID,
    action: candidate.action,
    resources: Array.isArray(candidate.resources)
      ? candidate.resources.filter((r): r is string => typeof r === "string")
      : [],
    save: Array.isArray(candidate.save) ? candidate.save.filter((s): s is string => typeof s === "string") : undefined,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    source:
      typeof candidate.source === "object" && candidate.source !== null
        ? (candidate.source as Record<string, unknown>)
        : undefined,
  };
}

function nativeAnswerToItems(form: NativeForm, answer: unknown): AgentQuestionAnswerItem[] {
  if (typeof answer !== "object" || answer === null) return [];
  const record = answer as Record<string, unknown>;
  const items: AgentQuestionAnswerItem[] = [];
  for (const field of form.fields) {
    if (!(field.key in record)) continue;
    const value = record[field.key];
    if (Array.isArray(value)) {
      items.push({ questionId: field.key, selectedOptionIds: value.map((entry) => String(entry)) });
    } else if (typeof value === "boolean") {
      items.push({ questionId: field.key, confirmed: value });
    } else if (value !== undefined && value !== null) {
      // Fields with options answered by value are selections, not free text.
      if (field.options && field.options.length > 0) {
        items.push({ questionId: field.key, selectedOptionIds: [String(value)] });
      } else {
        items.push({ questionId: field.key, text: String(value) });
      }
    }
  }
  return items;
}
