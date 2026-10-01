import {
  AdapterError,
  createConsoleLogger,
  createPublicId,
  decodePublicIdFor,
  type AdapterContext,
  type AdapterLogger,
  type AgentAdapter,
  type ResolvedAttachment,
  type RunExecutable,
  type SpawnExecutable,
} from "@homebase/adapter-sdk";
import {
  defineCapabilities,
  nowTimestamp,
  toAgentPage,
  type AgentCapabilities,
  type AgentDiff,
  type AgentEvent,
  type AgentMessage,
  type AgentMode,
  type AgentModel,
  type AgentPage,
  type AgentProject,
  type AgentSession,
  type AgentSessionState,
  type AgentProviderUsage,
  type AgentSessionUsage,
  type ApprovalResult,
  type CreateSessionInput,
  type PageRequest,
  type ProviderDetection,
  type QuestionAnswer,
  type SendMessageInput,
  type SetModelInput,
  type SetModeInput,
} from "@homebase/protocol";

import { parseOpenCodeConfig, type OpenCodeConfig } from "./config.js";
import { toAdapterError, versionCompatibility } from "./errors.js";
import { SessionEventTracker } from "./events.js";
import { toSessionUsage } from "./usage.js";
import { OpenCodeSupervisor, OpenCodeConnectionClient } from "./supervisor.js";
import {
  OPENCODE_PROVIDER_ID,
  approvalOptionToDecision,
  toAgentDiff,
  toAgentMode,
  toAgentMessage,
  toAgentModel,
  toAgentSession,
  toFormAnswer,
  toNativeModelRef,
} from "./mapper.js";
import type {
  NativeAgent,
  NativeCursor,
  NativeEvent,
  NativeFileDiff,
  NativeForm,
  NativeMessage,
  NativeModel,
  NativePermissionRequest,
  NativeSession,
} from "./native.js";

export interface OpenCodeAdapterOptions {
  /** Raw `providers.opencode.config` object; validated here. */
  config?: Readonly<Record<string, unknown>>;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
  /** Test hook: keep the background event stream off. */
  startEventStream?: boolean;
  /** Test hook: base reconnect backoff. */
  reconnectBaseMs?: number;
  /** Test hook: injectable process spawner for managed-server tests. */
  spawnFn?: SpawnExecutable;
  /** Test hook: injectable bounded command runner for CLI detection tests. */
  runFn?: RunExecutable;
  /** Test hook: injectable sleep for fast startup timers. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SESSION_PAGE_SIZE = 50;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const WARMUP_RETRY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenCode reference adapter.
 *
 * Talks to the OpenCode 2.x server API (`/api/*`, Basic auth optional, global
 * `/api/event` stream) and translates everything into Homebase protocol types.
 * The adapter owns session identity mapping, event normalization, reconnect,
 * approval/question routing, and denial tracking. Nothing OpenCode-native
 * crosses this boundary.
 */
export class OpenCodeAdapter implements AgentAdapter {
  readonly id = OPENCODE_PROVIDER_ID;
  readonly displayName = "OpenCode";

  readonly #config: OpenCodeConfig;
  readonly #supervisor: OpenCodeSupervisor;
  readonly #client: OpenCodeConnectionClient;
  readonly #startEventStream: boolean;
  readonly #reconnectBaseMs: number;

  #context: AdapterContext | null = null;
  #tracker: SessionEventTracker | null = null;
  #fallbackLogger: AdapterLogger;
  #disposed = false;
  #eventTask: Promise<void> | null = null;
  #eventAbort: AbortController | null = null;
  #eventDelayMs: number;

  readonly #sessions = new Map<string, AgentSession>();
  /** native OpenCode session id -> Homebase public session id */
  readonly #nativeToPublic = new Map<string, string>();

