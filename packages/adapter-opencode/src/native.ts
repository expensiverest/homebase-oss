/**
 * OpenCode server payload shapes used by this adapter.
 *
 * These types are private to `@homebase/adapter-opencode`; they must not leak
 * through the adapter boundary. Verified against OpenCode 2.0.18's
 * `GET /openapi.json` (spec title "opencode HttpApi", version 0.0.1) plus live
 * captures from that version.
 */

export interface NativeServerInfo {
  version?: string;
}

export interface NativeCursor {
  previous?: string | null;
  next?: string | null;
}

export interface NativeModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

export interface NativeModel {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  status?: "alpha" | "beta" | "deprecated" | "active";
  enabled?: boolean;
  capabilities?: { tools: boolean; input: string[]; output: string[] };
  variants?: Array<{ id: string }>;
  limit?: { context?: number; input?: number; output?: number };
  cost?: unknown[];
}

export interface NativeAgent {
  id: string;
  name: string;
  mode: "subagent" | "primary" | "all";
  hidden: boolean;
  description?: string;
  model?: NativeModelRef;
}

export interface NativeTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface NativeSession {
  id: string;
  parentID?: string;
  projectID: string;
  title?: string;
  agent?: string;
  model?: NativeModelRef;
  cost?: number;
  tokens?: NativeTokens;
  outcome?: "succeeded" | "failed" | "interrupted";
  time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number };
  location?: { directory: string };
}

export interface NativeFileAttachment {
  data?: string;
  mime?: string;
  name?: string;
  source?: unknown;
}

export type NativeToolContent =
  { type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string | null };

export type NativeToolState =
  | { status: "streaming"; input: string }
  | { status: "running"; input: Record<string, unknown>; metadata?: Record<string, unknown> }
  | {
      status: "completed";
      input: Record<string, unknown>;
      content?: NativeToolContent[];
      metadata?: Record<string, unknown>;
    }
  | {
      status: "error";
      input: Record<string, unknown>;
      error?: { type?: string; message?: string } | string;
      content?: NativeToolContent[];
      metadata?: Record<string, unknown>;
    };

export interface NativeToolPart {
  type: "tool";
  id: string;
  name: string;
  executed?: boolean;
  providerState?: unknown;
  state: NativeToolState;
  time: { created: number; ran?: number; completed?: number };
}

export interface NativeTextPart {
  type: "text";
  text: string;
}

export interface NativeReasoningPart {
  type: "reasoning";
  text: string;
  time?: { created?: number; completed?: number };
}

export type NativeAssistantPart = NativeTextPart | NativeReasoningPart | NativeToolPart;

export interface NativeUserMessage {
  type: "user";
  id: string;
  time: { created: number };
  text: string;
  files?: NativeFileAttachment[];
}

export interface NativeAssistantMessage {
  type: "assistant";
  id: string;
  time: { created: number; completed?: number };
  agent?: string;
  model?: NativeModelRef;
  content?: NativeAssistantPart[];
  finish?: string;
  error?: { type?: string; message?: string };
  cost?: number;
  tokens?: NativeTokens;
}

export interface NativeModelSwitchedMessage {
  type: "model-switched";
  id: string;
  time: { created: number };
  model: NativeModelRef;
  previous?: NativeModelRef;
}

export interface NativeAgentSwitchedMessage {
  type: "agent-switched";
  id: string;
  time: { created: number };
  agent: string;
  previous?: string;
}

export interface NativeIdleMessage {
  type: "idle";
  id: string;
  time: { created: number };
  outcome: "succeeded" | "failed" | "interrupted";
}

export type NativeMessage =
  | NativeUserMessage
  | NativeAssistantMessage
  | NativeModelSwitchedMessage
  | NativeAgentSwitchedMessage
  | NativeIdleMessage;

export interface NativePermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  source?: Record<string, unknown>;
  message?: string;
}

export interface NativeFormField {
  key: string;
  type: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  options?: Array<{ value: string; label: string; description?: string }>;
  custom?: boolean;
  minItems?: number;
  maxItems?: number;
  minimum?: unknown;
  maximum?: unknown;
  default?: unknown;
  format?: string;
}

export interface NativeForm {
  id: string;
  sessionID: string;
  title: string;
  metadata?: { kind?: string; tool?: { messageID?: string; id?: string } };
  fields: NativeFormField[];
}

export interface NativeFileDiff {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
}

export interface NativeEvent {
  id: string;
  type: string;
  created?: number;
  location?: { directory: string };
  data?: Record<string, unknown>;
  durable?: { aggregateID: string; seq: number; version: number };
}
