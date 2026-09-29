#!/usr/bin/env node
/**
 * Deterministic fake ACP v1 agent used by transport and adapter tests.
 *
 * It speaks real ACP v1 over stdio using the official SDK's agent side. All
 * behavior is driven by FAKE_ACP_* environment variables so tests never need
 * Grok, network access, or model usage:
 *
 * - FAKE_ACP_MODE: normal | tools | permission | long | crash | fail |
 *   unknown-update | extension | multi
 * - FAKE_ACP_AUTH: cached | api_key | interactive | none
 * - FAKE_ACP_VERSION: 1 | 2 (protocol negotiation failure)
 * - FAKE_ACP_SUPPRESS_INIT: never answer initialize (startup timeout)
 * - FAKE_ACP_STDERR_BYTES: write that many bytes to stderr on startup
 * - FAKE_ACP_REPLAY: replay history on session/load (always on)
 */
import { Readable, Writable } from "node:stream";

import { agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";

const env = process.env;
const mode = env.FAKE_ACP_MODE ?? "normal";
const authMode = env.FAKE_ACP_AUTH ?? "none";
const protocolVersion = env.FAKE_ACP_VERSION === "2" ? 2 : 1;
const suppressInit = env.FAKE_ACP_SUPPRESS_INIT === "1";

function log(...args) {
  console.error("[fake-acp]", ...args);
}

if (process.argv.includes("--version")) {
  console.log(env.FAKE_ACP_VERSION_OUTPUT ?? "grok 1.0.41 (4220f3b224a6) [alpha]");
  process.exit(0);
}

if (env.FAKE_ACP_STDERR_BYTES) {
  process.stderr.write("x".repeat(Number(env.FAKE_ACP_STDERR_BYTES)));
}

if (suppressInit) {
  setInterval(() => undefined, 1_000);
}

const authMethods = [];
if (authMode === "cached") {
  authMethods.push({ id: "cached_token", name: "Cached login", description: "Use the cached local login" });
}
if (authMode === "api_key") authMethods.push({ id: "xai.api_key", name: "API key" });
if (authMode === "interactive") authMethods.push({ id: "grok.com", name: "Sign in with grok.com" });

let nextId = 1;
const sessions = new Map();
const cancelled = new Set();

if (env.FAKE_ACP_SEED_SESSION_CWD) {
  sessions.set("acp_seed_1", {
    sessionId: "acp_seed_1",
    cwd: env.FAKE_ACP_SEED_SESSION_CWD,
    title: "Seeded session",
    configOptions: defaultConfigOptions(),
  });
}
if (env.FAKE_ACP_SEED_OUTSIDE_CWD) {
  sessions.set("acp_outside_1", {
    sessionId: "acp_outside_1",
    cwd: env.FAKE_ACP_SEED_OUTSIDE_CWD,
    title: "Outside session",
    configOptions: defaultConfigOptions(),
  });
}

function defaultConfigOptions() {
  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "grok-4",
      options: [
        { value: "grok-4", name: "Grok 4" },
        { value: "grok-4-mini", name: "Grok 4 Mini" },
      ],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      type: "select",
      currentValue: "medium",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    },
  ];
}

const app = agent({ name: "fake-acp-agent" });

app.onRequest(methods.agent.initialize, () => {
  if (suppressInit) return new Promise(() => undefined);
  log("initialize");
  return {
    protocolVersion,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { embeddedContext: true },
      sessionCapabilities: { list: {}, resume: {}, delete: {} },
    },
    authMethods,
    agentInfo: { name: "fake-acp", version: "1.2.3" },
    _meta: {
      agentVersion: "1.2.3",
      modelState: {
        models: [
          { id: "grok-4", name: "Grok 4", thinkingLevels: ["low", "high"], defaultThinkingLevel: "low" },
          { id: "grok-4-mini", name: "Grok 4 Mini" },
        ],
      },
      modes: [
        { id: "default", name: "Default" },
        { id: "plan", name: "Plan" },
      ],
    },
  };
});

