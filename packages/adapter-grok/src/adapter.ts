import {
  AdapterError,
  createConsoleLogger,
  decodePublicIdFor,
  runExecutable,
  type AdapterContext,
  type AdapterLogger,
  type AgentAdapter,
  type ExecutableFailure,
  type RunExecutable,
  type SpawnExecutable,
} from "@homebase/adapter-sdk";
import {
  defineCapabilities,
  noCapabilities,
  toAgentPage,
  type AgentCapabilities,
  type AgentMessage,
  type AgentMode,
  type AgentModel,
  type AgentPage,
  type AgentProject,
  type AgentSession,
  type ApprovalResult,
  type CreateSessionInput,
  type PageRequest,
  type ProviderDetection,
  type SendMessageInput,
  type SetModelInput,
  type SetModeInput,
} from "@homebase/protocol";
import {
  AcpTransport,
  isAcpTransportError,
  type AcpClientHandlers,
  type AcpInitializeResult,
} from "@homebase/transport-acp";
import type { ContentBlock, SessionConfigOption } from "@agentclientprotocol/sdk";

import { grokArguments, grokEnvironment, parseGrokConfig, type GrokConfig } from "./config.js";
import { parseGrokVersion, toAdapterError, versionCompatibility } from "./errors.js";
import {
  catalogFromInitializeMeta,
  findSelectOption,
  isModelConfigOption,
  isThoughtLevelConfigOption,
  modelsFromConfigOptions,
  modesFromModeState,
} from "./mapper.js";
import { GrokPermissionBridge } from "./permissions.js";
import { GrokSessionTracker, type GrokSessionRecord } from "./session-state.js";

export const GROK_PROVIDER_ID = "grok";

export interface GrokAdapterOptions {
  /** Raw `providers.grok.config` object; validated here. */
  config?: Readonly<Record<string, unknown>>;
  /** Test hook: spawner used by the ACP transport. */
  spawnFn?: SpawnExecutable;
  /** Test hook: version command runner. */
  runFn?: RunExecutable;
}

interface ActiveTurn {
  turnId: string;
  task: Promise<void>;
}

/**
 * Grok Build adapter built on the generic ACP v1 transport.
 *
 * Design rules:
 * - Grok owns its authentication; Homebase stores and forwards no xAI
 *   credentials and never starts an interactive login.
 * - Prompts run as background turn tasks so an HTTP send returns immediately.
 * - Session listing is always project-scoped; sessions outside configured
 *   roots are never exposed.
 * - Permission requests become first-class Homebase approval cards and are
 *   never auto-approved.
 */
export class GrokAdapter implements AgentAdapter {
  readonly id = GROK_PROVIDER_ID;
  readonly displayName = "Grok";

  readonly #config: GrokConfig;
  readonly #options: GrokAdapterOptions;
  #context: AdapterContext | null = null;
  #tracker: GrokSessionTracker | null = null;
  #permissions: GrokPermissionBridge | null = null;
  #fallbackLogger: AdapterLogger;

  #transport: AcpTransport | null = null;
  #connecting: Promise<AcpTransport> | null = null;
  #authRefresh: Promise<void> | null = null;
  #initializeResult: AcpInitializeResult | null = null;
  #cliVersion: string | null = null;
  #authenticated: boolean | null = null;
  #authWarning: string | null = null;
  #modelCatalog: AgentModel[] = [];
  #modeCatalog: AgentMode[] = [];
  #disposed = false;
  readonly #activeTurns = new Map<string, ActiveTurn>();

