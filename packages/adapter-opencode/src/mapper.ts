import { AdapterError } from "@homebase/adapter-sdk";
import {
  nowTimestamp,
  type AgentApprovalOption,
  type AgentApprovalRequest,
  type AgentDiff,
  type AgentDiffFile,
  type AgentMessage,
  type AgentMode,
  type AgentModel,
  type AgentModelRef,
  type AgentQuestion,
  type AgentQuestionRequest,
  type AgentSession,
  type AgentSessionState,
  type AgentToolCall,
  type JsonValue,
  type QuestionAnswer,
} from "@homebase/protocol";

import type {
  NativeAgent,
  NativeFileDiff,
  NativeForm,
  NativeMessage,
  NativeModel,
  NativeModelRef,
  NativePermissionRequest,
  NativeSession,
  NativeToolContent,
  NativeToolPart,
} from "./native.js";

export const OPENCODE_PROVIDER_ID = "opencode";

function isoFromEpoch(value: number | undefined | null, fallback?: number | undefined): string {
  const chosen = value ?? fallback;
  return chosen !== undefined && Number.isFinite(chosen) ? new Date(chosen).toISOString() : nowTimestamp();
}

/** Neutral model id: `<upstreamProvider>/<modelRefId>`, unique across providers. */
export function modelIdOf(providerID: string, id: string): string {
  return `${providerID}/${id}`;
}

export function parseModelId(modelId: string): { providerID: string; id: string } | null {
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) return null;
  return { providerID: modelId.slice(0, slash), id: modelId.slice(slash + 1) };
}

export function toAgentModelRef(ref: NativeModelRef): AgentModelRef {
  return {
    provider: OPENCODE_PROVIDER_ID,
    modelId: modelIdOf(ref.providerID, ref.id),
    thinkingLevel: ref.variant ?? null,
  };
}

export function toNativeModelRef(ref: AgentModelRef): NativeModelRef | null {
  const parsed = parseModelId(ref.modelId);
  if (!parsed) return null;
  return {
    id: parsed.id,
    providerID: parsed.providerID,
    ...(ref.thinkingLevel ? { variant: ref.thinkingLevel } : {}),
  };
}

const THINKING_LEVEL_NAMES: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export function toAgentModel(model: NativeModel): AgentModel {
  const inputs = model.capabilities?.input;
  const thinkingLevels = (model.variants ?? []).map((variant) => ({
    id: variant.id,
    name: THINKING_LEVEL_NAMES[variant.id] ?? variant.id.charAt(0).toUpperCase() + variant.id.slice(1),
  }));
  return {
    id: modelIdOf(model.providerID, model.id),
    provider: OPENCODE_PROVIDER_ID,
    name: model.name,
    contextWindow: model.limit?.context && model.limit.context > 0 ? model.limit.context : null,
    maxOutputTokens: model.limit?.output && model.limit.output > 0 ? model.limit.output : null,
    thinkingLevels: thinkingLevels.length > 0 ? thinkingLevels : undefined,
    deprecated: model.status === "deprecated" ? true : undefined,
    inputCapabilities: inputs
      ? {
          text: inputs.includes("text"),
          image: inputs.includes("image"),
          // Anything beyond inline text/image (pdf, audio, video) is an opaque file input.
          file: inputs.some((kind) => kind !== "text" && kind !== "image"),
        }
      : undefined,
  };
}

/** Primary, user-selectable agents become Homebase modes. */
export function toAgentMode(agent: NativeAgent): AgentMode {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description ?? null,
  };
}

export function toAgentSession(native: NativeSession, projectId: string, state: AgentSessionState): AgentSession {
  return {
    id: native.id,
    provider: OPENCODE_PROVIDER_ID,
    projectId,
    title: native.title ?? null,
    createdAt: isoFromEpoch(native.time.created),
    updatedAt: isoFromEpoch(native.time.updated, native.time.created),
    state,
    model: native.model ? toAgentModelRef(native.model) : null,
    mode: native.agent ?? null,
    thinkingLevel: native.model?.variant ?? null,
    ...(native.parentID ? { parentSessionId: native.parentID } : {}),
  };
}

function partId(messageId: string, kind: string, index: number): string {
  return `${messageId}:${kind}:${index}`;
}