app.onRequest(methods.agent.authenticate, (context) => {
  const methodId = context.params.methodId;
  const ok =
    (methodId === "cached_token" && authMode === "cached") || (methodId === "xai.api_key" && authMode === "api_key");
  if (!ok) throw new Error(`Authentication method "${methodId}" is not available.`);
  return {};
});

app.onRequest(methods.agent.session.new, (context) => {
  const cwd = context.params.cwd;
  if (typeof cwd !== "string" || (!cwd.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(cwd))) {
    throw new Error("session/new requires an absolute cwd.");
  }
  const sessionId = `acp_sess_${nextId++}`;
  sessions.set(sessionId, { sessionId, cwd, title: null, configOptions: defaultConfigOptions() });
  return {
    sessionId,
    modes: {
      currentModeId: "default",
      availableModes: [
        { id: "default", name: "Default" },
        { id: "plan", name: "Plan" },
      ],
    },
    configOptions: defaultConfigOptions(),
  };
});

app.onRequest(methods.agent.session.list, async (context) => {
  const delayMs = Number(env.FAKE_ACP_SLOW_LIST_MS ?? "0");
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const cwd = context.params.cwd;
  const all = [...sessions.values()];
  const filtered = cwd ? all.filter((session) => session.cwd === cwd) : all;
  return {
    sessions: filtered.map((session) => ({ sessionId: session.sessionId, cwd: session.cwd, title: session.title })),
  };
});

