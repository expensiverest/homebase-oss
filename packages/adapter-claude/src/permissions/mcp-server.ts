#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";

import { askApprovalChannel, type ApprovalDecision } from "./channel-protocol.js";

/**
 * Minimal MCP stdio server used with `--permission-prompt-tool`.
 *
 * Claude Code calls the single `approve` tool for permission prompts and
 * AskUserQuestion. This process forwards the ask to the Homebase adapter over
 * the loopback approval channel and returns Claude's documented
 * `{behavior: "allow"|"deny", ...}` JSON as the MCP tool result. On any
 * failure it denies with an explanatory message so Claude never hangs.
 *
 * It receives everything it needs through the environment inherited from the
 * Claude process: HOMEBASE_APPROVAL_PORT, HOMEBASE_APPROVAL_TOKEN,
 * HOMEBASE_APPROVAL_TIMEOUT_MS, HOMEBASE_CLAUDE_SESSION.
 */
export const APPROVAL_TOOL_NAME = "approve";

export function buildPermissionTool(): Record<string, unknown> {
  return {
    name: APPROVAL_TOOL_NAME,
    description: "Ask the Homebase operator to approve a tool call, or answer a question.",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: { type: "object" },
        tool_use_id: { type: "string" },
      },
      required: ["tool_name", "input"],
    },
  };
}

export function toMcpToolResult(decision: ApprovalDecision): Record<string, unknown> {
  return { content: [{ type: "text", text: JSON.stringify(decision) }] };
}

export function denial(message: string): ApprovalDecision {
  return { behavior: "deny", message };
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleToolCall(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const name = typeof params.name === "string" ? params.name : "";
  if (name !== APPROVAL_TOOL_NAME) {
    return toMcpToolResult(denial(`Unknown Homebase approval tool "${name}".`));
  }
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const toolName = typeof args.tool_name === "string" ? args.tool_name : "tool";
  const input = typeof args.input === "object" && args.input !== null ? (args.input as Record<string, unknown>) : {};
  const toolUseId = typeof args.tool_use_id === "string" ? args.tool_use_id : null;

  const port = Number.parseInt(process.env.HOMEBASE_APPROVAL_PORT ?? "", 10);
  const token = process.env.HOMEBASE_APPROVAL_TOKEN ?? "";
  const sessionId = process.env.HOMEBASE_CLAUDE_SESSION ?? "";
  const timeoutMs = Number.parseInt(process.env.HOMEBASE_APPROVAL_TIMEOUT_MS ?? "", 10) || 60 * 60 * 1_000;

  if (!Number.isFinite(port) || token.length === 0 || sessionId.length === 0) {
    return toMcpToolResult(denial("Homebase approval is not configured for this session."));
  }

  try {
    const decision = await askApprovalChannel(port, token, { sessionId, toolName, input, toolUseId }, timeoutMs);
    return toMcpToolResult(decision);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return toMcpToolResult(denial(`Homebase could not ask for approval (${message}).`));
  }
}

async function main(): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length === 0) continue;

      let message: { id?: unknown; method?: unknown; params?: Record<string, unknown> };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id === undefined) continue; // notifications need no reply

      const method = typeof message.method === "string" ? message.method : "";
      if (method === "initialize") {
        const params = message.params ?? {};
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "homebase", version: "0.0.1" },
          },
        });
      } else if (method === "tools/list") {
        send({ jsonrpc: "2.0", id: message.id, result: { tools: [buildPermissionTool()] } });
      } else if (method === "ping") {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
      } else if (method === "tools/call") {
        const result = await handleToolCall(message.params ?? {});
        send({ jsonrpc: "2.0", id: message.id, result });
      } else {
        // Unknown methods get a benign result so newer CLIs do not treat the
        // server as broken.
        send({ jsonrpc: "2.0", id: message.id, result: {} });
      }
    }
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  void main();
}