function errorText(error: { type?: string; message?: string } | string | undefined): string {
  if (typeof error === "string") return error;
  return error?.message ?? "The tool failed.";
}

/** Never expose provider file URIs (paths or base64) through tool output. */
export function toToolOutput(content: NativeToolContent[] | undefined): JsonValue | undefined {
  if (!content || content.length === 0) return undefined;
  return content.map<JsonValue>((item) => {
    const mapped: Record<string, JsonValue> = {};
    if (item.type === "text") {
      mapped.type = "text";
      mapped.text = item.text;
    } else {
      mapped.type = "file";
      mapped.name = item.name ?? "file";
      mapped.mime = item.mime;
    }
    return mapped;
  });
}

/**
 * OpenCode's task tool records the sub-agent's own session in the tool's
 * `metadata.sessionId`. The link is only emitted for a well-formed id, wrapped
 * with `toPublicId` so it routes like every other session id.
 */
function childSessionOf(tool: NativeToolPart, toPublicId: (nativeId: string) => string): string | null {
  const state = tool.state;
  if (state.status === "streaming") return null;
  const value = state.metadata?.sessionId;
  return typeof value === "string" && value.length > 0 ? toPublicId(value) : null;
}

export function toAgentToolCall(
  tool: NativeToolPart,
  toPublicId: (nativeId: string) => string = (nativeId) => nativeId,
): AgentToolCall {
  const call = toBaseToolCall(tool);
  const childSessionId = childSessionOf(tool, toPublicId);
  return childSessionId ? { ...call, childSessionId } : call;
}

function toBaseToolCall(tool: NativeToolPart): AgentToolCall {
  const base = {
    id: tool.id,
    name: tool.name,
    title: tool.name,
    startedAt: isoFromEpoch(tool.time.created),
  };
  const state = tool.state;
  switch (state.status) {
    case "streaming":
      return { ...base, status: "running" };
    case "running":
      return { ...base, status: "running", input: state.input as JsonValue };
    case "completed":
      return {
        ...base,
        status: "completed",
        input: state.input as JsonValue,
        output: toToolOutput(state.content) ?? null,
        completedAt: isoFromEpoch(tool.time.completed, tool.time.created),
      };
    case "error":
      return {
        ...base,
        status: "failed",
        input: state.input as JsonValue,
        output: toToolOutput(state.content) ?? null,
        error: errorText(state.error),
        completedAt: isoFromEpoch(tool.time.completed, tool.time.created),
      };
  }
}

/**
 * Maps a native message to the neutral model. Internal-only messages
 * (synthetic, system, skills, compaction, shell) are intentionally skipped:
 * they are not user-visible conversation, and inventing bubbles for them would
 * be worse than their absence. `idle` markers drive session state instead.
 */
export function toAgentMessage(
  native: NativeMessage,
  sessionId: string,
  toPublicId?: (nativeId: string) => string,
): AgentMessage | null {
  switch (native.type) {
    case "user": {
      if (native.id === undefined) return null;
      const parts: AgentMessage["parts"] = [{ type: "text", id: partId(native.id, "text", 0), text: native.text }];
      for (const [index, file] of (native.files ?? []).entries()) {
        const mimeType = file.mime ?? "application/octet-stream";
        const name = file.name ?? "attachment";
        if (mimeType.startsWith("image/")) {
          parts.push({ type: "image", id: partId(native.id, "file", index), mimeType, name });
        } else {
          parts.push({ type: "file", id: partId(native.id, "file", index), name, mimeType });
        }
      }
      return {
        id: native.id,
        sessionId,
        role: "user",
        createdAt: isoFromEpoch(native.time.created),
        state: "completed",
        parts,
      };
    }
    case "assistant": {
      const parts: AgentMessage["parts"] = [];
      let textIndex = 0;
      let reasoningIndex = 0;
      for (const part of native.content ?? []) {
        if (part.type === "text") {
          parts.push({ type: "text", id: partId(native.id, "text", textIndex++), text: part.text });
        } else if (part.type === "reasoning") {
          parts.push({ type: "reasoning", id: partId(native.id, "reasoning", reasoningIndex++), text: part.text });
        } else if (part.type === "tool") {
          parts.push({ type: "tool_call", id: part.id, toolCall: toAgentToolCall(part, toPublicId) });
        }
      }
      const failed = native.error !== undefined;
      return {
        id: native.id,
        sessionId,
        role: "assistant",
        createdAt: isoFromEpoch(native.time.created),
        updatedAt: native.time.completed !== undefined ? isoFromEpoch(native.time.completed) : null,
        state: failed ? "failed" : native.time.completed !== undefined ? "completed" : "streaming",
        parts,
      };
    }
    case "model-switched":
      return {
        id: native.id,
        sessionId,
        role: "system",
        createdAt: isoFromEpoch(native.time.created),
        state: "completed",
        parts: [
          {
            type: "status",
            id: partId(native.id, "status", 0),
            label: "Model switched",
            detail: modelIdOf(native.model.providerID, native.model.id),
          },
        ],
      };
    case "agent-switched":
      return {
        id: native.id,
        sessionId,
        role: "system",
        createdAt: isoFromEpoch(native.time.created),
        state: "completed",
        parts: [{ type: "status", id: partId(native.id, "status", 0), label: "Mode switched", detail: native.agent }],
      };
    default:
      return null;
  }
}