app.onRequest(methods.agent.session.load, async (context) => {
  const sessionId = context.params.sessionId;
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown session "${sessionId}".`);
  await context.client.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "user_message_chunk",
      messageId: "replay_user_1",
      content: { type: "text", text: "Earlier question." },
    },
  });
  await context.client.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "agent_thought_chunk",
      messageId: "replay_msg_1",
      content: { type: "text", text: "Replayed reasoning." },
    },
  });
  await context.client.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "replay_msg_1",
      content: { type: "text", text: "Replayed answer." },
    },
  });
  return { configOptions: session.configOptions };
});

app.onRequest(methods.agent.session.resume, (context) => {
  const session = sessions.get(context.params.sessionId);
  if (!session) throw new Error("Unknown session.");
  return { configOptions: session.configOptions };
});

app.onRequest(methods.agent.session.delete, (context) => {
  sessions.delete(context.params.sessionId);
  return {};
});

app.onRequest(methods.agent.session.close, () => ({}));

app.onRequest(methods.agent.session.setMode, async (context) => {
  const session = sessions.get(context.params.sessionId);
  if (!session) throw new Error("Unknown session.");
  await context.client.notify(methods.client.session.update, {
    sessionId: session.sessionId,
    update: { sessionUpdate: "current_mode_update", currentModeId: context.params.modeId },
  });
  return {};
});

app.onRequest(methods.agent.session.setConfigOption, async (context) => {
  const session = sessions.get(context.params.sessionId);
  if (!session) throw new Error("Unknown session.");
  const options = session.configOptions.map((option) =>
    option.id === context.params.configId ? { ...option, currentValue: context.params.value } : option,
  );
  session.configOptions = options;
  await context.client.notify(methods.client.session.update, {
    sessionId: session.sessionId,
    update: { sessionUpdate: "config_option_update", configOptions: options },
  });
  return { configOptions: options };
});

function textChunk(messageId, text) {
  return { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } };
}

app.onNotification(methods.agent.session.cancel, (context) => {
  cancelled.add(context.params.sessionId);
});

app.onRequest(methods.agent.session.prompt, async (context) => {
  const sessionId = context.params.sessionId;
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown session "${sessionId}".`);
  const send = (payload) => {
    const update =
      payload && typeof payload === "object" && "update" in payload && "sessionId" in payload
        ? payload.update
        : payload;
    return context.client.notify(methods.client.session.update, { sessionId, update });
  };
  const userText = context.params.prompt
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" ");

  if (mode === "crash") {
    process.stderr.write("fake-acp: deliberate crash during prompt\n");
    process.exit(3);
  }

  if (mode === "crash-on-permission") {
    await send({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool_1",
        title: "Run the test suite",
        kind: "execute",
        status: "pending",
      },
    });
    void context.client
      .request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: "tool_1", title: "Run the test suite", kind: "execute" },
        options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
      })
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    process.exit(4);
  }

  if (mode === "fail") throw new Error("The provider failed this turn on purpose.");

  if (mode === "long") {
    let index = 0;
    while (!cancelled.has(sessionId)) {
      index += 1;
      await send(textChunk("msg_long", `chunk ${index} `));
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    cancelled.delete(sessionId);
    return { stopReason: "cancelled" };
  }

  if (mode === "extension") {
    try {
      await context.client.request("x.ai/ping", { hello: true });
      log("extension unexpectedly succeeded");
    } catch (error) {
      log("extension rejected as expected:", error.message);
    }
  }

  if (mode === "permission-hold") {
    await send({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool_hold",
        title: "Hold for approval",
        kind: "execute",
        status: "pending",
      },
    });
    const holdResponse = await context.client.request(methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId: "tool_hold", title: "Hold for approval", kind: "execute" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
      ],
    });
    const holdSelected = holdResponse.outcome.outcome === "selected" ? holdResponse.outcome.optionId : "cancelled";
    await send({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool_hold",
        status: holdSelected.startsWith("reject") || holdSelected === "cancelled" ? "failed" : "completed",
        rawOutput: { selected: holdSelected },
      },
    });
    log("hold permission resolved", holdSelected);
    return { stopReason: holdSelected === "cancelled" ? "cancelled" : "end_turn" };
  }

  await send({
    sessionId,
    update: {
      sessionUpdate: "agent_thought_chunk",
      messageId: "msg_1",
      content: { type: "text", text: "Thinking about it." },
    },
  });
  await send(textChunk("msg_1", `Echo: ${userText}`));

  if (mode === "tools" || mode === "permission") {
    await send({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool_1",
        title: "Run the test suite",
        kind: "execute",
        status: "pending",
        rawInput: { command: "npm test" },
        locations: [{ path: `${session.cwd}/package.json` }],
      },
    });
    if (mode === "permission") {
      const response = await context.client.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: "tool_1", title: "Run the test suite", kind: "execute" },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
          { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
          { optionId: "reject-always", name: "Reject always", kind: "reject_always" },
        ],
      });
      const selected = response.outcome.outcome === "selected" ? response.outcome.optionId : "cancelled";
      const denied = selected.startsWith("reject") || selected === "cancelled";
      await send({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool_1",
          status: denied ? "failed" : "completed",
          rawOutput: { selected },
        },
      });
      log("permission resolved", selected);
    } else {
      await send({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool_1",
          status: "completed",
          rawOutput: { exitCode: 0 },
        },
      });
    }
  }

  if (mode === "unknown-update") {
    await send({ sessionUpdate: "totally_new_update_kind", payload: { ignored: true } });
  }

  if (mode === "plan" || mode === "tools") {
    await send({
      sessionId,
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "Inspect the repository", priority: "high", status: "completed" },
          { content: "Implement the change", priority: "high", status: "in_progress" },
        ],
      },
    });
  }

  if (cancelled.has(sessionId)) {
    cancelled.delete(sessionId);
    return { stopReason: "cancelled" };
  }
  await send(textChunk("msg_1", " Done."));
  return { stopReason: "end_turn" };
});

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
app.connect(stream);

if (env.FAKE_ACP_MALFORMED === "1") {
  // A malformed line must not take down the transport.
  setTimeout(() => process.stdout.write("this is definitely not JSON-RPC\n"), 50);
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
