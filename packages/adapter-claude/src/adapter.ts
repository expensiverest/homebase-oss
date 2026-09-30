import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  AdapterError,
  createConsoleLogger,
  createPublicId,
  decodePublicIdFor,
  type AdapterContext,
  type AdapterLogger,
  type AgentAdapter,
  type ResolvedAttachment,
} from "@homebase/adapter-sdk";
import {
  defineCapabilities,
  nowTimestamp,
  toAgentPage,
  type AgentCapabilities,
  type AgentEvent,
  type AgentEventType,
  type AgentMessage,
  type AgentQuestionAnswerItem,
  type AgentMode,
  type AgentModel,
  type AgentPage,
  type AgentProject,
  type AgentSession,
  type AgentUsage,
  type AgentUsageWindow,
  type ApprovalResult,
  type CreateSessionInput,
  type PageRequest,
  type ProviderDetection,
  type QuestionAnswer,
  type SendMessageInput,
  type SetModelInput,
  type SetModeInput,
} from "@homebase/protocol";

import { parseClaudeConfig, type ClaudeConfig } from "./config.js";
import { ClaudeProcessError, parseClaudeVersion, toAdapterError, versionCompatibility } from "./errors.js";
import {
  listTranscriptSummaries,
  locateTranscript,
  readTranscriptMessages,
  resolveClaudeConfigDir,
} from "./history/transcripts.js";
import { CLAUDE_FALLBACK_MODELS, CLAUDE_PROVIDER_ID, toAgentModel, type NativeModelInfo } from "./models.js";
import { CLAUDE_MODES, cliMode, isSafeMode, normalizeMode } from "./modes.js";
import type { ApprovalAsk, ApprovalDecision } from "./permissions/channel-protocol.js";
import { encodeChannelLine } from "./permissions/channel-protocol.js";
import { buildQuestionUpdatedInput, nativeQuestions, toAgentQuestions } from "./permissions/mapping.js";
import { matchesRule, resourcesOf, savePatterns } from "./permissions/policy.js";
import { ClaudeProcessController } from "./process/controller.js";
import { classifyResultFrame, ClaudeStreamNormalizer } from "./stream/normalizer.js";
import type { NativeInitFrame, NativeResultFrame } from "./native.js";

const execFileAsync = promisify(execFile);

export interface ClaudeAdapterOptions {
  config?: Readonly<Record<string, unknown>>;
  /** Test hook: path to the compiled MCP approval server (defaults to dist). */
  mcpServerPath?: string;
  /** Test hook: executable override. */
  executableOverride?: string;
  /** Test hook: argv prefix inserted before the adapter's own flags. */
  launchPrefix?: string[];
  /** Test hook: extra environment variables for the child process. */
  extraEnv?: Record<string, string>;
}

