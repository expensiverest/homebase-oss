import { randomBytes } from "node:crypto";
import type { ChildProcess } from "node:child_process";

import {
  AdapterError,
  redactSecrets,
  runExecutable,
  spawnExecutable,
  type AdapterLogger,
  type ExecutableFailure,
} from "@homebase/adapter-sdk";

import { OpenCodeClient, OpenCodeHttpError, type OpenCodeRequestOptions } from "./client.js";
import type { OpenCodeConfig } from "./config.js";
import type { NativeEvent, NativeServerInfo } from "./native.js";

export interface OpenCodeConnection {
  baseUrl: string;
  username: string;
  password?: string;
  source: "external" | "managed";
}

export type OpenCodeSupervisorStatus =
  "ready" | "auth_rejected" | "external_unreachable" | "cli_missing" | "incompatible_cli" | "managed_start_failed";

export interface OpenCodeSupervisorDetection {
  status: OpenCodeSupervisorStatus;
  version: string | null;
  cliVersion: string | null;
  warning: string | null;
  connection: OpenCodeConnection | null;
}

interface CliDetection {
  found: boolean;
  version: string | null;
}

interface ManagedExit {
  code: number | null;
  signal: string | null;
}

type PortProbe =
  { kind: "ready"; version: string | null } | { kind: "starting" } | { kind: "rejected" } | { kind: "unreachable" };

const CLI_VERSION_TIMEOUT_MS = 5_000;
const MANAGED_READY_POLL_MS = 200;
const EXTERNAL_PROBE_TIMEOUT_MS = 2_500;
const STARTUP_STDERR_TAIL = 8 * 1024;

/** Extracts a semantic version from `opencode --version` output. */
export function parseOpenCodeVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(output);
  return match?.[1] ?? null;
}

