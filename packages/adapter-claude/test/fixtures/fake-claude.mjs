import { appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import readline from "node:readline";

/**
 * Fake `claude` CLI for tests.
 *
 * Speaks the documented stream-json protocol (2.1.268 shapes) without any
 * network, login, or real model: init, control requests, streamed text,
 * assistant frames, rate-limit events, results, and transcript writes.
 *
 * Prompt keywords:
 * - "slow"     → streams slowly so interrupt tests can win the race
 * - "fail"     → result with is_error/error_during_execution
 * - "abort"    → behaves like an interrupted run on the next interrupt only
 */

const args = process.argv.slice(2);
const sessionIndex = args.lastIndexOf("--session-id");
const resumeIndex = args.lastIndexOf("--resume");
const sessionId =
  sessionIndex >= 0
    ? (args[sessionIndex + 1] ?? randomUUID())
    : resumeIndex >= 0
      ? (args[resumeIndex + 1] ?? randomUUID())
      : randomUUID();
const cwd = process.cwd();
const configDir = process.env.CLAUDE_CONFIG_DIR ?? process.env.HOMEBASE_FAKE_CONFIG_DIR ?? "";
const recordFile = process.env.HOMEBASE_FAKE_RECORD;
const model = valueOf("--model") ?? "claude-fake-2";
const permissionMode = valueOf("--permission-mode") ?? "manual";

function valueOf(flag) {
  const index = args.lastIndexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function send(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

if (recordFile) {
  try {
    appendFileSync(recordFile, `${JSON.stringify({ type: "start", args })}\n`);
  } catch {
    // ignore recording failures
  }
}

send({
  type: "system",
  subtype: "init",
  session_id: sessionId,
  cwd,
  model,
  permissionMode,
  tools: ["Read", "Write", "Bash", "AskUserQuestion"],
  slash_commands: ["/help"],
  mcp_servers: [{ name: "homebase", status: "connected" }],
  capabilities: ["interrupt_receipt_v1", "interrupt_cancel_queued_v1"],
  claude_code_version: "0.0.0-fake",
});

send({
  type: "rate_limit_event",
  session_id: sessionId,
  rate_limit_info: {
    status: "allowed",
    unifiedWindows: {
      five_hour: { utilization: 0.21, resetsAt: 4_000_000_000 },
      seven_day: { utilization: 0.42, resetsAt: 4_000_000_000 },
    },
  },
});

let runningTurn = false;
let interrupted = false;
const queued = [];

function transcriptPath() {
  if (!configDir) return null;
  return path.join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`);
}

function appendTranscript(entry) {
  const target = transcriptPath();
  if (!target) return;
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    appendFileSync(target, `${JSON.stringify(entry)}\n`);
  } catch {
    // ignore
  }
}

function runTurn(text, delayMs, userUuid = randomUUID()) {
  runningTurn = true;
  interrupted = false;
  const messageId = `msg_${Math.random().toString(36).slice(2, 10)}`;
  const timestamp = new Date().toISOString();
  appendTranscript({
    type: "user",
    uuid: userUuid,
    sessionId,
    cwd,
    entrypoint: "sdk-cli",
    isSidechain: false,
    timestamp,
    message: { content: text },
  });

  const reply = text.includes("fail") ? "simulated failure" : `fake reply to: ${text}`;
  send({
    type: "stream_event",
    session_id: sessionId,
    event: { type: "message_start", message: { id: messageId, model } },
  });
  send({
    type: "stream_event",
    session_id: sessionId,
    event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
  });

  const words = reply.split(" ");
  let index = 0;
  const tick = () => {
    if (interrupted) return;
    if (index < words.length) {
      const delta = `${words[index] ?? ""}${index < words.length - 1 ? " " : ""}`;
      send({
        type: "stream_event",
        session_id: sessionId,
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } },
      });
      index += 1;
      setTimeout(tick, delayMs);
      return;
    }
    send({ type: "stream_event", session_id: sessionId, event: { type: "message_stop" } });
    send({
      type: "assistant",
      session_id: sessionId,
      timestamp,
      message: {
        id: messageId,
        model,
        content: [{ type: "text", text: reply }],
        usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
      },
    });
    appendTranscript({
      type: "assistant",
      uuid: randomUUID(),
      sessionId,
      cwd,
      entrypoint: "sdk-cli",
      isSidechain: false,
      timestamp,
      message: {
        id: messageId,
        model,
        content: [{ type: "text", text: reply }],
        usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
      },
    });
    runningTurn = false;
    const failed = text.includes("fail");
    send({
      type: "result",
      session_id: sessionId,
      subtype: failed ? "error_during_execution" : "success",
      is_error: failed,
      terminal_reason: failed ? "api_error" : "completed",
      result: failed ? "simulated failure" : reply,
      num_turns: 1,
      total_cost_usd: 0,
      usage: {
        input_tokens: 5,
        output_tokens: 7,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
        output_tokens_details: { thinking_tokens: 2 },
      },
      permission_denials: [],
    });
    const next = queued.shift();
    if (next !== undefined) runTurn(next.text, delayMs, next.uuid);
  };
  setTimeout(tick, delayMs);
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (message.type === "control_request") {
    const requestId = message.request_id;
    const request = message.request ?? {};
    const subtype = request.subtype;
    if (subtype === "interrupt") {
      const wasRunning = runningTurn;
      interrupted = wasRunning;
      if (wasRunning) {
        runningTurn = false;
        send({
          type: "result",
          session_id: sessionId,
          subtype: "error_during_execution",
          is_error: true,
          terminal_reason: "aborted_streaming",
          num_turns: 1,
          usage: { input_tokens: 1, output_tokens: 1 },
          permission_denials: [],
        });
      }
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: { still_queued: queued.map((entry) => entry.text), cancelled: [] },
        },
      });
      return;
    }
    if (subtype === "initialize") {
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: {
            models: [
              {
                value: "sonnet",
                displayName: "Claude Sonnet",
                supportsEffort: true,
                supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
              },
              { value: "haiku", displayName: "Claude Haiku", supportsEffort: false },
            ],
            commands: [],
            agents: [],
            current_permission_mode: permissionMode,
          },
        },
      });
      return;
    }
    if (subtype === "get_usage") {
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: {
            rate_limits_available: true,
            rate_limits: { five_hour: { utilization: 21, resets_at: "2026-01-01T00:00:00.000Z" } },
          },
        },
      });
      return;
    }
    send({ type: "control_response", response: { subtype: "success", request_id: requestId, response: {} } });
    return;
  }

  if (message.type === "user") {
    const text = textOf(message);
    if (runningTurn) {
      queued.push({ text, uuid: message.uuid });
      return;
    }
    const slow = text.includes("slow");
    runTurn(text, slow ? 60 : 2, message.uuid);
  }
});

function textOf(message) {
  const payload = message.message;
  const content = payload?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((block) => block.type === "text");
    return textBlock?.text ?? "";
  }
  return "";
}

process.stdin.on("end", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
setTimeout(() => process.exit(0), 300_000).unref();