function approvalKind(action: string): AgentApprovalRequest["kind"] {
  const normalized = action.toLowerCase();
  if (/(write|edit|patch|notebook)/.test(normalized)) return "file";
  if (/(bash|shell|terminal|command|powershell)/.test(normalized)) return "command";
  if (/plan/.test(normalized)) return "plan";
  return "tool";
}

function toolCallIdFromSource(source: Record<string, unknown> | undefined): string | null {
  if (!source) return null;
  if (typeof source.id === "string" && source.id.length > 0) return source.id;
  if (typeof source.toolUseID === "string" && source.toolUseID.length > 0) return source.toolUseID;
  return null;
}

export function toApprovalRequest(request: NativePermissionRequest): AgentApprovalRequest {
  const options: AgentApprovalOption[] = [{ id: "allow_once", label: "Allow once", kind: "allow_once" }];
  if (request.save && request.save.length > 0) {
    options.push({
      id: "allow_always",
      label: "Always allow",
      kind: "allow_always",
      description: `Saves: ${request.save.join(", ")}`,
    });
  }
  options.push({ id: "deny", label: "Deny", kind: "deny" });

  const details: string[] = [];
  if (request.resources && request.resources.length > 0) details.push(request.resources.join(", "));
  if (request.save && request.save.length > 0) details.push(`Remember: ${request.save.join(", ")}`);

  const action = request.action || "tool";
  return {
    id: request.id,
    sessionId: request.sessionID,
    provider: OPENCODE_PROVIDER_ID,
    createdAt: nowTimestamp(),
    kind: approvalKind(action),
    title: request.message?.trim() || `${action.charAt(0).toUpperCase()}${action.slice(1)} requested`,
    detail: details.length > 0 ? details.join(" · ") : null,
    toolCallId: toolCallIdFromSource(request.source),
    options,
  };
}

/** Neutral option ids map onto OpenCode's `once | always | reject`. */
export function approvalOptionToDecision(optionId: string): "once" | "always" | "reject" | null {
  switch (optionId) {
    case "allow_once":
    case "once":
      return "once";
    case "allow_always":
    case "always":
      return "always";
    case "deny":
    case "reject":
      return "reject";
    default:
      return null;
  }
}

export function decisionToOptionId(decision: string): string {
  switch (decision) {
    case "once":
      return "allow_once";
    case "always":
      return "allow_always";
    case "reject":
      return "deny";
    default:
      return decision;
  }
}