export function openCodeMajorVersion(version: string | null): number | null {
  if (!version) return null;
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

export interface OpenCodeSupervisorOptions {
  config: OpenCodeConfig;
  logger: AdapterLogger;
  /** Injectable fetch for tests (also used by the HTTP client). */
  fetchFn?: typeof fetch;
  /** Injectable process spawner for deterministic tests. */
  spawnFn?: typeof spawnExecutable;
  /** Injectable bounded command runner for deterministic tests. */
  runFn?: typeof runExecutable;
  /** Injectable sleep for fast timers in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface OpenCodeConnectionClientOptions {
  supervisor: OpenCodeSupervisor;
  requestTimeoutMs: number;
  fetchFn?: typeof fetch;
}

/**
 * Request-time façade over the supervisor's active connection. Every call
 * resolves the current endpoint (external or managed) once and reuses the
 * underlying HTTP client while the connection stays the same, so mutable
 * connection details never leak into adapter request code.
 */
export class OpenCodeConnectionClient {
  readonly #supervisor: OpenCodeSupervisor;
  readonly #requestTimeoutMs: number;
  readonly #fetchFn: typeof fetch | undefined;
  #client: OpenCodeClient | null = null;
  #connection: OpenCodeConnection | null = null;

  constructor(options: OpenCodeConnectionClientOptions) {
    this.#supervisor = options.supervisor;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetchFn = options.fetchFn;
  }

  async #resolve(): Promise<OpenCodeClient> {
    const connection = await this.#supervisor.resolveConnection();
    if (this.#client && this.#connection === connection) return this.#client;
    this.#connection = connection;
    this.#client = new OpenCodeClient({
      baseUrl: connection.baseUrl,
      username: connection.username,
      ...(connection.password !== undefined ? { password: connection.password } : {}),
      requestTimeoutMs: this.#requestTimeoutMs,
      ...(this.#fetchFn !== undefined ? { fetchFn: this.#fetchFn } : {}),
    });
    return this.#client;
  }

  get<T>(path: string, options?: OpenCodeRequestOptions): Promise<T> {
    return this.#resolve().then((client) => client.get<T>(path, options));
  }

  post<T>(path: string, body?: unknown, options?: OpenCodeRequestOptions): Promise<T> {
    return this.#resolve().then((client) => client.post<T>(path, body, options));
  }

  request<T>(method: string, path: string, options?: OpenCodeRequestOptions): Promise<T> {
    return this.#resolve().then((client) => client.request<T>(method, path, options));
  }

  async *events(signal: AbortSignal): AsyncGenerator<NativeEvent> {
    const client = await this.#resolve();
    yield* client.events(signal);
  }
}

/**
 * Owns the OpenCode server lifecycle for one adapter instance.
 *
 * - `external` mode never spawns a process and always uses configured settings.
 * - `auto` mode prefers a healthy configured server and otherwise starts a
 *   dedicated Homebase-managed loopback server when the CLI is installed.
 * - `managed` mode always runs a Homebase-owned `opencode serve` child.
 *
 * Homebase never touches the user's shared OpenCode service: the managed child
 * gets a random in-memory password, binds 127.0.0.1, and is the only process
 * this supervisor ever stops. A failed managed start is cached so background
 * reconnects cannot cause restart storms; `detect()` (an explicit provider
 * refresh) may make one bounded new attempt.
 */
export class OpenCodeSupervisor {
  readonly #config: OpenCodeConfig;
  readonly #logger: AdapterLogger;
  readonly #fetch: typeof fetch;
  readonly #spawn: typeof spawnExecutable;
  readonly #run: typeof runExecutable;
  readonly #sleep: (ms: number) => Promise<void>;

  #connection: OpenCodeConnection | null = null;
  #child: ChildProcess | null = null;
  #childExited = false;
  #startTask: Promise<{ connection: OpenCodeConnection; version: string | null }> | null = null;
  #failedManaged: { warning: string; cliVersion: string | null } | null = null;
  #cliVersion: string | null = null;
  #cliTask: Promise<CliDetection> | null = null;
  #stopping = false;

  constructor(options: OpenCodeSupervisorOptions) {
    this.#config = options.config;
    this.#logger = options.logger;
    this.#fetch = options.fetchFn ?? fetch;
    this.#spawn = options.spawnFn ?? spawnExecutable;
    this.#run = options.runFn ?? runExecutable;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** The active connection, when one exists. */
  get connection(): OpenCodeConnection | null {
    return this.#connection;
  }

  /** True when Homebase currently owns a live managed server child. */
  get managedRunning(): boolean {
    return this.#child !== null && !this.#childExited;
  }

  /** Detection entry point. Allows one bounded new managed-start attempt. */
  async detect(): Promise<OpenCodeSupervisorDetection> {
    return await this.#detectInternal(true);
  }

  /** Connection for data calls; never starts a new managed attempt after failure. */
  async resolveConnection(): Promise<OpenCodeConnection> {
    const active = this.#connection;
    if (active) {
      if (active.source === "external" || this.managedRunning) return active;
      this.#invalidateManaged("The Homebase-managed OpenCode server is no longer running.");
    }
    const detection = await this.#detectInternal(false);
    if (detection.connection) return detection.connection;
    throw this.#errorForDetection(detection);
  }

  /** Stops only a child this supervisor spawned. Never touches external servers. */
  async stop(): Promise<void> {
    this.#stopping = true;
    const child = this.#child;
    this.#child = null;
    this.#connection = null;
    if (child) await this.#stopChild(child, this.#config.shutdownTimeoutMs);
  }

  async #detectInternal(retryManaged: boolean): Promise<OpenCodeSupervisorDetection> {
    if (this.#config.serverMode === "managed") {
      return await this.#detectManaged(retryManaged, false);
    }
    if (this.#config.serverMode === "external") {
      return await this.#detectExternal();
    }

    const external = this.#externalConnection();
    const probe = await this.#probeConnection(external, EXTERNAL_PROBE_TIMEOUT_MS);
    if (probe.kind === "ok") {
      this.#connection = external;
      return {
        status: "ready",
        version: probe.version,
        cliVersion: null,
        warning: null,
        connection: external,
      };
    }
    if (probe.kind === "rejected") {
      this.#connection = external;
      return {
        status: "auth_rejected",
        version: null,
        cliVersion: null,
        warning: this.#config.password
          ? "The OpenCode server rejected the configured credentials."
          : "The OpenCode server requires authentication; set providers.opencode.config.password.",
        connection: external,
      };
    }
    // External server is unreachable: fall back to a managed server when possible.
    return await this.#detectManaged(retryManaged, true);
  }

  async #detectExternal(): Promise<OpenCodeSupervisorDetection> {
    const connection = this.#externalConnection();
    this.#connection = connection;
    const probe = await this.#probeConnection(connection, EXTERNAL_PROBE_TIMEOUT_MS);
    if (probe.kind === "ok") {
      return { status: "ready", version: probe.version, cliVersion: null, warning: null, connection };
    }
    if (probe.kind === "rejected") {
      return {
        status: "auth_rejected",
        version: null,
        cliVersion: null,
        warning: this.#config.password
          ? "The OpenCode server rejected the configured credentials."
          : "The OpenCode server requires authentication; set providers.opencode.config.password.",
        connection,
      };
    }
    return {
      status: "external_unreachable",
      version: null,
      cliVersion: null,
      warning: `No OpenCode server responded at ${this.#config.baseUrl}. Start OpenCode or set providers.opencode.config.serverMode.`,
      connection: null,
    };
  }

  async #detectManaged(retryManaged: boolean, externalWasUnreachable: boolean): Promise<OpenCodeSupervisorDetection> {
    if (this.managedRunning && this.#connection?.source === "managed") {
      const probe = await this.#probeConnection(this.#connection, EXTERNAL_PROBE_TIMEOUT_MS);
      if (probe.kind === "ok") {
        return {
          status: "ready",
          version: probe.version,
          cliVersion: this.#cliVersion,
          warning: null,
          connection: this.#connection,
        };
      }
      if (probe.kind === "rejected") {
        return {
          status: "auth_rejected",
          version: null,
          cliVersion: this.#cliVersion,
          warning: "The Homebase-managed OpenCode server rejected its own credentials.",
          connection: this.#connection,
        };
      }
      this.#invalidateManaged("The Homebase-managed OpenCode server stopped responding.");
    }

    if (this.#failedManaged && !retryManaged) {
      return {
        status: "managed_start_failed",
        version: null,
        cliVersion: this.#failedManaged.cliVersion,
        warning: this.#failedManaged.warning,
        connection: null,
      };
    }

    const cli = await this.#detectCli();
    if (!cli.found) {
      const warning = externalWasUnreachable
        ? `No OpenCode server responded at ${this.#config.baseUrl}, and the OpenCode CLI was not found on PATH. ` +
          `Install OpenCode or set providers.opencode.config.baseUrl for an external server.`
        : `The OpenCode CLI was not found on PATH. Install OpenCode or set providers.opencode.config.executable.`;
      return { status: "cli_missing", version: null, cliVersion: null, warning, connection: null };
    }

    const major = openCodeMajorVersion(cli.version);
    if (major !== null && major < 2) {
      return {
        status: "incompatible_cli",
        version: null,
        cliVersion: cli.version,
        warning:
          `OpenCode ${cli.version} predates the supported 2.x server API. ` +
          `Update the OpenCode CLI or set providers.opencode.config.serverMode to "external".`,
        connection: null,
      };
    }

    // Concurrent resolution (adapter init + provider detection) must share one
    // managed start instead of spawning two servers.
    const pending = this.#startTask;
    if (pending) {
      try {
        const started = await pending;
        return {
          status: "ready",
          version: started.version,
          cliVersion: cli.version,
          warning: null,
          connection: started.connection,
        };
      } catch (error) {
        const warning = error instanceof Error ? error.message : String(error);
        return {
          status: "managed_start_failed",
          version: null,
          cliVersion: cli.version,
          warning: redactSecrets(warning).slice(0, 400),
          connection: null,
        };
      }
    }

    try {
      this.#startTask = this.#launchManaged(cli.version);
      const started = await this.#startTask;
      this.#failedManaged = null;
      this.#cliVersion = cli.version;
      return {
        status: "ready",
        version: started.version,
        cliVersion: cli.version,
        warning: null,
        connection: started.connection,
      };
    } catch (error) {
      const warning = error instanceof Error ? error.message : String(error);
      const safeWarning = redactSecrets(warning).slice(0, 400);
      this.#logger.warn("Homebase-managed OpenCode server failed to start.", { warning: safeWarning });
      this.#failedManaged = { warning: safeWarning, cliVersion: cli.version };
      return {
        status: "managed_start_failed",
        version: null,
        cliVersion: cli.version,
        warning: safeWarning,
        connection: null,
      };
    } finally {
      this.#startTask = null;
    }
  }

  async #detectCli(): Promise<CliDetection> {
    if (this.#cliVersion) return { found: true, version: this.#cliVersion };
    if (!this.#cliTask) {
      this.#cliTask = this.#runCliDetection().finally(() => {
        this.#cliTask = null;
      });
    }
    return await this.#cliTask;
  }

  async #runCliDetection(): Promise<CliDetection> {
    try {
      const result = await this.#run(this.#config.executable, ["--version"], {
        timeoutMs: CLI_VERSION_TIMEOUT_MS,
        maxOutputBytes: 16 * 1024,
      });
      const version = parseOpenCodeVersion(`${result.stdout}\n${result.stderr}`);
      if (version) this.#cliVersion = version;
      this.#logger.info("OpenCode CLI detected.", { version: version ?? "unknown" });
      return { found: true, version };
    } catch (error) {
      const failure = error as ExecutableFailure;
      if (failure.kind === "not_found") {
        this.#logger.info("OpenCode CLI not found on PATH.", { executable: this.#config.executable });
        return { found: false, version: null };
      }
      this.#logger.warn("OpenCode CLI detection failed.", { reason: failure.message });
      return { found: true, version: null };
    }
  }

  #externalConnection(): OpenCodeConnection {
    return {
      baseUrl: this.#config.baseUrl,
      username: this.#config.username,
      ...(this.#config.password !== undefined ? { password: this.#config.password } : {}),
      source: "external",
    };
  }

  async #probeConnection(
    connection: OpenCodeConnection,
    timeoutMs: number,
  ): Promise<{ kind: "ok"; version: string | null } | { kind: "rejected" } | { kind: "unreachable" }> {
    const client = new OpenCodeClient({
      baseUrl: connection.baseUrl,
      username: connection.username,
      ...(connection.password !== undefined ? { password: connection.password } : {}),
      requestTimeoutMs: timeoutMs,
      fetchFn: this.#fetch,
    });
    try {
      const info = await client.get<NativeServerInfo>("/api/info", { timeoutMs });
      return { kind: "ok", version: typeof info.version === "string" ? info.version : null };
    } catch (error) {
      if (error instanceof OpenCodeHttpError && (error.status === 401 || error.status === 403)) {
        return { kind: "rejected" };
      }
      return { kind: "unreachable" };
    }
  }

  async #launchManaged(cliVersion: string | null): Promise<{ connection: OpenCodeConnection; version: string | null }> {
    const password = randomBytes(32).toString("base64url");
    const username = "opencode";
    const requestedPort = this.#config.managedPort;
    const args = ["serve", "--hostname", "127.0.0.1", "--port", String(requestedPort)];

    this.#stopping = false;
    const child = this.#spawn(this.#config.executable, args, {
      env: {
        ...process.env,
        OPENCODE_PASSWORD: password,
        // Documented legacy name for OpenCode v1/v2 compatibility.
        OPENCODE_SERVER_PASSWORD: password,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;
    this.#childExited = false;

    let port: number | null = requestedPort > 0 ? requestedPort : null;
    let stdoutTail = "";
    let stderrTail = "";
    let exit: ManagedExit | null = null;

    const capture = (current: string, chunk: string): string => (current + chunk).slice(-STARTUP_STDERR_TAIL);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutTail = capture(stdoutTail, chunk);
      const match = /server listening on https?:\/\/[^\s]*:(\d+)/i.exec(stdoutTail);
      if (match?.[1]) port = Number.parseInt(match[1], 10);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail = capture(stderrTail, chunk);
    });

    child.on("error", (error) => {
      exit = { code: null, signal: null };
      this.#logger.warn("Homebase-managed OpenCode server failed to spawn.", { error: error.message });
    });
    child.on("close", (code, signal) => {
      exit = { code, signal };
      this.#childExited = true;
      if (this.#child !== child) return;
      if (!this.#stopping && this.#connection?.source === "managed") {
        this.#invalidateManaged(`The Homebase-managed OpenCode server exited (code ${code ?? "unknown"}).`);
        this.#logger.warn("Homebase-managed OpenCode server exited.", { code, signal });
      }
    });

    const deadline = Date.now() + this.#config.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (exit) {
        throw new AdapterError("provider_unavailable", this.#startFailureMessage(exit, stderrTail, requestedPort));
      }
      if (port !== null) {
        const probe = await this.#probeManagedPort(port, username, password);
        if (probe.kind === "ready") {
          const connection: OpenCodeConnection = {
            baseUrl: `http://127.0.0.1:${port}`,
            username,
            password,
            source: "managed",
          };
          this.#connection = connection;
          this.#logger.info("Started Homebase-managed OpenCode server.", {
            port,
            version: probe.version ?? cliVersion ?? "unknown",
          });
          return { connection, version: probe.version };
        }
        if (probe.kind === "rejected") {
          await this.#stopChild(child, this.#config.shutdownTimeoutMs);
          throw new AdapterError(
            "provider_error",
            "The Homebase-managed OpenCode server rejected the credentials Homebase generated.",
          );
        }
      }
      await this.#sleep(MANAGED_READY_POLL_MS);
    }

    await this.#stopChild(child, this.#config.shutdownTimeoutMs);
    const detail =
      stderrTail.trim().length > 0 ? ` Last diagnostic: ${redactSecrets(lastLine(stderrTail)).slice(0, 200)}` : "";
    throw new AdapterError(
      "timeout",
      `The Homebase-managed OpenCode server did not become reachable within ${this.#config.startupTimeoutMs}ms.${detail}`,
    );
  }

  async #probeManagedPort(port: number, username: string, password: string): Promise<PortProbe> {
    // Managed readiness always talks to the real local child; the injectable
    // fetch exists for external-server detection in tests.
    const client = new OpenCodeClient({
      baseUrl: `http://127.0.0.1:${port}`,
      username,
      password,
      requestTimeoutMs: 1_500,
    });
    try {
      const info = await client.get<NativeServerInfo>("/api/info", { timeoutMs: 1_500 });
      return { kind: "ready", version: typeof info.version === "string" ? info.version : null };
    } catch (error) {
      if (error instanceof OpenCodeHttpError) {
        if (error.status === 401 || error.status === 403) return { kind: "rejected" };
        // 503 while starting is expected; anything else is treated as not ready yet.
        return { kind: "starting" };
      }
      return { kind: "unreachable" };
    }
  }

  #startFailureMessage(exit: ManagedExit, stderrTail: string, requestedPort: number): string {
    const portBusy = /EADDRINUSE|address already in use|port .*in use/i.test(stderrTail);
    const exitText = `code ${exit.code ?? "unknown"}${exit.signal ? `, signal ${exit.signal}` : ""}`;
    if (portBusy) {
      return (
        `The OpenCode CLI is installed, but the Homebase-managed server could not bind port ` +
        `${requestedPort === 0 ? "(auto)" : requestedPort} because it is already in use. ` +
        `Stop the other process or set providers.opencode.config.managedPort.`
      );
    }
    return `The OpenCode CLI is installed, but the Homebase-managed server exited before it was reachable (${exitText}). See the Host logs for details.`;
  }

  #invalidateManaged(reason: string): void {
    if (this.#connection?.source === "managed") this.#connection = null;
    if (this.#failedManaged === null) {
      this.#failedManaged = { warning: reason, cliVersion: this.#cliVersion };
    }
  }

  #errorForDetection(detection: OpenCodeSupervisorDetection): AdapterError {
    const message = detection.warning ?? "The OpenCode provider is not available.";
    switch (detection.status) {
      case "auth_rejected":
        return new AdapterError("provider_not_authenticated", message);
      case "cli_missing":
        return new AdapterError("provider_not_installed", message);
      case "incompatible_cli":
        return new AdapterError("provider_incompatible", message);
      default:
        return new AdapterError("provider_unavailable", message);
    }
  }

  async #stopChild(child: ChildProcess, timeoutMs: number): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      closed.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!timedOut) return;
    child.kill("SIGKILL");
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      closed,
      new Promise<void>((resolve) => {
        killTimer = setTimeout(() => resolve(), 500);
      }),
    ]);
    if (killTimer) clearTimeout(killTimer);
  }
}

function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? "";
}