  constructor(options: OpenCodeAdapterOptions = {}) {
    this.#config = parseOpenCodeConfig(options.config ?? {});
    this.#fallbackLogger = createConsoleLogger("provider:opencode", { level: "warn" });
    const delegate: AdapterLogger = {
      debug: (message, fields) => this.#logger.debug(message, fields),
      info: (message, fields) => this.#logger.info(message, fields),
      warn: (message, fields) => this.#logger.warn(message, fields),
      error: (message, fields) => this.#logger.error(message, fields),
    };
    this.#supervisor = new OpenCodeSupervisor({
      config: this.#config,
      logger: delegate,
      ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
      ...(options.spawnFn !== undefined ? { spawnFn: options.spawnFn } : {}),
      ...(options.runFn !== undefined ? { runFn: options.runFn } : {}),
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
    });
    this.#client = new OpenCodeConnectionClient({
      supervisor: this.#supervisor,
      requestTimeoutMs: this.#config.requestTimeoutMs,
      ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
    });
    this.#startEventStream = options.startEventStream ?? true;
    this.#reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.#eventDelayMs = this.#reconnectBaseMs;
  }

  init(context: AdapterContext): void {
    this.#context = context;
    this.#tracker = new SessionEventTracker({
      emit: (event) => context.emit(event),
      sessionSnapshot: (sessionId) => this.#sessions.get(sessionId),
      toPublicId: (nativeId) => this.#toPublicId(nativeId),
      patchSession: (sessionId, patch) => {
        const current = this.#sessions.get(sessionId);
        if (current) this.#sessions.set(sessionId, { ...current, ...patch });
      },
      logger: context.logger,
    });
    this.#startEventLoop();
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#eventAbort?.abort();
    await this.#eventTask?.catch(() => undefined);
    await this.#supervisor?.stop();
  }

  /**
   * Detection distinguishes CLI installation from server reachability:
   * missing executable, missing CLI, managed-start failure, unreachable
   * external server, auth rejection, incompatible versions, and (via the
   * warning) newer-than-tested servers.
   */
  async detect(): Promise<ProviderDetection> {
    const detection = await this.#supervisor.detect();
    switch (detection.status) {
      case "ready": {
        const compatibility = versionCompatibility(detection.version);
        return {
          installed: true,
          authenticated: true,
          compatible: compatibility.compatible,
          version: detection.version,
          warning: detection.warning ?? compatibility.warning ?? null,
        };
      }
      case "auth_rejected":
        return {
          installed: true,
          authenticated: false,
          compatible: true,
          version: null,
          warning: detection.warning,
        };
      case "managed_start_failed":
        return {
          installed: true,
          authenticated: null,
          compatible: false,
          version: null,
          warning: detection.warning,
        };
      case "incompatible_cli":
        return {
          installed: true,
          authenticated: null,
          compatible: false,
          version: detection.cliVersion,
          warning: detection.warning,
        };
      case "external_unreachable":
      case "cli_missing":
        return {
          installed: false,
          authenticated: null,
          compatible: false,
          version: null,
          warning: detection.warning,
        };
    }
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    return defineCapabilities({
      resume: true,
      deleteSession: true,
      streaming: true,
      interrupt: true,
      steer: true,
      queue: true,
      models: true,
      modelSwitching: true,
      thinkingLevels: true,
      modes: true,
      attachments: true,
      imageInput: true,
      tools: true,
      approvals: true,
      questions: true,
      // OpenCode has no structured plan object surfaced through its API yet.
      plans: false,
      diffs: true,
      // No provider/account quota API; session consumption is queried separately.
      providerUsage: false,
      sessionUsage: true,
      // Slash commands are deferred to a later phase (see docs/compatibility.md).
      slashCommands: false,
    });
  }

  async listModels(project: AgentProject): Promise<AgentModel[]> {
    const data = await this.#modelsWithWarmupRetry(project.path);
    return data.filter((model) => model.enabled !== false).map((model) => toAgentModel(model));
  }

  async listModes(project: AgentProject): Promise<AgentMode[]> {
    try {
      // Location initialization is asynchronous in 2.0.18: its first agent
      // response can be empty. Catalog warmup waits for that location.
      await this.#modelsWithWarmupRetry(project.path);
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await this.#client.get<{ data?: NativeAgent[] }>("/api/agent", { location: project.path });
        const data = response.data ?? [];
        // Only an entirely empty native response is retried. A genuine catalog
        // containing solely hidden/subagents is honestly an empty picker.
        if (data.length || attempt === 2)
          return data
            .filter((agent) => (agent.mode === "primary" || agent.mode === "all") && agent.hidden !== true)
            .map(toAgentMode);
        await sleep(WARMUP_RETRY_MS);
      }
      return [];
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async listSessions(project: AgentProject, page: PageRequest = {}): Promise<AgentPage<AgentSession>> {
    const limit = clampPageSize(page.limit, DEFAULT_SESSION_PAGE_SIZE);
    try {
      const response = await this.#client.get<{ data?: NativeSession[]; cursor?: NativeCursor }>("/api/session", {
        query: {
          directory: project.path,
          parentID: "null",
          limit,
          ...(page.cursor != null ? { cursor: page.cursor } : { order: "desc" }),
        },
      });
      const data = response.data ?? [];
      const items: AgentSession[] = [];
      for (const native of data) {
        if (native.parentID) continue; // subagent sessions stay hidden from the primary list
        items.push(this.#ingest(native, project.id));
      }
      return toAgentPage(items, {
        next: shortPageNext(response.cursor?.next ?? null, data.length, limit),
        previous: response.cursor?.previous ?? null,
      });
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async getSession(sessionId: string): Promise<AgentSession> {
    const nativeId = this.#toNativeId(sessionId);
    try {
      const response = await this.#client.get<{ data: NativeSession }>(`/api/session/${encodeURIComponent(nativeId)}`);
      const native = response.data;
      const existing = this.#sessions.get(sessionId);
      const projectId =
        existing?.projectId ??
        (native.location?.directory
          ? ((await this.#context?.findProjectByPath(native.location.directory)) ?? null)
          : null);
      if (!projectId) {
        throw new AdapterError("session_not_found", `Session "${sessionId}" is outside the configured project roots.`);
      }
      const session = this.#ingest(native, projectId);
      await this.#reconcileSession(sessionId).catch(() => undefined);
      return session;
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async createSession(input: CreateSessionInput, project: AgentProject): Promise<AgentSession> {
    if (input.provider !== this.id) {
      throw new AdapterError("invalid_request", `This adapter only serves provider "${this.id}".`);
    }
    const model = input.model ? toNativeModelRef(input.model) : null;
    if (input.model && !model) {
      throw new AdapterError("invalid_request", 'Invalid model id; expected "<provider>/<model>".');
    }
    try {
      const response = await this.#client.post<{ data: NativeSession }>("/api/session", {
        ...(input.title ? { title: input.title } : {}),
        ...(input.mode ? { agent: input.mode } : {}),
        ...(model ? { model } : {}),
        location: { directory: project.path },
      });
      return this.#ingest(response.data, project.id);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const nativeId = this.#toNativeId(sessionId);
    await this.#ensureScopedSession(sessionId);
    try {
      await this.#client.request<void>("DELETE", `/api/session/${encodeURIComponent(nativeId)}`);
      this.#sessions.delete(sessionId);
      this.#nativeToPublic.delete(nativeId);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async listMessages(sessionId: string, page: PageRequest = {}): Promise<AgentPage<AgentMessage>> {
    const nativeId = this.#toNativeId(sessionId);
    await this.#ensureScopedSession(sessionId);
    const limit = clampPageSize(page.limit, DEFAULT_MESSAGE_PAGE_SIZE);
    try {
      const response = await this.#client.get<{ data?: NativeMessage[]; cursor?: NativeCursor }>(
        `/api/session/${encodeURIComponent(nativeId)}/message`,
        {
          query: {
            limit,
            ...(page.cursor != null ? { cursor: page.cursor } : { order: "desc" }),
          },
        },
      );
      const data = response.data ?? [];
      const items: AgentMessage[] = [];
      for (const native of data) {
        const mapped = toAgentMessage(native, sessionId, (nativeId) => this.#toPublicId(nativeId));
        if (mapped) items.push(mapped);
      }
      return toAgentPage(items, {
        next: shortPageNext(response.cursor?.next ?? null, data.length, limit),
        previous: response.cursor?.previous ?? null,
      });
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async send(sessionId: string, input: SendMessageInput): Promise<void> {
    const nativeId = this.#toNativeId(sessionId);
    await this.#ensureScopedSession(sessionId);
    const payload = await this.#promptPayload(input);
    if (await this.#isActive(sessionId, nativeId)) {
      // A plain send must not hijack an active run; park it behind the current turn.
      payload.delivery = "queue";
    }
    try {
      await this.#client.post(`/api/session/${encodeURIComponent(nativeId)}/prompt`, payload);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async steer(sessionId: string, input: SendMessageInput): Promise<void> {
    const nativeId = this.#toNativeId(sessionId);
    await this.#ensureScopedSession(sessionId);
    const payload = await this.#promptPayload(input);
    if (await this.#isActive(sessionId, nativeId)) {
      payload.delivery = "steer";
    }
    try {
      await this.#client.post(`/api/session/${encodeURIComponent(nativeId)}/prompt`, payload);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async queue(sessionId: string, input: SendMessageInput): Promise<void> {
    const nativeId = this.#toNativeId(sessionId);
    await this.#ensureScopedSession(sessionId);
    const payload = await this.#promptPayload(input);
    payload.delivery = "queue";
    try {
      await this.#client.post(`/api/session/${encodeURIComponent(nativeId)}/prompt`, payload);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    const nativeId = this.#toNativeId(sessionId);
    await this.#ensureScopedSession(sessionId);
    try {
      await this.#client.post<{ interrupted?: boolean }>(`/api/session/${encodeURIComponent(nativeId)}/interrupt`);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async resolveApproval(requestId: string, result: ApprovalResult): Promise<void> {
    const tracker = this.#requireTracker();
    const pending = tracker.pendingPermission(requestId);
    if (!pending) {
      throw new AdapterError("not_found", `No pending approval with id "${requestId}".`);
    }
    const decision = approvalOptionToDecision(result.optionId);
    if (!decision) {
      throw new AdapterError("invalid_request", `Unknown approval option "${result.optionId}".`);
    }
    try {
      await this.#client.post(
        `/api/session/${encodeURIComponent(this.#toNativeId(pending.sessionId))}/permission/${encodeURIComponent(requestId)}/reply`,
        {
          decision,
          ...(result.note ? { message: result.note } : {}),
        },
      );
      tracker.noteApprovalDecision(requestId, decision);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async answerQuestion(requestId: string, answer: QuestionAnswer): Promise<void> {
    const tracker = this.#requireTracker();
    const pending = tracker.pendingForm(requestId);
    if (!pending) {
      throw new AdapterError("not_found", `No pending question with id "${requestId}".`);
    }
    const body = toFormAnswer(pending.native, answer);
    try {
      await this.#client.post(
        `/api/session/${encodeURIComponent(this.#toNativeId(pending.sessionId))}/form/${encodeURIComponent(requestId)}/reply`,
        body,
      );
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async setModel(sessionId: string, input: SetModelInput): Promise<void> {
    const nativeId = this.#toNativeId(sessionId);
    const session = await this.#ensureScopedSession(sessionId);
    const model = toNativeModelRef({
      provider: this.id,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel ?? null,
    });
    if (!model) {
      throw new AdapterError("invalid_request", 'Invalid model id; expected "<provider>/<model>".');
    }
    try {
      await this.#client.post(`/api/session/${encodeURIComponent(nativeId)}/model`, { model });
      this.#sessions.set(sessionId, {
        ...session,
        model: { provider: this.id, modelId: input.modelId, thinkingLevel: input.thinkingLevel ?? null },
        thinkingLevel: input.thinkingLevel ?? null,
        updatedAt: nowTimestamp(),
      });
      this.#emitSessionUpdated(sessionId);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async setMode(sessionId: string, input: SetModeInput): Promise<void> {
    const nativeId = this.#toNativeId(sessionId);
    const session = await this.#ensureScopedSession(sessionId);
    try {
      await this.#client.post(`/api/session/${encodeURIComponent(nativeId)}/agent`, { agent: input.mode });
      this.#sessions.set(sessionId, { ...session, mode: input.mode, updatedAt: nowTimestamp() });
      this.#emitSessionUpdated(sessionId);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async getDiff(sessionId: string): Promise<AgentDiff> {
    const nativeId = this.#toNativeId(sessionId);
    const session = await this.#ensureScopedSession(sessionId);
    try {
      const response = await this.#client.get<{ data?: NativeFileDiff[] }>(
        `/api/session/${encodeURIComponent(nativeId)}/diff`,
        { query: { context: 3 } },
      );
      const projectPath = await this.#context?.resolveProjectPath(session.projectId).catch(() => null);
      return toAgentDiff(response.data ?? [], projectPath ?? null, sessionId);
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  async getProviderUsage(): Promise<AgentProviderUsage | null> {
    return null;
  }

  async getSessionUsage(sessionId: string): Promise<AgentSessionUsage | null> {
    const nativeId = this.#toNativeId(sessionId);
    await this.#ensureScopedSession(sessionId);
    const response = await this.#client.get<{ data: NativeSession }>(`/api/session/${encodeURIComponent(nativeId)}`);
    return toSessionUsage(response.data, sessionId);
  }

  // --- internals -----------------------------------------------------------------

  #requireContext(): AdapterContext {
    if (!this.#context) {
      throw new AdapterError("internal", "OpenCodeAdapter.init() has not been called.");
    }
    return this.#context;
  }

  #requireTracker(): SessionEventTracker {
    if (!this.#tracker) {
      throw new AdapterError("internal", "OpenCodeAdapter.init() has not been called.");
    }
    return this.#tracker;
  }

  get #logger(): AdapterLogger {
    return this.#context?.logger ?? this.#fallbackLogger;
  }

  #stateFor(native: NativeSession, sessionId: string): AgentSessionState {
    const tracker = this.#tracker;
    if (tracker?.hasPending(sessionId)) return "waiting";
    if (tracker?.isExecuting(sessionId)) return "working";
    if (native.outcome === "failed") return "failed";
    return "idle";
  }

  /** Wraps a native session id; stable for the lifetime of the process. */
  #toPublicId(nativeId: string): string {
    const existing = this.#nativeToPublic.get(nativeId);
    if (existing) return existing;
    const publicId = createPublicId(this.id, nativeId);
    this.#nativeToPublic.set(nativeId, publicId);
    return publicId;
  }

  /** Decodes a public id for this provider; foreign/malformed ids fail closed. */
  #toNativeId(sessionId: string): string {
    const nativeId = decodePublicIdFor(sessionId, this.id);
    if (!nativeId) {
      throw new AdapterError("session_not_found", "The session id is not scoped to this provider.");
    }
    return nativeId;
  }

  #ingest(native: NativeSession, projectId: string): AgentSession {
    const publicId = this.#toPublicId(native.id);
    const session = toAgentSession(
      { ...native, id: publicId, ...(native.parentID ? { parentID: this.#toPublicId(native.parentID) } : {}) },
      projectId,
      this.#stateFor(native, publicId),
    );
    this.#sessions.set(publicId, session);
    return session;
  }

  /** Ensures a session is known and inside a configured project root. */
  async #ensureScopedSession(sessionId: string): Promise<AgentSession> {
    const known = this.#sessions.get(sessionId);
    if (known) return known;
    return this.getSession(sessionId);
  }

  async #promptPayload(input: SendMessageInput): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { text: input.text };
    if (input.attachments && input.attachments.length > 0) {
      payload.files = await this.#buildFiles(input.attachments);
    }
    return payload;
  }

  async #buildFiles(refs: NonNullable<SendMessageInput["attachments"]>): Promise<Array<{ uri: string; name: string }>> {
    const context = this.#requireContext();
    const files: Array<{ uri: string; name: string }> = [];
    for (const ref of refs) {
      let resolved: ResolvedAttachment;
      try {
        resolved = await context.resolveAttachment(ref.id);
      } catch (error) {
        throw error instanceof AdapterError
          ? error
          : new AdapterError("invalid_attachment", "Attachment could not be resolved.");
      }
      files.push({
        uri: `data:${resolved.mimeType};base64,${Buffer.from(resolved.bytes).toString("base64")}`,
        name: resolved.filename,
      });
    }
    return files;
  }

  async #isActive(publicSessionId: string, nativeSessionId: string): Promise<boolean> {
    try {
      const response = await this.#client.get<{ data?: Record<string, unknown> }>("/api/session/active", {
        timeoutMs: 3_000,
      });
      return nativeSessionId in (response.data ?? {});
    } catch {
      return this.#tracker?.isExecuting(publicSessionId) ?? false;
    }
  }

  async #modelsWithWarmupRetry(directory: string): Promise<NativeModel[]> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.#client.get<{ data?: NativeModel[] }>("/api/model", { location: directory });
        const data = response.data ?? [];
        // The first catalog call per location can return empty while the server warms up.
        if (data.length > 0 || attempt === 1) return data;
      } catch (error) {
        if (attempt === 1) throw toAdapterError(error);
      }
      await sleep(WARMUP_RETRY_MS);
    }
    return [];
  }

  async #handleNativeEvent(event: NativeEvent): Promise<void> {
    const nativeSessionId = extractSessionId(event);
    if (!nativeSessionId) return; // global catalog events are not session state

    let publicSessionId = this.#nativeToPublic.get(nativeSessionId);
    if (!publicSessionId || !this.#sessions.has(publicSessionId)) {
      const directory = event.location?.directory;
      if (!directory) return;
      const context = this.#context;
      if (!context) return;
      let projectId: string | null = null;
      try {
        projectId = await context.findProjectByPath(directory);
      } catch {
        projectId = null;
      }
      if (!projectId) return; // sessions outside configured roots are out of scope
      try {
        const response = await this.#client.get<{ data: NativeSession }>(
          `/api/session/${encodeURIComponent(nativeSessionId)}`,
        );
        publicSessionId = this.#ingest(response.data, projectId).id;
      } catch {
        return;
      }
    }

    this.#tracker?.handle(event, publicSessionId);
  }

  /** Emits `session.created` for ingest paths that represent a new session. */
  #emitSessionUpdated(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session || !this.#context) return;
    this.#context.emit({
      type: "session.updated",
      provider: this.id,
      projectId: session.projectId,
      sessionId,
      occurredAt: nowTimestamp(),
      data: { session },
    } as AgentEvent);
  }

  async #reconcileSession(sessionId: string): Promise<void> {
    const tracker = this.#tracker;
    if (!tracker) return;
    const encoded = encodeURIComponent(this.#toNativeId(sessionId));
    const [permissions, forms] = await Promise.all([
      this.#client.get<{ data?: NativePermissionRequest[] }>(`/api/session/${encoded}/permission`),
      this.#client.get<{ data?: NativeForm[] }>(`/api/session/${encoded}/form`),
    ]);
    const permissionIds = new Set((permissions.data ?? []).map((request) => request.id));
    for (const request of permissions.data ?? []) tracker.registerPermission(request, sessionId);
    for (const requestId of tracker.trackedPermissions()) {
      if (!permissionIds.has(requestId)) tracker.resolveVanished(requestId);
    }
    const formIds = new Set((forms.data ?? []).map((form) => form.id));
    for (const form of forms.data ?? []) tracker.registerForm(form, sessionId);
    for (const formId of tracker.trackedForms()) {
      if (!formIds.has(formId)) tracker.resolveVanished(formId);
    }
  }

  async #reconcileKnownSessions(): Promise<void> {
    const sessionIds = [...this.#sessions.keys()].slice(0, 20);
    for (const sessionId of sessionIds) {
      try {
        await this.#reconcileSession(sessionId);
      } catch {
        // Reconciliation is best-effort; live events remain the primary path.
      }
    }
  }

  #startEventLoop(): void {
    if (!this.#startEventStream || this.#eventTask || this.#disposed) return;
    this.#eventTask = this.#runEventLoop();
  }

  async #runEventLoop(): Promise<void> {
    while (!this.#disposed) {
      const controller = new AbortController();
      this.#eventAbort = controller;
      let sawEvent = false;
      try {
        for await (const event of this.#client.events(controller.signal)) {
          if (this.#disposed) return;
          if (!sawEvent) {
            sawEvent = true;
            this.#eventDelayMs = this.#reconnectBaseMs;
            void this.#reconcileKnownSessions();
          }
          await this.#handleNativeEvent(event);
        }
      } catch (error) {
        this.#logger.debug("OpenCode event stream interrupted.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (this.#disposed) return;
      const jitter = Math.floor(Math.random() * this.#eventDelayMs * 0.5);
      await sleep(this.#eventDelayMs + jitter);
      this.#eventDelayMs = Math.min(this.#eventDelayMs * 2, 30_000);
    }
  }
}

function extractSessionId(event: NativeEvent): string | null {
  const data = event.data;
  if (!data) return null;
  if (typeof data.sessionID === "string" && data.sessionID.length > 0) return data.sessionID;
  const form = data.form as { sessionID?: unknown } | undefined;
  if (form && typeof form.sessionID === "string" && form.sessionID.length > 0) return form.sessionID;
  return null;
}

function clampPageSize(limit: number | null | undefined, fallback: number): number {
  if (limit == null) return fallback;
  return Math.max(1, Math.min(limit, 200));
}

/**
 * OpenCode can report a `next` cursor on a short (final) page; normalize so the
 * UI does not offer an empty "load more".
 */
function shortPageNext(next: string | null, received: number, limit: number): string | null {
  return received < limit ? null : next;
}

/** Re-exported for tests. */