interface PendingRequest {
  publicRequestId: string;
  kind: "approval" | "question";
  toolName: string;
  input: Record<string, unknown>;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ClaudeSessionState {
  publicId: string;
  nativeId: string;
  projectId: string;
  projectPath: string;
  session: AgentSession;
  controller: ClaudeProcessController | null;
  started: boolean;
  model: string | null;
  mode: string;
  effort: string | null;
  capabilities: string[];
  alwaysRules: Array<{ tool: string; pattern: string }>;
  pending: Map<string, PendingRequest>;
  deniedTools: Set<string>;
  listing: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  transcriptPath: string | null;
}

/**
 * Claude Code adapter: drives the user's locally installed `claude` CLI through
 * its documented structured stream-json interface. No Anthropic API key, no
 * Homebase-owned login, no terminal parsing, no HTTP bridge: the Host talks to
 * the child process directly, and the only side channel is a loopback approval
 * socket for the MCP permission-prompt tool.
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly id = CLAUDE_PROVIDER_ID;
  readonly displayName = "Claude Code";

  readonly #config: ClaudeConfig;
  readonly #mcpServerPath: string;
  readonly #launchPrefix: string[];
  readonly #extraEnv: Record<string, string>;

  #context: AdapterContext | null = null;
  #fallbackLogger: AdapterLogger;
  #disposed = false;

  readonly #sessions = new Map<string, ClaudeSessionState>();
  #normalizer: ClaudeStreamNormalizer | null = null;

  #channelServer: Server | null = null;
  #channelPort = 0;
  readonly #channelToken = randomUUID();
  #tempDir: string | null = null;
  #mcpConfigPath: string | null = null;

  #modelsCache: { at: number; models: AgentModel[] } | null = null;
  #usage: AgentUsage | null = null;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.#config = parseClaudeConfig(options.config ?? {});
    this.#fallbackLogger = createConsoleLogger("provider:claude", { level: "warn" });
    this.#mcpServerPath =
      options.mcpServerPath ?? fileURLToPath(new URL("./permissions/mcp-server.js", import.meta.url));
    this.#launchPrefix = options.launchPrefix ?? [];
    this.#extraEnv = options.extraEnv ?? {};
    if (options.executableOverride) {
      this.#config.executable = options.executableOverride;
    }
  }

  init(context: AdapterContext): void {
    this.#context = context;
    this.#normalizer = new ClaudeStreamNormalizer({
      emit: (type, nativeSessionId, data) => this.#emitForNative(type, nativeSessionId, data),
      markDenied: (nativeSessionId, toolUseId) => {
        this.#byNative(nativeSessionId)?.deniedTools.add(toolUseId);
      },
      isDenied: (nativeSessionId, toolUseId) => this.#byNative(nativeSessionId)?.deniedTools.has(toolUseId) ?? false,
      onResult: (nativeSessionId, frame) => this.#onResult(nativeSessionId, frame),
      onModelSeen: (nativeSessionId, model) => {
        const session = this.#byNative(nativeSessionId);
        if (!session || session.model === model) return;
        session.model = model;
        session.session.model = { provider: this.id, modelId: model, thinkingLevel: session.effort };
        this.#emitSessionUpdated(session);
      },
      onUsage: () => undefined,
      onRateLimit: (nativeSessionId, info) => this.#onRateLimit(nativeSessionId, info),
      onInit: (nativeSessionId, frame) => this.#onInit(nativeSessionId, frame as unknown as NativeInitFrame),
      logDebug: (message, fields) => this.#logger.debug(message, fields),
    });
    void this.#ensureChannelServer().catch((error) => {
      this.#logger.warn("Claude approval channel failed to start.", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    const closing: Promise<void>[] = [];
    for (const session of this.#sessions.values()) {
      this.#clearIdleTimer(session);
      if (session.controller) closing.push(session.controller.dispose());
    }
    await Promise.all(closing);
    this.#sessions.clear();
    if (this.#channelServer) {
      await new Promise<void>((resolve) => this.#channelServer?.close(() => resolve()));
      this.#channelServer = null;
    }
    if (this.#tempDir) {
      rmSync(this.#tempDir, { recursive: true, force: true });
      this.#tempDir = null;
      this.#mcpConfigPath = null;
    }
  }

  async detect(): Promise<ProviderDetection> {
    try {
      const { stdout } = await execFileAsync(this.#config.executable, ["--version"], {
        timeout: 15_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      const version = parseClaudeVersion(stdout);
      if (!version) {
        return {
          installed: true,
          authenticated: null,
          compatible: true,
          version: null,
          warning: "Claude Code did not report a recognizable version.",
        };
      }
      const compatibility = versionCompatibility(version);
      const authenticated = await this.#probeAuthentication();
      return {
        installed: true,
        authenticated,
        compatible: compatibility.compatible,
        version,
        warning:
          compatibility.warning ??
          (authenticated === false ? "Claude Code is not signed in; run `claude` on this machine to sign in." : null),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = /ENOENT|not found/i.test(message);
      return {
        installed: false,
        authenticated: null,
        compatible: false,
        version: null,
        warning: missing
          ? "Claude Code was not found; install it or set providers.claude.config.executable."
          : "Claude Code could not be started.",
      };
    }
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    return defineCapabilities({
      resume: true,
      // deleteSession: no documented per-session removal; not declared.
      streaming: true,
      interrupt: true,
      steer: true,
      queue: true,
      models: true,
      modelSwitching: true,
      thinkingLevels: true,
      modes: true,
      // Only images are accepted through the structured input path.
      attachments: false,
      imageInput: true,
      tools: true,
      approvals: true,
      questions: true,
      // Plan mode produces prose, not a structured plan object.
      plans: false,
      // No provider-native session diff primitive.
      diffs: false,
      usage: true,
      // Command normalization is deferred (no neutral contract yet).
      slashCommands: false,
    });
  }

  async listModels(_project: AgentProject): Promise<AgentModel[]> {
    if (this.#modelsCache && Date.now() - this.#modelsCache.at < 10 * 60 * 1000) {
      return this.#modelsCache.models;
    }
    const live = [...this.#sessions.values()].find((session) => session.controller?.alive);
    if (live?.controller) {
      try {
        const response = (await live.controller.request("initialize", {}, 10_000)) as { models?: NativeModelInfo[] };
        const models = (response.models ?? []).map((info) => toAgentModel(info));
        if (models.length > 0) {
          this.#modelsCache = { at: Date.now(), models };
          return models;
        }
      } catch {
        // fall through to fallback catalog
      }
    }
    return CLAUDE_FALLBACK_MODELS;
  }

  async listModes(_project: AgentProject): Promise<AgentMode[]> {
    return CLAUDE_MODES.map((mode) => ({ ...mode }));
  }

  async listSessions(project: AgentProject, page: PageRequest = {}): Promise<AgentPage<AgentSession>> {
    const configDir = resolveClaudeConfigDir(this.#config.configDir);
    const summaries = listTranscriptSummaries(project.path, configDir);
    const limit = clampPageSize(page.limit, 50);

    const items: AgentSession[] = [];
    for (const summary of summaries) {
      const existing = this.#byNative(summary.nativeId);
      if (existing) {
        items.push({ ...existing.session });
        continue;
      }
      items.push(this.#sessionFromSummary(summary.nativeId, project.id, summary.title, summary.mtimeMs));
    }
    for (const session of this.#sessions.values()) {
      if (session.projectId === project.id && !session.transcriptPath && !session.started) {
        items.push({ ...session.session });
      }
    }

    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const offset = decodeOffsetCursor(page.cursor);
    const slice = items.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return toAgentPage(slice, {
      next: nextOffset < items.length ? `claude:${nextOffset}` : null,
      previous: offset > 0 ? `claude:${Math.max(0, offset - limit)}` : null,
    });
  }

  async getSession(sessionId: string): Promise<AgentSession> {
    const nativeId = this.#toNativeId(sessionId);
    const existing = this.#byNative(nativeId);
    if (existing) return { ...existing.session };

    const configDir = resolveClaudeConfigDir(this.#config.configDir);
    const located = locateTranscript(configDir, nativeId);
    if (!located) {
      throw new AdapterError("session_not_found", `Unknown Claude session "${sessionId}".`);
    }
    const projectId = located.cwd ? await this.#context?.findProjectByPath(located.cwd) : null;
    if (!projectId) {
      throw new AdapterError(
        "session_not_found",
        `Claude session "${sessionId}" is outside the configured project roots.`,
      );
    }
    return this.#sessionFromSummary(nativeId, projectId, null, located.mtimeMs, located.filePath);
  }

  async createSession(input: CreateSessionInput, project: AgentProject): Promise<AgentSession> {
    if (input.provider !== this.id) {
      throw new AdapterError("invalid_request", `This adapter only serves provider "${this.id}".`);
    }
    const nativeId = randomUUID();
    const publicId = createPublicId(this.id, nativeId);
    const timestamp = nowTimestamp();
    const mode = input.mode && isSafeMode(input.mode) ? input.mode : "default";
    const effort = input.thinkingLevel ?? null;
    const session: AgentSession = {
      id: publicId,
      provider: this.id,
      projectId: project.id,
      title: input.title ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: "idle",
      model: { provider: this.id, modelId: input.model?.modelId ?? "default", thinkingLevel: effort },
      mode,
      thinkingLevel: effort,
    };
    const state: ClaudeSessionState = {
      publicId,
      nativeId,
      projectId: project.id,
      projectPath: project.path,
      session,
      controller: null,
      started: false,
      model: input.model?.modelId ?? null,
      mode,
      effort,
      capabilities: [],
      alwaysRules: [],
      pending: new Map(),
      deniedTools: new Set(),
      listing: false,
      idleTimer: null,
      transcriptPath: null,
    };
    this.#sessions.set(publicId, state);
    this.#emit("session.created", state, { session: { ...session } });
    return { ...session };
  }

  async listMessages(sessionId: string, page: PageRequest = {}): Promise<AgentPage<AgentMessage>> {
    const nativeId = this.#toNativeId(sessionId);
    const session = await this.getSession(sessionId);
    const configDir = resolveClaudeConfigDir(this.#config.configDir);
    const located =
      this.#sessions.get(session.id)?.transcriptPath ?? locateTranscript(configDir, nativeId)?.filePath ?? null;
    if (!located) {
      return toAgentPage([], { next: null, previous: null });
    }
    const messages = readTranscriptMessages(located, nativeId);
    const newestFirst = [...messages].reverse();
    const limit = clampPageSize(page.limit, 100);
    const offset = decodeOffsetCursor(page.cursor);
    const slice = newestFirst.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return toAgentPage(
      slice.map((message) => ({ ...message, sessionId })),
      {
        next: nextOffset < newestFirst.length ? `claude:${nextOffset}` : null,
        previous: offset > 0 ? `claude:${Math.max(0, offset - limit)}` : null,
      },
    );
  }

  async send(sessionId: string, input: SendMessageInput): Promise<void> {
    await this.#prompt(sessionId, input, "send");
  }

  async steer(sessionId: string, input: SendMessageInput): Promise<void> {
    await this.#prompt(sessionId, input, "steer");
  }

  async queue(sessionId: string, input: SendMessageInput): Promise<void> {
    await this.#prompt(sessionId, input, "queue");
  }

  async interrupt(sessionId: string): Promise<void> {
    const session = await this.#requireSession(sessionId);
    if (!session.controller?.alive) return; // nothing running: safe no-op
    try {
      await session.controller.interrupt(false, this.#config.controlTimeoutMs);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async resolveApproval(requestId: string, result: ApprovalResult): Promise<void> {
    const pending = this.#findPending(requestId);
    if (!pending || pending.kind !== "approval") {
      throw new AdapterError("not_found", `No pending Claude approval with id "${requestId}".`);
    }
    const session = this.#sessionOfPending(pending);
    const decision = approvalDecision(result.optionId);
    if (!decision) {
      throw new AdapterError("invalid_request", `Unknown approval option "${result.optionId}".`);
    }
    if (decision === "allow_always" && session) {
      for (const pattern of savePatterns(pending.toolName, pending.input)) {
        if (!session.alwaysRules.some((rule) => rule.tool === pending.toolName && rule.pattern === pattern)) {
          session.alwaysRules.push({ tool: pending.toolName, pattern });
        }
      }
    }
    const allow = decision !== "deny";
    this.#settlePending(
      pending,
      allow
        ? { behavior: "allow", updatedInput: pending.input }
        : { behavior: "deny", message: result.note ?? "The operator rejected this call." },
      session,
      { optionId: decision, answers: [] },
    );
  }

  async answerQuestion(requestId: string, answer: QuestionAnswer): Promise<void> {
    const pending = this.#findPending(requestId);
    if (!pending || pending.kind !== "question") {
      throw new AdapterError("not_found", `No pending Claude question with id "${requestId}".`);
    }
    const session = this.#sessionOfPending(pending);
    const questions = nativeQuestions(pending.input);
    const updatedInput = buildQuestionUpdatedInput(pending.input, questions, answer.answers);
    this.#settlePending(pending, { behavior: "allow", updatedInput }, session, {
      optionId: "allow_once",
      answers: answer.answers,
    });
  }

  async setModel(sessionId: string, input: SetModelInput): Promise<void> {
    const session = await this.#requireSession(sessionId);
    session.model = input.modelId;
    session.effort = input.thinkingLevel ?? session.effort;
    session.session.model = { provider: this.id, modelId: input.modelId, thinkingLevel: input.thinkingLevel ?? null };
    session.session.thinkingLevel = input.thinkingLevel ?? null;
    if (session.controller?.alive) {
      try {
        await session.controller.request("set_model", { model: input.modelId }, this.#config.controlTimeoutMs);
        if (input.thinkingLevel) {
          await session.controller
            .request("apply_flag_settings", { effortLevel: input.thinkingLevel }, this.#config.controlTimeoutMs)
            .catch(() => undefined);
        }
      } catch (error) {
        this.#logger.debug("Live model switch failed; the next launch will apply it.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.#emitSessionUpdated(session);
  }

  async setMode(sessionId: string, input: SetModeInput): Promise<void> {
    const session = await this.#requireSession(sessionId);
    const cli = cliMode(input.mode);
    if (!cli) {
      throw new AdapterError("invalid_request", `Unsupported Claude mode "${input.mode}".`);
    }
    session.mode = input.mode;
    session.session.mode = input.mode;
    if (session.controller?.alive) {
      try {
        await session.controller.request("set_permission_mode", { mode: cli }, this.#config.controlTimeoutMs);
      } catch (error) {
        this.#logger.debug("Live mode switch failed; the next launch will apply it.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.#emitSessionUpdated(session);
  }

  async getUsage(): Promise<AgentUsage | null> {
    return this.#usage ? { ...this.#usage, windows: [...this.#usage.windows] } : null;
  }

  // --- internals -----------------------------------------------------------------

  get #logger(): AdapterLogger {
    return this.#context?.logger ?? this.#fallbackLogger;
  }

  async #probeAuthentication(): Promise<boolean | null> {
    try {
      const { stdout } = await execFileAsync(this.#config.executable, ["auth", "status"], {
        timeout: 15_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      // Keep only the boolean; the raw payload contains email/org identifiers.
      const parsed = JSON.parse(stdout) as { loggedIn?: unknown };
      return typeof parsed.loggedIn === "boolean" ? parsed.loggedIn : null;
    } catch {
      return null;
    }
  }

  #toNativeId(sessionId: string): string {
    const nativeId = decodePublicIdFor(sessionId, this.id);
    if (!nativeId) {
      throw new AdapterError("session_not_found", "The session id is not scoped to this provider.");
    }
    return nativeId;
  }

  #byNative(nativeId: string): ClaudeSessionState | undefined {
    return [...this.#sessions.values()].find((session) => session.nativeId === nativeId);
  }

  async #requireSession(sessionId: string): Promise<ClaudeSessionState> {
    const nativeId = this.#toNativeId(sessionId);
    const existing = this.#byNative(nativeId);
    if (existing) return existing;
    await this.getSession(sessionId);
    const created = this.#byNative(nativeId);
    if (!created) throw new AdapterError("session_not_found", `Unknown Claude session "${sessionId}".`);
    return created;
  }

  #sessionFromSummary(
    nativeId: string,
    projectId: string,
    title: string | null,
    mtimeMs: number,
    transcriptPath?: string,
  ): AgentSession {
    const publicId = createPublicId(this.id, nativeId);
    const timestamp = new Date(mtimeMs || Date.now()).toISOString();
    const session: AgentSession = {
      id: publicId,
      provider: this.id,
      projectId,
      title: title ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: "idle",
      model: null,
      mode: "default",
      thinkingLevel: null,
    };
    const state: ClaudeSessionState = {
      publicId,
      nativeId,
      projectId,
      projectPath: "",
      session,
      controller: null,
      started: true,
      model: null,
      mode: "default",
      effort: null,
      capabilities: [],
      alwaysRules: [],
      pending: new Map(),
      deniedTools: new Set(),
      listing: true,
      idleTimer: null,
      transcriptPath: transcriptPath ?? null,
    };
    this.#sessions.set(publicId, state);
    return session;
  }

  #emitForNative(type: AgentEventType, nativeSessionId: string, data: Record<string, unknown>): void {
    const session = this.#byNative(nativeSessionId);
    if (!session) return;
    this.#context?.emit({
      type,
      provider: this.id,
      projectId: session.projectId,
      sessionId: session.publicId,
      occurredAt: nowTimestamp(),
      data,
    } as AgentEvent);
  }

  #emit<T extends AgentEventType>(
    type: T,
    session: ClaudeSessionState,
    data: Extract<AgentEvent, { type: T }>["data"],
  ): void {
    this.#context?.emit({
      type,
      provider: this.id,
      projectId: session.projectId,
      sessionId: session.publicId,
      occurredAt: nowTimestamp(),
      data,
    } as AgentEvent);
  }

  #emitSessionUpdated(session: ClaudeSessionState): void {
    session.session.updatedAt = nowTimestamp();
    this.#emit("session.updated", session, { session: { ...session.session } });
  }

  async #ensureChannelServer(): Promise<void> {
    if (this.#channelServer) return;
    this.#channelServer = createServer((socket) => this.#handleChannelSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.#channelServer?.once("error", reject);
      this.#channelServer?.listen(0, "127.0.0.1", () => {
        const address = this.#channelServer?.address();
        if (address && typeof address === "object") this.#channelPort = address.port;
        resolve();
      });
    });
  }

  #handleChannelSocket(socket: Socket): void {
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index < 0 || handled) return;
      handled = true;
      let message: { type?: string; token?: string; ask?: ApprovalAsk };
      try {
        message = JSON.parse(buffer.slice(0, index));
      } catch {
        socket.end(encodeChannelLine({ type: "error", message: "Unreadable approval request." }));
        return;
      }
      if (message.type !== "ask" || message.token !== this.#channelToken || !message.ask) {
        socket.end(encodeChannelLine({ type: "error", message: "Unauthorized approval request." }));
        return;
      }
      void this.#handleAsk(socket, message.ask);
    });
    socket.on("error", () => undefined);
  }

  async #handleAsk(socket: Socket, ask: ApprovalAsk): Promise<void> {
    const session = this.#byNative(ask.sessionId);
    if (!session) {
      socket.end(encodeChannelLine({ type: "error", message: "The Homebase session is not active." }));
      return;
    }
    if (!session.projectPath && session.transcriptPath) {
      // Lazily recover the cwd for transcript-backed sessions.
      const configDir = resolveClaudeConfigDir(this.#config.configDir);
      const located = locateTranscript(configDir, session.nativeId);
      if (located?.cwd) session.projectPath = located.cwd;
    }

    if (ask.toolName === "AskUserQuestion") {
      await this.#askQuestion(socket, session, ask);
      return;
    }

    if (matchesRule(session.alwaysRules, ask.toolName, ask.input)) {
      socket.end(encodeChannelLine({ type: "decision", decision: { behavior: "allow", updatedInput: ask.input } }));
      return;
    }

    const publicRequestId = createPublicId(this.id, `per_${randomUUID()}`);
    const approval = {
      id: publicRequestId,
      sessionId: session.publicId,
      provider: this.id,
      createdAt: nowTimestamp(),
      kind: kindForTool(ask.toolName),
      title: titleForAsk(ask),
      detail: resourcesOf(ask.toolName, ask.input).join(", ") || null,
      toolCallId: ask.toolUseId,
      options: [
        { id: "allow_once", label: "Allow once", kind: "allow_once" as const },
        { id: "allow_always", label: "Always allow (this session)", kind: "allow_always" as const },
        { id: "deny", label: "Deny", kind: "deny" as const },
      ],
    };
    this.#emit("approval.requested", session, { approval });
    session.session.state = "waiting";
    this.#emitSessionUpdated(session);

    const decision = await this.#awaitDecision(session, {
      publicRequestId,
      kind: "approval",
      toolName: ask.toolName,
      input: ask.input,
      resolve: () => undefined,
      timer: setTimeout(() => undefined, 0),
    });
    socket.end(encodeChannelLine({ type: "decision", decision }));
  }

  async #askQuestion(socket: Socket, session: ClaudeSessionState, ask: ApprovalAsk): Promise<void> {
    const questions = nativeQuestions(ask.input);
    const publicRequestId = createPublicId(this.id, `qst_${randomUUID()}`);
    this.#emit("question.requested", session, {
      question: {
        id: publicRequestId,
        sessionId: session.publicId,
        provider: this.id,
        createdAt: nowTimestamp(),
        title: "Claude question",
        questions: toAgentQuestions(questions),
      },
    });
    session.session.state = "waiting";
    this.#emitSessionUpdated(session);

    const decision = await this.#awaitDecision(session, {
      publicRequestId,
      kind: "question",
      toolName: ask.toolName,
      input: ask.input,
      resolve: () => undefined,
      timer: setTimeout(() => undefined, 0),
    });
    socket.end(encodeChannelLine({ type: "decision", decision }));
  }

  #awaitDecision(session: ClaudeSessionState, pending: PendingRequest): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      const entry: PendingRequest = { ...pending, timer: setTimeout(() => undefined, 0), resolve };
      entry.timer = setTimeout(() => {
        if (session.pending.get(pending.publicRequestId) === entry) {
          this.#settlePending(entry, { behavior: "deny", message: "The approval request timed out." }, session, {
            optionId: "deny",
            answers: [],
          });
        }
      }, this.#config.approvalTimeoutMs);
      session.pending.set(pending.publicRequestId, entry);
    });
  }

  #settlePending(
    pending: PendingRequest,
    decision: ApprovalDecision,
    session: ClaudeSessionState | undefined,
    meta: { optionId: string; answers: AgentQuestionAnswerItem[] },
  ): void {
    clearTimeout(pending.timer);
    session?.pending.delete(pending.publicRequestId);
    if (session) {
      session.session.state =
        session.pending.size > 0 ? "waiting" : this.#normalizer?.isRunning(session.nativeId) ? "working" : "idle";
      this.#emitSessionUpdated(session);
      if (pending.kind === "approval") {
        this.#emit("approval.resolved", session, {
          resolution: {
            requestId: pending.publicRequestId,
            optionId: meta.optionId,
            resolvedAt: nowTimestamp(),
            resolvedBy: "user",
          },
        });
      } else {
        this.#emit("question.resolved", session, {
          resolution: { requestId: pending.publicRequestId, answers: meta.answers, resolvedAt: nowTimestamp() },
        });
      }
    }
    pending.resolve(decision);
  }

  #findPending(publicRequestId: string): PendingRequest | undefined {
    for (const session of this.#sessions.values()) {
      const pending = session.pending.get(publicRequestId);
      if (pending) return pending;
    }
    return undefined;
  }

  #sessionOfPending(pending: PendingRequest): ClaudeSessionState | undefined {
    for (const session of this.#sessions.values()) {
      if (session.pending.has(pending.publicRequestId)) return session;
    }
    return undefined;
  }

  async #prompt(sessionId: string, input: SendMessageInput, mode: "send" | "steer" | "queue"): Promise<void> {
    const session = await this.#requireSession(sessionId);
    await this.#ensureProcess(session).catch((error) => {
      throw toAdapterError(error);
    });
    const content = await this.#buildContent(input);
    const message: Record<string, unknown> = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      uuid: randomUUID(),
      session_id: session.nativeId,
    };
    if (mode === "steer") message.priority = "now";
    else if (mode === "queue") message.priority = "next";
    else if (this.#normalizer?.isRunning(session.nativeId)) message.priority = "next";

    if (!session.controller?.writeUserMessage(message)) {
      throw new AdapterError("provider_error", "Claude Code is not accepting input.");
    }
    if (session.session.state !== "working") {
      session.session.state = "working";
      this.#emitSessionUpdated(session);
    }
  }

  async #buildContent(input: SendMessageInput): Promise<unknown> {
    const blocks: Array<Record<string, unknown>> = [{ type: "text", text: input.text }];
    for (const ref of input.attachments ?? []) {
      if (ref.kind !== "image") {
        throw new AdapterError(
          "unsupported_capability",
          "Claude Code only accepts image attachments through Homebase.",
        );
      }
      const attachment: ResolvedAttachment = await this.#resolveAttachment(ref.id);
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: Buffer.from(attachment.bytes).toString("base64"),
        },
      });
    }
    return blocks;
  }

  async #resolveAttachment(attachmentId: string): Promise<ResolvedAttachment> {
    const context = this.#context;
    if (!context) throw new AdapterError("internal", "ClaudeAdapter.init() has not been called.");
    try {
      return await context.resolveAttachment(attachmentId);
    } catch (error) {
      throw error instanceof AdapterError
        ? error
        : new AdapterError("invalid_attachment", "Attachment could not be resolved.");
    }
  }

  async #ensureProcess(session: ClaudeSessionState): Promise<void> {
    if (session.controller?.alive) return;
    this.#clearIdleTimer(session);

    if (session.transcriptPath === null) {
      const configDir = resolveClaudeConfigDir(this.#config.configDir);
      session.transcriptPath = locateTranscript(configDir, session.nativeId)?.filePath ?? null;
    }
    if (session.transcriptPath) session.started = true;
    if (!session.projectPath) {
      session.projectPath = (await this.#context?.resolveProjectPath(session.projectId).catch(() => null)) ?? "";
    }

    const mcpConfig = this.#ensureMcpConfig();
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompt-tool",
      "mcp__homebase__approve",
      "--mcp-config",
      mcpConfig,
      "--strict-mcp-config",
    ];
    if (session.model) args.push("--model", session.model);
    if (session.effort) args.push("--effort", session.effort);
    const cli = cliMode(session.mode);
    if (cli) args.push("--permission-mode", cli);

    if (session.started) args.push("--resume", session.nativeId);
    else args.push("--session-id", session.nativeId);

    const controller = new ClaudeProcessController({
      executable: this.#config.executable,
      args: [...this.#launchPrefix, ...args],
      cwd: session.projectPath || undefined,
      env: {
        ...this.#extraEnv,
        HOMEBASE_APPROVAL_PORT: String(this.#channelPort),
        HOMEBASE_APPROVAL_TOKEN: this.#channelToken,
        HOMEBASE_CLAUDE_SESSION: session.nativeId,
        HOMEBASE_APPROVAL_TIMEOUT_MS: String(this.#config.approvalTimeoutMs),
        MCP_TOOL_TIMEOUT: String(this.#config.approvalTimeoutMs),
      },
      handlers: {
        onFrame: (frame) => this.#normalizer?.feed(frame, session.nativeId),
        onInit: () => this.#markStarted(session),
        onExit: (info) => this.#onProcessExit(session, info.code, info.signal, info.reason),
        onStderrLine: (line) => this.#logger.debug("Claude stderr", { line: line.slice(0, 300) }),
      },
    });
    session.controller = controller;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      // The CLI may not emit `init` until it receives input in stream-json
      // mode, so treat a short quiet period as "ready to accept input" and let
      // the init frame refine session metadata when it arrives.
      const grace = setTimeout(finish, 1_500);
      const timeout = setTimeout(() => {
        controller.stop();
        reject(new ClaudeProcessError("provider_error", "Claude Code did not finish starting up."));
      }, this.#config.startupTimeoutMs);
      const settle = (callback: () => void) => {
        clearTimeout(grace);
        clearTimeout(timeout);
        callback();
      };

      controller.start();
      controller.onceExit((info) => {
        if (settled) return;
        settled = true;
        clearTimeout(grace);
        clearTimeout(timeout);
        reject(new ClaudeProcessError("provider_error", `Claude Code exited before starting (${info.reason}).`));
      });
      controller.onceInit(() => settle(finish));
    });
  }

  #markStarted(session: ClaudeSessionState): void {
    session.started = true;
  }

  #onInit(nativeSessionId: string, frame: NativeInitFrame): void {
    const session = this.#byNative(nativeSessionId);
    if (!session) return;
    session.capabilities = Array.isArray(frame.capabilities) ? frame.capabilities : [];
    if (typeof frame.model === "string" && frame.model.length > 0 && !frame.model.startsWith("<")) {
      session.model = frame.model;
      session.session.model = { provider: this.id, modelId: frame.model, thinkingLevel: session.effort };
    }
    if (typeof frame.permissionMode === "string") {
      session.mode = normalizeMode(frame.permissionMode);
      session.session.mode = session.mode;
    }
    session.session.state = "idle";
    this.#emitSessionUpdated(session);
  }

  #onResult(nativeSessionId: string, frame: NativeResultFrame): void {
    const session = this.#byNative(nativeSessionId);
    if (!session) return;
    const terminal = classifyResultFrame(frame);
    const turnId = this.#normalizer?.endTurn(nativeSessionId) ?? null;
    if (turnId) {
      if (terminal === "interrupted") {
        this.#emit("turn.interrupted", session, { turnId });
      } else if (terminal === "failed") {
        this.#emit("turn.failed", session, {
          turnId,
          error: {
            code: "provider_error",
            message: frame.result ?? "Claude Code reported an error.",
            provider: this.id,
          },
        });
      } else {
        this.#emit("turn.completed", session, { turnId });
      }
    }
    session.session.state = terminal === "failed" ? "failed" : session.pending.size > 0 ? "waiting" : "idle";
    this.#emitSessionUpdated(session);
    this.#armIdleTimer(session);
  }

  #onRateLimit(_nativeSessionId: string, info: Record<string, unknown>): void {
    const unified = info.unifiedWindows as Record<string, { utilization?: number; resetsAt?: number }> | undefined;
    if (!unified) return;
    const windows: AgentUsageWindow[] = [];
    const labels: Record<string, string> = {
      five_hour: "5 hour",
      seven_day: "Week",
      seven_day_opus: "Week · Opus",
      seven_day_sonnet: "Week · Sonnet",
    };
    const order = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];
    for (const key of [...order, ...Object.keys(unified).filter((key) => !order.includes(key))]) {
      const window = unified[key];
      if (!window || typeof window.utilization !== "number" || !Number.isFinite(window.utilization)) continue;
      windows.push({
        id: key,
        label: labels[key] ?? key.replace(/_/g, " "),
        unit: "percent",
        usedPercent: Math.max(0, Math.min(100, Math.round(window.utilization * 1000) / 10)),
        resetsAt: typeof window.resetsAt === "number" ? new Date(window.resetsAt * 1000).toISOString() : null,
      });
    }
    if (windows.length === 0) return;
    const now = Date.now();
    // A window whose reset has passed is back to zero.
    for (const window of windows) {
      if (window.resetsAt && Date.parse(window.resetsAt) <= now) {
        window.usedPercent = 0;
        window.resetsAt = null;
      }
    }
    this.#usage = { provider: this.id, windows, fetchedAt: nowTimestamp() };
  }

  #armIdleTimer(session: ClaudeSessionState): void {
    this.#clearIdleTimer(session);
    const timer = setTimeout(() => {
      session.idleTimer = null;
      if (session.pending.size > 0) return; // never kill a process holding a pending approval
      session.controller?.stop();
      session.controller = null;
      session.started = true; // transcript exists; next prompt resumes
      this.#logger.debug("Claude session idled out; the next prompt resumes it.", { sessionId: session.publicId });
    }, this.#config.idleTimeoutMs);
    timer.unref?.();
    session.idleTimer = timer;
  }

  #clearIdleTimer(session: ClaudeSessionState): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  #onProcessExit(session: ClaudeSessionState, code: number | null, signal: string | null, reason: string): void {
    this.#clearIdleTimer(session);
    session.controller = null;
    if (this.#disposed) return;
    const turnId = this.#normalizer?.endTurn(session.nativeId) ?? null;
    if (turnId || session.pending.size > 0) {
      for (const pending of [...session.pending.values()]) {
        this.#settlePending(
          pending,
          { behavior: "deny", message: "The Claude Code process exited before it was answered." },
          session,
          { optionId: "deny", answers: [] },
        );
      }
    }
    if (turnId) {
      this.#emit("turn.failed", session, {
        turnId,
        error: {
          code: "provider_error",
          message: reason || `Claude Code exited (code ${code ?? "unknown"}, signal ${signal ?? "none"}).`,
          provider: this.id,
        },
      });
      session.session.state = "failed";
      this.#emitSessionUpdated(session);
    }
  }

  #ensureMcpConfig(): string {
    if (this.#mcpConfigPath) return this.#mcpConfigPath;
    const dir = path.join(tmpdir(), `homebase-claude-${randomUUID()}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const configPath = path.join(dir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          homebase: {
            type: "stdio",
            command: process.execPath,
            args: [this.#mcpServerPath],
          },
        },
      }),
      "utf8",
    );
    this.#tempDir = dir;
    this.#mcpConfigPath = configPath;
    return configPath;
  }
}

function clampPageSize(limit: number | null | undefined, fallback: number): number {
  if (limit == null) return fallback;
  return Math.max(1, Math.min(limit, 200));
}

function decodeOffsetCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const match = /^claude:(\d+)$/.exec(cursor);
  if (!match) throw new AdapterError("invalid_request", "Invalid Claude pagination cursor.");
  return Number.parseInt(match[1] ?? "0", 10);
}

function approvalDecision(optionId: string): "allow_once" | "allow_always" | "deny" | null {
  if (optionId === "allow_once" || optionId === "once") return "allow_once";
  if (optionId === "allow_always" || optionId === "always") return "allow_always";
  if (optionId === "deny" || optionId === "reject") return "deny";
  return null;
}

function kindForTool(toolName: string): "tool" | "command" | "file" | "plan" | "other" {
  if (/^(bash|powershell)$/i.test(toolName)) return "command";
  if (/^(edit|write|notebookedit|multiedit)$/i.test(toolName)) return "file";
  if (/^plan/i.test(toolName)) return "plan";
  if (/^(glob|grep|task|webfetch|websearch|todowrite|read)$/i.test(toolName)) return "tool";
  return "other";
}

function titleForAsk(ask: ApprovalAsk): string {
  const resources = resourcesOf(ask.toolName, ask.input);
  if (resources.length > 0) return `${ask.toolName}: ${resources[0]?.slice(0, 120)}`;
  return `${ask.toolName} requested`;
}
