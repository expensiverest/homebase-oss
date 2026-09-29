import type { ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";

import {
  PROTOCOL_VERSION,
  RequestError,
  client,
  methods,
  ndJsonStream,
  type AuthMethod,
  type ClientCapabilities,
  type CloseSessionResponse,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type DeleteSessionResponse,
  type Implementation,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionConfigId,
  type SessionConfigValueId,
  type SessionId,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";

import { AcpTransportError, isAcpTransportError } from "./errors.js";
import { noopAcpTransportLogger, type AcpTransportLogger } from "./logger.js";
import { AcpProcess, type AcpProcessExitInfo } from "./process.js";

import type { SpawnExecutable } from "@homebase/adapter-sdk";

/** Context handed to client-side ACP request handlers. */
export interface AcpClientRequestContext {
  requestId: string | number | null;
  signal: AbortSignal;
}

/**
 * Client-side callbacks an adapter provides. Only session updates and
 * permission requests are required for normal Homebase operation; file-system
 * and terminal client capabilities are deliberately never advertised.
 */
export interface AcpClientHandlers {
  /** Receives every `session/update` notification (live and replayed). */
  onSessionUpdate?(notification: SessionNotification): void;
  /**
   * Handles `session/request_permission`. The returned promise may stay pending
   * while the remote user decides; it is cancelled if the process dies.
   */
  onPermissionRequest?(
    request: RequestPermissionRequest,
    context: AcpClientRequestContext,
  ): Promise<RequestPermissionResponse>;
  /** Optional elicitation handler; advertised only when present. */
  onElicitation?(
    request: CreateElicitationRequest,
    context: AcpClientRequestContext,
  ): Promise<CreateElicitationResponse>;
}

export interface AcpTransportOptions {
  /** Executable to spawn, for example "grok". */
  command: string;
  args?: readonly string[];
  cwd?: string;
  /** Environment for the child; defaults to the Host process environment. */
  env?: NodeJS.ProcessEnv;
  clientName?: string;
  clientVersion?: string;
  /** Spawn + initialize deadline. */
  startupTimeoutMs?: number;
  /** Timeout for control requests (never applied to session/prompt). */
  controlTimeoutMs?: number;
  /** Graceful shutdown deadline before SIGKILL escalation. */
  shutdownTimeoutMs?: number;
  /** Bounded stderr tail kept for local diagnostics. */
  stderrLimitBytes?: number;
  handlers?: AcpClientHandlers;
  logger?: AcpTransportLogger;
  /** Injectable spawner for deterministic tests. */
  spawnFn?: SpawnExecutable;
}

export interface AcpInitializeResult {
  /** Negotiated protocol version (must be 1 for this transport). */
  protocolVersion: number;
  agentCapabilities: InitializeResponse["agentCapabilities"];
  authMethods: AuthMethod[];
  agentInfo: Implementation | null;
  meta: Record<string, unknown> | null;
  raw: InitializeResponse;
}

export interface AcpRequestOptions {
  timeoutMs?: number;
}

type ClientConnectionHandle = ReturnType<ReturnType<typeof client>["connect"]>;

interface RawClientRequestContext<Params> {
  params: Params;
  requestId: string | number | null;
  signal: AbortSignal;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const DEFAULT_CONTROL_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;

/**
 * Provider-neutral ACP v1 client transport over a local stdio child process.
 *
 * The official `@agentclientprotocol/sdk` owns JSON-RPC correlation, schema
 * validation, framing, and message dispatch. This class owns process lifecycle,
 * client capability negotiation, request timeouts, error normalization, and
 * the minimal client surface Homebase needs. It contains no provider-specific
 * behavior.
 */
export class AcpTransport {
  readonly #options: AcpTransportOptions;
  readonly #logger: AcpTransportLogger;
  readonly #handlers: AcpClientHandlers;

  #process: AcpProcess | null = null;
  #connection: ClientConnectionHandle | null = null;
  #started = false;
  #stopped = false;
  #initializeResult: AcpInitializeResult | null = null;
  #exitPromise: Promise<AcpProcessExitInfo> | null = null;
  #resolveExit: ((info: AcpProcessExitInfo) => void) | null = null;
  #exitListeners = new Set<(info: AcpProcessExitInfo) => void>();

  constructor(options: AcpTransportOptions) {
    this.#options = options;
    this.#logger = options.logger ?? noopAcpTransportLogger;
    this.#handlers = options.handlers ?? {};
  }

  get initialized(): boolean {
    return this.#initializeResult !== null;
  }

  get alive(): boolean {
    return this.#process?.alive ?? false;
  }

  get protocolVersion(): number | null {
    return this.#initializeResult?.protocolVersion ?? null;
  }

  get processId(): number | null {
    return this.#process?.child?.pid ?? null;
  }

  /** Bounded stderr tail for local diagnostics. Never includes stdout. */
  stderrTail(): string {
    return this.#process?.stderrTail() ?? "";
  }

  onExit(listener: (info: AcpProcessExitInfo) => void): () => void {
    if (this.#process?.exitInfo) {
      listener(this.#process.exitInfo);
      return () => undefined;
    }
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  /** Spawns the agent, negotiates ACP v1, and returns the capabilities. */
  async start(): Promise<AcpInitializeResult> {
    if (this.#started) throw new AcpTransportError("protocol", "The ACP transport has already been started.");
    if (this.#stopped) throw new AcpTransportError("closed", "The ACP transport has been stopped.");
    this.#started = true;

    const process = new AcpProcess({
      command: this.#options.command,
      args: this.#options.args ?? [],
      ...(this.#options.cwd !== undefined ? { cwd: this.#options.cwd } : {}),
      ...(this.#options.env !== undefined ? { env: this.#options.env } : {}),
      ...(this.#options.stderrLimitBytes !== undefined ? { stderrLimitBytes: this.#options.stderrLimitBytes } : {}),
      ...(this.#options.spawnFn !== undefined ? { spawnFn: this.#options.spawnFn } : {}),
      logger: this.#logger,
    });
    this.#process = process;
    this.#exitPromise = new Promise((resolve) => {
      this.#resolveExit = resolve;
    });
    process.onExit((info) => {
      this.#handleExit(info);
    });

    let child: ChildProcess;
    try {
      child = process.start();
    } catch (error) {
      this.#started = false;
      throw new AcpTransportError("spawn_failed", error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
    if (!child.stdout || !child.stdin) {
      this.#started = false;
      throw new AcpTransportError("spawn_failed", "The ACP agent process has no stdio pipes.");
    }

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );

    const app = client({ name: this.#options.clientName ?? "homebase" });
    app.onNotification(methods.client.session.update, (context) => {
      try {
        this.#handlers.onSessionUpdate?.(context.params);
      } catch (error) {
        this.#logger.warn("ACP session update handler failed.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    app.onRequest(methods.client.session.requestPermission, (context) => this.#handlePermission(context));
    if (this.#handlers.onElicitation) {
      app.onRequest(methods.client.elicitation.create, (context) => this.#handleElicitation(context));
    }

    this.#connection = app.connect(stream);

    try {
      const response = await this.#withTimeout(
        this.#raceExit(
          this.#connection.agent.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: this.#clientCapabilities(),
            clientInfo: {
              name: this.#options.clientName ?? "homebase",
              version: this.#options.clientVersion ?? "unknown",
            },
          }),
        ),
        this.#options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
        "ACP initialize",
        "startup_timeout",
      );
      if (response.protocolVersion !== PROTOCOL_VERSION) {
        throw new AcpTransportError(
          "protocol",
          `The ACP agent negotiated protocol version ${response.protocolVersion}; this transport supports v${PROTOCOL_VERSION}.`,
        );
      }
      const result: AcpInitializeResult = {
        protocolVersion: response.protocolVersion,
        agentCapabilities: response.agentCapabilities,
        authMethods: response.authMethods ?? [],
        agentInfo: response.agentInfo ?? null,
        meta: response._meta ?? null,
        raw: response,
      };
      this.#initializeResult = result;
      return result;
    } catch (error) {
      await this.stop();
      if (isAcpTransportError(error)) throw error;
      const exitInfo = this.#process?.exitInfo;
      if (exitInfo) {
        throw new AcpTransportError(exitInfo.spawnFailed ? "spawn_failed" : "process_exited", exitInfo.reason, {
          cause: error,
        });
      }
      throw this.#normalize(error, "ACP initialize failed.");
    }
  }

  /** Stops the child (stdin EOF → SIGTERM → SIGKILL) and closes the connection. */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    const connection = this.#connection;
    this.#connection = null;
    try {
      connection?.close(new AcpTransportError("closed", "The ACP transport was stopped."));
    } catch {
      // connection may already be closed
    }
    await this.#process?.stop(this.#options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
    this.#resolveExit?.(
      this.#process?.exitInfo ?? {
        code: null,
        signal: null,
        expected: true,
        spawnFailed: false,
        reason: "The ACP transport was stopped.",
      },
    );
  }

  // --- standard ACP calls -------------------------------------------------------

  async authenticate(methodId: string, options: AcpRequestOptions = {}): Promise<void> {
    await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.authenticate, { methodId }),
      options,
      "ACP authenticate",
    );
  }

  async newSession(request: NewSessionRequest, options: AcpRequestOptions = {}): Promise<NewSessionResponse> {
    return await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.session.new, request),
      options,
      "ACP session/new",
    );
  }

  async loadSession(request: LoadSessionRequest, options: AcpRequestOptions = {}): Promise<LoadSessionResponse> {
    return await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.session.load, request),
      options,
      "ACP session/load",
    );
  }

  async resumeSession(request: ResumeSessionRequest, options: AcpRequestOptions = {}): Promise<ResumeSessionResponse> {
    return await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.session.resume, request),
      options,
      "ACP session/resume",
    );
  }

  async listSessions(
    request: ListSessionsRequest = {},
    options: AcpRequestOptions = {},
  ): Promise<ListSessionsResponse> {
    return await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.session.list, request),
      options,
      "ACP session/list",
    );
  }

  async deleteSession(sessionId: SessionId, options: AcpRequestOptions = {}): Promise<DeleteSessionResponse> {
    return await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.session.delete, { sessionId }),
      options,
      "ACP session/delete",
    );
  }

  async closeSession(sessionId: SessionId, options: AcpRequestOptions = {}): Promise<CloseSessionResponse> {
    return await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.session.close, { sessionId }),
      options,
      "ACP session/close",
    );
  }

  async setSessionMode(sessionId: SessionId, modeId: string, options: AcpRequestOptions = {}): Promise<void> {
    await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.session.setMode, { sessionId, modeId }),
      options,
      "ACP session/set_mode",
    );
  }

  async setConfigOption(
    request: SetSessionConfigOptionRequest,
    options: AcpRequestOptions = {},
  ): Promise<SetSessionConfigOptionResponse> {
    return await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.session.setConfigOption, request),
      options,
      "ACP session/set_config_option",
    );
  }

  /** Convenience for select/string config options. */
  async setConfigValue(
    sessionId: SessionId,
    configId: SessionConfigId,
    value: SessionConfigValueId,
    options: AcpRequestOptions = {},
  ): Promise<SetSessionConfigOptionResponse> {
    return await this.setConfigOption({ sessionId, configId, value }, options);
  }

  /**
   * Sends `session/prompt`. Resolves when the turn finishes; callers must run
   * this as a background task rather than blocking an HTTP request on it.
   */
  async prompt(sessionId: SessionId, prompt: ContentBlock[], options: AcpRequestOptions = {}): Promise<PromptResponse> {
    return await this.#control(
      () => this.#requireConnection().agent.request(methods.agent.session.prompt, { sessionId, prompt }),
      options,
      "ACP session/prompt",
      false,
    );
  }

  /** Requests cancellation; the in-flight `prompt` settles with a stop reason. */
  async cancel(sessionId: SessionId): Promise<void> {
    try {
      await this.#requireConnection().agent.notify(methods.agent.session.cancel, { sessionId });
    } catch (error) {
      throw this.#normalize(error, "ACP session/cancel failed.");
    }
  }

  /** Escape hatch for documented provider extension requests (adapter-owned). */
  async requestExtension<Response = unknown, Params = unknown>(
    method: string,
    params?: Params,
    options: AcpRequestOptions = {},
  ): Promise<Response> {
    return await this.#control<Response>(
      () => this.#requireConnection().agent.request<Response, Params>(method, params),
      options,
      `ACP ${method}`,
    );
  }

  // --- internals ----------------------------------------------------------------

  #clientCapabilities(): ClientCapabilities {
    const capabilities: ClientCapabilities = {};
    if (this.#handlers.onElicitation) capabilities.elicitation = { form: {} };
    return capabilities;
  }

  #requireConnection(): ClientConnectionHandle {
    if (!this.#connection || this.#stopped) {
      throw new AcpTransportError("not_started", "The ACP transport is not connected.");
    }
    return this.#connection;
  }

  async #handlePermission(
    context: RawClientRequestContext<RequestPermissionRequest>,
  ): Promise<RequestPermissionResponse> {
    const cancelled: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };
    const handler = this.#handlers.onPermissionRequest;
    if (!handler) return cancelled;
    const pending = handler(context.params, {
      requestId: context.requestId,
      signal: context.signal,
    }).catch((error: unknown) => {
      this.#logger.warn("ACP permission handler failed; cancelling the request.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return cancelled;
    });
    const exit = this.#exitPromise ?? Promise.resolve(null);
    return await Promise.race([pending, exit.then(() => cancelled)]);
  }

  async #handleElicitation(
    context: RawClientRequestContext<CreateElicitationRequest>,
  ): Promise<CreateElicitationResponse> {
    const handler = this.#handlers.onElicitation;
    if (!handler) {
      throw new RequestError(-32601, "Elicitation is not supported by this client.");
    }
    const pending = handler(context.params, {
      requestId: context.requestId,
      signal: context.signal,
    });
    const exit = this.#exitPromise ?? Promise.resolve(null);
    return await Promise.race([pending, exit.then(() => ({ action: "cancel" as const }))]);
  }

  async #control<T>(
    action: () => Promise<T>,
    options: AcpRequestOptions,
    label: string,
    applyTimeout = true,
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.#options.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
    try {
      const promise = this.#raceExit(action());
      return applyTimeout ? await this.#withTimeout(promise, timeoutMs, label) : await promise;
    } catch (error) {
      if (isAcpTransportError(error)) throw error;
      const exitError = await this.#exitErrorIfAny();
      if (exitError) throw exitError;
      throw this.#normalize(error, `${label} failed.`);
    }
  }

  /** Rejects a pending request as soon as the child exits. */
  #raceExit<T>(promise: Promise<T>): Promise<T> {
    const exit = this.#exitPromise;
    if (!exit) return promise;
    return Promise.race([
      promise,
      exit.then((info) => {
        throw new AcpTransportError(info.spawnFailed ? "spawn_failed" : "process_exited", info.reason);
      }),
    ]);
  }

  async #withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
    code: AcpTransportError["code"] = "timeout",
  ): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return await promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new AcpTransportError(code, `${label} timed out after ${timeoutMs}ms.`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #handleExit(info: AcpProcessExitInfo): void {
    this.#resolveExit?.(info);
    const connection = this.#connection;
    if (connection) {
      try {
        connection.close(new AcpTransportError(info.spawnFailed ? "spawn_failed" : "process_exited", info.reason));
      } catch {
        // already closed
      }
    }
    if (!info.expected) {
      this.#logger.warn("ACP agent process exited.", { code: info.code, reason: info.reason });
    }
    for (const listener of [...this.#exitListeners]) listener(info);
    this.#exitListeners.clear();
  }

  #normalize(error: unknown, fallbackMessage: string): AcpTransportError {
    if (error instanceof RequestError) {
      return new AcpTransportError("request", error.message || fallbackMessage, {
        cause: error,
        jsonRpcCode: error.code,
      });
    }
    if (error instanceof Error) {
      return new AcpTransportError("protocol", error.message || fallbackMessage, { cause: error });
    }
    return new AcpTransportError("protocol", fallbackMessage, { cause: error });
  }

  /**
   * When the SDK reports a closed connection, the child may have just exited;
   * give the exit event a brief chance so callers see a precise
   * `process_exited` error instead of a generic protocol failure.
   */
  async #exitErrorIfAny(): Promise<AcpTransportError | null> {
    const immediate = this.#process?.exitInfo;
    if (immediate) return this.#processExitError(immediate);
    const exit = this.#exitPromise;
    if (!exit) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      exit,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 150);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return settled ? this.#processExitError(settled) : null;
  }

  #processExitError(info: AcpProcessExitInfo): AcpTransportError {
    return new AcpTransportError(info.spawnFailed ? "spawn_failed" : "process_exited", info.reason);
  }
}
