/**
 * Claude Code stream-json frame shapes used by this adapter.
 *
 * Verified against Claude Code 2.1.268. These types are private to the adapter
 * and intentionally tolerant: unknown frame types and added fields must never
 * crash a run.
 */

export interface NativeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
}

export type NativeContentBlock =
  | { type: "text"; text?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | { type: "thinking"; thinking?: string; signature?: string }
  | { type: "tool_result"; tool_use_id?: string; content?: unknown; is_error?: boolean }
  | { type: string; [key: string]: unknown };

export interface NativeInitFrame {
  type: "system";
  subtype: "init";
  session_id?: string;
  cwd?: string;
  model?: string;
  permissionMode?: string;
  tools?: string[];
  mcp_servers?: Array<{ name?: string; status?: string }>;
  capabilities?: string[];
  slash_commands?: string[];
  claude_code_version?: string;
}

export interface NativeAssistantFrame {
  type: "assistant";
  session_id?: string;
  parent_tool_use_id?: string | null;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    content?: NativeContentBlock[];
    usage?: NativeUsage;
    stop_reason?: string | null;
  };
}

export interface NativeUserFrame {
  type: "user";
  session_id?: string;
  parent_tool_use_id?: string | null;
  message?: { content?: unknown };
}

export interface NativeStreamEventFrame {
  type: "stream_event";
  session_id?: string;
  event?: {
    type?: string;
    index?: number;
    message?: { id?: string; model?: string };
    content_block?: { type?: string; id?: string; name?: string };
    delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
    usage?: NativeUsage;
  };
}

export interface NativeResultFrame {
  type: "result";
  session_id?: string;
  subtype?: string;
  is_error?: boolean;
  terminal_reason?: string;
  result?: string;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: NativeUsage;
  permission_denials?: Array<{ tool_name?: string; tool_use_id?: string }>;
}

export interface NativeRateLimitFrame {
  type: "rate_limit_event";
  session_id?: string;
  rate_limit_info?: {
    status?: string;
    utilization?: number;
    resetsAt?: number;
    unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>;
  };
}

export interface NativeControlResponseFrame {
  type: "control_response";
  response?: {
    subtype?: string;
    request_id?: string;
    response?: unknown;
    error?: string;
  };
}

export type NativeFrame = { type: string; session_id?: string } & Record<string, unknown>;

export function isNativeInitFrame(frame: NativeFrame): frame is NativeFrame & NativeInitFrame {
  return frame.type === "system" && frame.subtype === "init";
}