  /**
   * Connection lifecycle invariants (also relied on by concurrent Host probing,
   * which calls `detect()` and `getCapabilities()` through `Promise.all`):
   *
   * 1. At most one current transport is owned; process-specific state
   *    (`#transport`, `#initializeResult`, auth state, catalogs) always belongs
   *    to it.
   * 2. At most one connection attempt is in flight (`#connecting` is the
   *    single-flight join point).
   * 3. At most one signed-out recycle is in flight (`#authRefresh`); it only
   *    tears down the old process and never establishes a connection itself,
   *    so waiting on it cannot deadlock.
   * 4. Exit callbacks are transport-identity aware: a transport that is no
   *    longer current can never clear replacement state or fail replacement
   *    turns/permissions.
   * 5. A connect that finishes after dispose, or whose process died during
   *    startup, is never installed; it is stopped instead.
   * 6. A provider refresh never recycles while a turn is active, and never
   *    restarts a healthy authenticated transport.
   */

  constructor(options: GrokAdapterOptions = {}) {
    this.#options = options;
    this.#config = parseGrokConfig(options.config ?? {});
    this.#fallbackLogger = createConsoleLogger("provider:grok", { level: "warn" });
  }

  init(context: AdapterContext): void {
    this.#context = context;
    this.#tracker = new GrokSessionTracker({
      provider: this.id,
      emit: (event) => context.emit(event),
      logger: context.logger,
    });
    this.#permissions = new GrokPermissionBridge({
      provider: this.id,
      emit: (event) => context.emit(event),
      logger: context.logger,
    });
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    for (const [nativeId, active] of [...this.#activeTurns]) {
      this.#tracker?.finishTurn(nativeId, { kind: "failed", message: "The Grok adapter was disposed." });
      void active;
    }
    this.#activeTurns.clear();
    this.#permissions?.cancelAll();
    const transport = this.#transport;
    this.#transport = null;
    this.#initializeResult = null;
    this.#authenticated = null;
    this.#authWarning = null;
    this.#modelCatalog = [];
    this.#modeCatalog = [];
    await transport?.stop();
    // Let an in-flight recycle finish tearing down its process, and let an
    // in-flight connect observe `#disposed` and stop the process it started.
    await this.#authRefresh?.catch(() => undefined);
    await this.#connecting?.catch(() => undefined);
  }

  async detect(): Promise<ProviderDetection> {
    try {
      await this.#refreshUnauthenticatedTransportIfNeeded();
      await this.#ensureTransport();
      const compatibility = versionCompatibility(this.#cliVersion);
      if (this.#authenticated === false) {
        return {
          installed: true,
          authenticated: false,
          compatible: compatibility.compatible,
          version: this.#cliVersion,
          warning: this.#authWarning ?? "Grok is installed but not signed in. Run `grok login` on the Host.",
        };
      }
      return {
        installed: true,
        authenticated: this.#authenticated,
        compatible: compatibility.compatible,
        version: this.#cliVersion,
        warning: compatibility.warning ?? null,
      };
    } catch (error) {
      const adapterError = toAdapterError(error);
      if (adapterError.code === "provider_not_installed") {
        return {
          installed: false,
          authenticated: null,
          compatible: false,
          version: null,
          warning: adapterError.message,
        };
      }
      if (adapterError.code === "provider_incompatible") {
        return {
          installed: true,
          authenticated: null,
          compatible: false,
          version: this.#cliVersion,
          warning: adapterError.message,
        };
      }
      return {
        installed: this.#cliVersion !== null,
        authenticated: null,
        compatible: false,
        version: this.#cliVersion,
        warning: adapterError.message,
      };
    }
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    // A concurrent provider refresh may be recycling a signed-out process;
    // wait for it so capabilities are computed from the resulting connection
    // instead of a transiently cleared initialize result.
    const refresh = this.#authRefresh;
    if (refresh) await refresh.catch(() => undefined);
    if (!this.#initializeResult) {
      try {
        await this.#ensureTransport();
      } catch {
        return noCapabilities;
      }
    }
    const init = this.#initializeResult;
    if (!init) return noCapabilities;
    const agentCapabilities = init.agentCapabilities ?? {};
    const sessionCapabilities = agentCapabilities.sessionCapabilities ?? {};
    const models = this.#modelCatalog.length > 0;
    const thinkingLevels = this.#modelCatalog.some((model) => (model.thinkingLevels?.length ?? 0) > 0);
    return defineCapabilities({
      resume: agentCapabilities.loadSession === true || !!sessionCapabilities.resume,
      deleteSession: !!sessionCapabilities.delete,
      streaming: true,
      interrupt: true,
      steer: false,
      queue: false,
      models,
      modelSwitching: models,
      thinkingLevels,
      modes: this.#modeCatalog.length > 0,
      attachments: false,
      imageInput: agentCapabilities.promptCapabilities?.image === true,
      tools: true,
      approvals: true,
      // Standard ACP elicitation is not yet surfaced; Grok question support is
      // not implemented in Phase 5.5.
      questions: false,
      plans: true,
      diffs: false,
      usage: false,
      slashCommands: false,
    });
  }

  async listModels(_project: AgentProject): Promise<AgentModel[]> {
    await this.#ensureTransport().catch(() => undefined);
    return this.#modelCatalog.map((model) => structuredClone(model));
  }

  async listModes(_project: AgentProject): Promise<AgentMode[]> {
    await this.#ensureTransport().catch(() => undefined);
    return this.#modeCatalog.map((mode) => structuredClone(mode));
  }

  async listSessions(project: AgentProject, page: PageRequest = {}): Promise<AgentPage<AgentSession>> {
    const transport = await this.#ensureTransport();
    if (!this.#initializeResult?.agentCapabilities?.sessionCapabilities?.list) {
      throw new AdapterError("unsupported_capability", "Grok does not advertise session listing.");
    }
    const response = await transport.listSessions({
      cwd: project.path,
      ...(page.cursor ? { cursor: page.cursor } : {}),
    });
    const items: AgentSession[] = [];
    for (const info of response.sessions) {
      const projectId = await this.#context?.findProjectByPath(info.cwd).catch(() => null);
      if (!projectId || projectId !== project.id) continue; // project-scoped only
      const record = this.#tracker!.registerSession({
        nativeId: info.sessionId,
        projectId,
        cwd: info.cwd,
        title: info.title ?? null,
        cold: true,
      });
      if (info.updatedAt) record.updatedAt = info.updatedAt;
      items.push(this.#tracker!.toAgentSession(record));
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return toAgentPage(items, { next: response.nextCursor ?? null, previous: null });
  }

  async getSession(sessionId: string): Promise<AgentSession> {
    const record = this.#requireRecord(sessionId);
    return this.#tracker!.toAgentSession(record);
  }

  async createSession(input: CreateSessionInput, project: AgentProject): Promise<AgentSession> {
    if (input.provider !== this.id) {
      throw new AdapterError("invalid_request", `This adapter only serves provider "${this.id}".`);
    }
    const transport = await this.#ensureTransport();
    const response = await transport.newSession({ cwd: project.path, mcpServers: [] });
    const record = this.#tracker!.registerSession({
      nativeId: response.sessionId,
      projectId: project.id,
      cwd: project.path,
      title: input.title ?? null,
      configOptions: response.configOptions ?? [],
      modeState: response.modes ?? null,
      cold: false,
    });
    this.#noteConfigOptions(record);
    return this.#tracker!.toAgentSession(record);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const record = this.#requireRecord(sessionId);
    if (!this.#initializeResult?.agentCapabilities?.sessionCapabilities?.delete) {
      throw new AdapterError("unsupported_capability", "Grok does not advertise session deletion.");
    }
    const transport = await this.#ensureTransport();
    await transport.deleteSession(record.nativeId);
    this.#tracker!.removeSession(record.nativeId);
  }

  async listMessages(sessionId: string, page: PageRequest = {}): Promise<AgentPage<AgentMessage>> {
    const record = this.#requireRecord(sessionId);
    if (record.messages.length === 0 && !this.#tracker!.isWorking(record.nativeId)) {
      await this.#loadHistory(record).catch((error: unknown) => {
        this.#logger.debug("Grok history replay failed.", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return this.#tracker!.listMessages(record, page);
  }

  async send(sessionId: string, input: SendMessageInput): Promise<void> {
    const record = this.#requireRecord(sessionId);
    if (this.#activeTurns.has(record.nativeId)) {
      throw new AdapterError("conflict", "Grok is already working on this session; wait for the turn to finish.");
    }
    const transport = await this.#ensureTransport();
    const prompt = await this.#promptBlocks(input);
    // Homebase knows the submitted prompt; record it locally before the model
    // turn because real Grok does not live-echo user messages without an
    // extension Homebase deliberately does not depend on.
    this.#tracker!.recordLocalUserMessage(record.nativeId, {
      text: input.text,
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
    });
    const turn = this.#tracker!.beginTurn(record.nativeId);
    const task = this.#runTurn(transport, record, prompt);
    this.#activeTurns.set(record.nativeId, { turnId: turn.turnId, task });
    // `send` resolves on acceptance; progress and completion arrive as events.
    void task;
  }

  async interrupt(sessionId: string): Promise<void> {
    const record = this.#requireRecord(sessionId);
    const transport = await this.#ensureTransport();
    this.#permissions?.cancelSession(record.nativeId, "system");
    await transport.cancel(record.nativeId);
  }

  async resolveApproval(requestId: string, result: ApprovalResult): Promise<void> {
    const bridge = this.#requirePermissions();
    bridge.resolve(requestId, result);
  }

  async setModel(sessionId: string, input: SetModelInput): Promise<void> {
    const record = this.#requireRecord(sessionId);
    const transport = await this.#ensureTransport();
    const option = findSelectOption(record.configOptions, isModelConfigOption);
    if (!option) {
      throw new AdapterError("unsupported_capability", "Grok did not advertise a model selector for this session.");
    }
    const response = await transport.setConfigValue(record.nativeId, option.id, input.modelId);
    this.#tracker!.updateConfigOptions(record, response.configOptions ?? record.configOptions);
    if (input.thinkingLevel) {
      const thought = findSelectOption(record.configOptions, isThoughtLevelConfigOption);
      if (thought) {
        const updated = await transport.setConfigValue(record.nativeId, thought.id, input.thinkingLevel);
        this.#tracker!.updateConfigOptions(record, updated.configOptions ?? record.configOptions);
      }
    }
  }

  async setMode(sessionId: string, input: SetModeInput): Promise<void> {
    const record = this.#requireRecord(sessionId);
    const transport = await this.#ensureTransport();
    await transport.setSessionMode(record.nativeId, input.mode);
    this.#tracker!.updateMode(record, input.mode);
  }

  // --- internals -----------------------------------------------------------------

  get #logger(): AdapterLogger {
    return this.#context?.logger ?? this.#fallbackLogger;
  }

  #requireContext(): AdapterContext {
    if (!this.#context) throw new AdapterError("internal", "GrokAdapter.init() has not been called.");
    return this.#context;
  }

  #requireTracker(): GrokSessionTracker {
    if (!this.#tracker) throw new AdapterError("internal", "GrokAdapter.init() has not been called.");
    return this.#tracker;
  }

  #requirePermissions(): GrokPermissionBridge {
    if (!this.#permissions) throw new AdapterError("internal", "GrokAdapter.init() has not been called.");
    return this.#permissions;
  }

  #requireRecord(sessionId: string): GrokSessionRecord {
    const nativeId = decodePublicIdFor(sessionId, this.id);
    if (!nativeId) {
      throw new AdapterError("session_not_found", "The session id is not scoped to this provider.");
    }
    const record = this.#requireTracker().get(nativeId);
    if (!record) {
      throw new AdapterError(
        "session_not_found",
        "Grok session not found. Open the project so Homebase can discover its Grok sessions.",
      );
    }
    return record;
  }

  async #ensureTransport(): Promise<AcpTransport> {
    // Join any in-flight signed-out recycle first so a replacement is only
    // established after the old process has been torn down. The recycle only
    // stops the old transport (it never calls back into this method), so this
    // wait cannot deadlock.
    const refresh = this.#authRefresh;
    if (refresh) await refresh.catch(() => undefined);
    if (this.#disposed) throw new AdapterError("internal", "The Grok adapter was disposed.");

    if (this.#transport?.initialized && this.#transport.alive) return this.#transport;
    if (this.#connecting) return await this.#connecting;
    const attempt = this.#connect();
    this.#connecting = attempt;
    try {
      return await attempt;
    } finally {
      if (this.#connecting === attempt) this.#connecting = null;
    }
  }

  /**
   * Explicit provider detection is the only place a signed-out Grok transport
   * is recycled. This lets `grok login` on the Host be picked up by the next
   * provider refresh without restarting Homebase. Background reconnects never
   * do this, and an active model turn is never interrupted.
   */
  async #refreshUnauthenticatedTransportIfNeeded(): Promise<void> {
    if (this.#authenticated !== false || this.#disposed) return;
    if (this.#activeTurns.size > 0) return; // protect user work in progress
    await this.#recycleUnauthenticatedTransport();
  }

  async #recycleUnauthenticatedTransport(): Promise<void> {
    if (this.#authRefresh) return await this.#authRefresh;
    const task = this.#resetAndStopTransport();
    this.#authRefresh = task;
    try {
      await task;
    } finally {
      if (this.#authRefresh === task) this.#authRefresh = null;
    }
  }

  /**
   * Drops only ACP-process state (endpoint, initialize result, auth state,
   * catalogs) so the next connect re-initializes and re-authenticates. Session
   * history stays authoritative and is never discarded for an auth refresh.
   *
   * `#transport` is detached before stopping, so the old process's exit
   * callback is identity-gated as stale and cannot touch the replacement.
   */
  async #resetAndStopTransport(): Promise<void> {
    const transport = this.#transport;
    this.#transport = null;
    this.#initializeResult = null;
    this.#authenticated = null;
    this.#authWarning = null;
    this.#modelCatalog = [];
    this.#modeCatalog = [];
    await transport?.stop();
  }

  async #connect(): Promise<AcpTransport> {
    if (this.#disposed) throw new AdapterError("internal", "The Grok adapter was disposed.");
    const cliVersion = await this.#detectCliVersion();
    const handlers: AcpClientHandlers = {
      onSessionUpdate: (notification) => this.#tracker?.handleUpdate(notification),
      onPermissionRequest: (request) => this.#handlePermission(request),
    };
    const transport = new AcpTransport({
      command: this.#config.executable,
      args: grokArguments(),
      env: grokEnvironment(),
      clientName: "homebase",
      clientVersion: this.#requireContext().hostVersion,
      startupTimeoutMs: this.#config.startupTimeoutMs,
      controlTimeoutMs: this.#config.controlTimeoutMs,
      shutdownTimeoutMs: this.#config.shutdownTimeoutMs,
      stderrLimitBytes: this.#config.stderrLimitBytes,
      handlers,
      ...(this.#options.spawnFn !== undefined ? { spawnFn: this.#options.spawnFn } : {}),
      logger: {
        debug: (message, fields) => this.#logger.debug(message, fields),
        info: (message, fields) => this.#logger.info(message, fields),
        warn: (message, fields) => this.#logger.warn(message, fields),
        error: (message, fields) => this.#logger.error(message, fields),
      },
    });

    let init: AcpInitializeResult;
    try {
      init = await transport.start();
    } catch (error) {
      throw this.#connectionError(error, cliVersion);
    }

    // Authenticate before installing so a transport that dies during startup is
    // never adopted as the current one. Connection-dependent fields are only
    // installed after every await has completed.
    await this.#authenticate(transport, init);
    if (this.#disposed || !transport.initialized || !transport.alive) {
      await transport.stop().catch(() => undefined);
      throw new AdapterError(
        "provider_unavailable",
        "The Grok ACP process exited during startup before it could be used.",
      );
    }

    this.#applyInitializeCatalog(init);
    this.#transport = transport;
    this.#initializeResult = init;
    this.#cliVersion = cliVersion;
    // Identity-aware exit: a replaced transport must never mutate state that
    // belongs to its replacement. Registration can fire immediately when the
    // process has already exited, so re-check liveness afterwards.
    transport.onExit(() => this.#handleTransportExit(transport));
    if (this.#disposed || !transport.alive) {
      await transport.stop().catch(() => undefined);
      throw new AdapterError(
        "provider_unavailable",
        "The Grok ACP process exited during startup before it could be used.",
      );
    }
    this.#logger.info("Grok ACP connected.", { version: cliVersion ?? "unknown" });
    return transport;
  }

  async #detectCliVersion(): Promise<string | null> {
    if (this.#cliVersion) return this.#cliVersion;
    const runner = this.#options.runFn ?? runExecutable;
    try {
      const result = await runner(this.#config.executable, ["--version"], {
        timeoutMs: 5_000,
        maxOutputBytes: 16 * 1024,
      });
      const version = parseGrokVersion(`${result.stdout}\n${result.stderr}`);
      if (version) this.#cliVersion = version;
      return version;
    } catch (error) {
      const failure = error as ExecutableFailure;
      if (failure.kind === "not_found") {
        throw new AdapterError(
          "provider_not_installed",
          "The Grok CLI was not found on PATH. Install Grok Build and run `grok login` on the Host, " +
            "or set providers.grok.config.executable.",
        );
      }
      this.#logger.warn("Grok CLI version detection failed.", { reason: failure.message });
      return null;
    }
  }

  #connectionError(error: unknown, cliVersion: string | null): AdapterError {
    if (error instanceof AdapterError) return error;
    if (isAcpTransportError(error)) {
      if (error.code === "protocol") {
        return new AdapterError(
          "provider_incompatible",
          `${error.message} Homebase supports stable ACP v1; update Homebase or pin a compatible Grok build.`,
          { cause: error },
        );
      }
      if (error.code === "spawn_failed" && cliVersion === null) {
        return new AdapterError("provider_not_installed", error.message, { cause: error });
      }
      return new AdapterError("provider_unavailable", error.message, { cause: error });
    }
    return toAdapterError(error);
  }

  #applyInitializeCatalog(init: AcpInitializeResult): void {
    const catalog = catalogFromInitializeMeta(init.meta, this.id);
    this.#modelCatalog = catalog.models;
    this.#modeCatalog = catalog.modes;
  }

  /** Extends the catalogs when a session reveals config options/modes. */
  #noteConfigOptions(record: GrokSessionRecord): void {
    const models = modelsFromConfigOptions(record.configOptions, this.id);
    if (models.length > 0 && this.#modelCatalog.length === 0) this.#modelCatalog = models;
    if (record.availableModes.length > 0 && this.#modeCatalog.length === 0) {
      this.#modeCatalog = record.availableModes;
    }
  }

  async #authenticate(transport: AcpTransport, init: AcpInitializeResult): Promise<void> {
    const methods = new Set(init.authMethods.map((method) => method.id));
    if (methods.size === 0) {
      this.#authenticated = true;
      this.#authWarning = null;
      return;
    }
    // Prefer non-interactive methods in order of least surprise. Interactive
    // methods (browser OAuth) are never started by Homebase.
    for (const methodId of ["cached_token", "xai.api_key"]) {
      if (!methods.has(methodId)) continue;
      try {
        await transport.authenticate(methodId);
        this.#authenticated = true;
        this.#authWarning = null;
        this.#logger.info("Grok authentication is available.", { method: methodId });
        return;
      } catch {
        // Try the next non-interactive method.
      }
    }
    this.#authenticated = false;
    this.#authWarning = "Grok is installed but not signed in. Run `grok login` on the Host.";
  }

  async #handlePermission(request: Parameters<NonNullable<AcpClientHandlers["onPermissionRequest"]>>[0]) {
    const tracker = this.#requireTracker();
    const bridge = this.#requirePermissions();
    const record = tracker.get(request.sessionId);
    if (!record) return { outcome: { outcome: "cancelled" as const } };
    const { requestId, response } = bridge.register(request, {
      nativeSessionId: record.nativeId,
      publicSessionId: record.publicId,
      projectId: record.projectId,
    });
    tracker.addPendingPermission(record.nativeId, requestId);
    tracker.notifyStateChanged(record);
    void response.finally(() => {
      tracker.removePendingPermission(record.nativeId, requestId);
      const current = tracker.get(record.nativeId);
      if (current) tracker.notifyStateChanged(current);
    });
    return await response;
  }

  async #runTurn(transport: AcpTransport, record: GrokSessionRecord, prompt: ContentBlock[]): Promise<void> {
    try {
      const response = await transport.prompt(record.nativeId, prompt);
      if (response.stopReason === "cancelled") {
        this.#tracker!.finishTurn(record.nativeId, { kind: "interrupted" });
      } else {
        this.#tracker!.finishTurn(record.nativeId, { kind: "completed" });
      }
    } catch (error) {
      const adapterError = toAdapterError(error);
      this.#tracker!.finishTurn(record.nativeId, { kind: "failed", message: adapterError.message });
    } finally {
      this.#activeTurns.delete(record.nativeId);
      this.#permissions?.cancelSession(record.nativeId, "system");
    }
  }

  async #loadHistory(record: GrokSessionRecord): Promise<void> {
    const init = this.#initializeResult;
    if (!init?.agentCapabilities?.loadSession) return;
    const transport = await this.#ensureTransport();
    const tracker = this.#requireTracker();
    tracker.beginReplay(record.nativeId);
    try {
      const response = await transport.loadSession({
        sessionId: record.nativeId,
        cwd: record.cwd,
        mcpServers: [],
      });
      tracker.markOpened(record);
      if (response?.configOptions) tracker.updateConfigOptions(record, response.configOptions as SessionConfigOption[]);
      if (response?.modes) {
        record.availableModes = modesFromModeState(response.modes);
        record.modeId = response.modes.currentModeId;
      }
      this.#noteConfigOptions(record);
    } finally {
      tracker.endReplay(record.nativeId);
    }
  }

  async #promptBlocks(input: SendMessageInput): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = [{ type: "text", text: input.text }];
    const attachments = input.attachments ?? [];
    if (attachments.length === 0) return blocks;
    const imageSupported = this.#initializeResult?.agentCapabilities?.promptCapabilities?.image === true;
    for (const ref of attachments) {
      const resolved = await this.#requireContext().resolveAttachment(ref.id);
      if (!resolved.mimeType.startsWith("image/")) {
        throw new AdapterError("invalid_request", "Grok accepts image attachments only.");
      }
      if (!imageSupported) {
        throw new AdapterError("unsupported_capability", "Grok does not advertise image prompt input.");
      }
      blocks.push({
        type: "image",
        data: Buffer.from(resolved.bytes).toString("base64"),
        mimeType: resolved.mimeType,
      });
    }
    return blocks;
  }

  /**
   * Exit handling is transport-identity aware. An exit callback from a
   * transport that has already been replaced (for example the signed-out
   * process recycled by a refresh) must never clear or fail state that belongs
   * to the current replacement transport.
   */
  #handleTransportExit(exitedTransport: AcpTransport): void {
    if (this.#transport !== exitedTransport) return;
    this.#transport = null;
    this.#initializeResult = null;
    this.#authenticated = null;
    this.#authWarning = null;
    this.#modelCatalog = [];
    this.#modeCatalog = [];
    for (const [nativeId] of this.#activeTurns) {
      this.#tracker?.finishTurn(nativeId, { kind: "failed", message: "The Grok ACP process exited." });
    }
    this.#activeTurns.clear();
    this.#permissions?.cancelAll();
  }
}