function numericConstraint(field: NativeForm["fields"][number]): string {
  const parts: string[] = [];
  const minimum = (field as { minimum?: unknown }).minimum;
  const maximum = (field as { maximum?: unknown }).maximum;
  if (minimum !== undefined) parts.push(`min ${String(minimum)}`);
  if (maximum !== undefined) parts.push(`max ${String(maximum)}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/**
 * Maps a native form to neutral questions. The standard OpenCode question tool
 * uses string fields with options (verified live); number/integer/boolean
 * fields are supported best-effort, and external fields (link-only) are
 * presented as free text.
 */
export function toQuestionRequest(form: NativeForm): AgentQuestionRequest | null {
  const questions: AgentQuestion[] = [];
  for (const [index, field] of form.fields.entries()) {
    if (field.hidden) continue;
    const key = field.key.length > 0 ? field.key : `q${index}`;
    const title = field.title ?? field.description ?? key;
    const base = {
      id: key,
      header: field.title ?? null,
      question: field.description ?? title,
      required: field.required ?? false,
    };
    switch (field.type) {
      case "string":
        if (field.options && field.options.length > 0) {
          questions.push({
            ...base,
            kind: "single_select",
            options: field.options.map((option) => ({
              id: option.value,
              label: option.label,
              description: option.description ?? null,
            })),
            allowFreeform: field.custom === true,
          });
        } else {
          questions.push({ ...base, kind: "text", allowFreeform: true });
        }
        break;
      case "multiselect":
        questions.push({
          ...base,
          kind: "multi_select",
          options: (field.options ?? []).map((option) => ({
            id: option.value,
            label: option.label,
            description: option.description ?? null,
          })),
          allowFreeform: field.custom === true,
        });
        break;
      case "boolean":
        questions.push({ ...base, kind: "confirm" });
        break;
      case "number":
      case "integer":
        questions.push({
          ...base,
          question: `${base.question}${numericConstraint(field)}`,
          kind: "text",
          allowFreeform: true,
        });
        break;
      case "external":
        questions.push({
          ...base,
          question: `${base.question} (link field)`,
          kind: "text",
          allowFreeform: true,
        });
        break;
      default:
        break;
    }
  }
  if (questions.length === 0) return null;
  return {
    id: form.id,
    sessionId: form.sessionID,
    provider: OPENCODE_PROVIDER_ID,
    createdAt: nowTimestamp(),
    title: form.title ?? null,
    questions,
  };
}

/** Converts a neutral answer into OpenCode's `{ answer: { [fieldKey]: value } }`. */
export function toFormAnswer(form: NativeForm, answer: QuestionAnswer): { answer: Record<string, unknown> } {
  const items = new Map(answer.answers.map((item) => [item.questionId, item]));
  const result: Record<string, unknown> = {};
  for (const field of form.fields) {
    const item = items.get(field.key);
    if (!item) continue;
    switch (field.type) {
      case "string":
        if (item.selectedOptionIds && item.selectedOptionIds.length > 0) {
          result[field.key] = item.selectedOptionIds[0];
        } else if (item.text !== undefined && item.text !== null) {
          result[field.key] = item.text;
        }
        break;
      case "multiselect":
        result[field.key] = item.selectedOptionIds ?? (item.text ? [item.text] : []);
        break;
      case "boolean":
        result[field.key] = item.confirmed ?? item.text === "true";
        break;
      case "number":
      case "integer": {
        const value = Number(item.text ?? item.selectedOptionIds?.[0]);
        if (!Number.isFinite(value)) {
          throw new AdapterError("invalid_request", `Answer for "${field.key}" must be a number.`);
        }
        result[field.key] = field.type === "integer" ? Math.trunc(value) : value;
        break;
      }
      default:
        if (item.text !== undefined && item.text !== null) {
          result[field.key] = item.text;
        } else if (item.selectedOptionIds && item.selectedOptionIds.length > 0) {
          result[field.key] = item.selectedOptionIds[0];
        }
        break;
    }
  }
  return { answer: result };
}

/** Strips project-root paths; exposes project-relative paths where possible. */
export function publicDiffPath(file: string, projectPath: string | null): string {
  const normalized = file.replace(/\\/g, "/");
  if (projectPath) {
    const root = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (root.length > 0 && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      return normalized.slice(root.length + 1);
    }
  }
  const looksAbsolute = /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/");
  if (looksAbsolute) {
    return normalized.split("/").pop() ?? normalized;
  }
  return normalized;
}

export function toAgentDiff(files: NativeFileDiff[], projectPath: string | null, sessionId: string): AgentDiff {
  const mapped: AgentDiffFile[] = files.map((file) => ({
    path: publicDiffPath(file.file, projectPath),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch.length > 0 ? file.patch : null,
    binary: file.patch.length === 0 ? true : undefined,
  }));
  return { provider: OPENCODE_PROVIDER_ID, sessionId, files: mapped };
}
