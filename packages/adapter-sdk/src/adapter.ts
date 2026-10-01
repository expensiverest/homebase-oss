import type {
  AgentCapabilities,
  AgentDiff,
  AgentEvent,
  AgentMessage,
  AgentMode,
  AgentModel,
  AgentPage,
  AgentProject,
  AgentSession,
  AgentProviderUsage,
  AgentSessionUsage,
  ApprovalResult,
  AttachmentId,
  CreateSessionInput,
  PageRequest,
  ProjectId,
  ProviderDetection,
  ProviderId,
  QuestionAnswer,
  SendMessageInput,
  SessionId,
  SetModelInput,
  SetModeInput,
} from "@homebase/protocol";

import type { ResolvedAttachment } from "./attachments.js";

/** Minimal logging surface handed to adapters. Never logs credentials. */
export interface AdapterLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Everything an adapter is allowed to know about its host environment.
 *
 * Adapters must not read configuration files, environment variables, or filesystem
 * paths directly for project resolution. They use `resolveProjectPath`, which is
 * backed by the Host's canonical project registry and allowlist.
 */
export interface AdapterContext {
  /** Homebase Host version, for diagnostics. */
  readonly hostVersion: string;
  /** Per-provider configuration from the validated Host config. Read-only. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly logger: AdapterLogger;
  /**
   * Resolves a Homebase project id to its canonical, allowlisted path.
   * Throws `AdapterError` when the project is unknown or outside configured roots.
   */
  resolveProjectPath(projectId: ProjectId): Promise<string>;
  /**
   * Maps a canonical (or canonicalizable) directory back to a Homebase project
   * id, or null when the directory is not inside any configured project root.
   * Adapters use this to associate provider sessions/transcripts that carry
   * their own working directory with a Homebase project.
   */
  findProjectByPath(path: string): Promise<ProjectId | null>;
  /**
   * Resolves an uploaded attachment id to Host-owned bytes. Adapters never read
   * filesystem paths supplied by clients. Throws `AdapterError` with code
   * `invalid_attachment` when the id is unknown or expired.
   */
  resolveAttachment(attachmentId: AttachmentId): Promise<ResolvedAttachment>;
  /**
   * Emits a normalized event to the Host. The Host stamps sequence numbers and
   * fans the event out to SSE clients; adapters never talk to clients directly.
   */
  emit(event: AgentEvent): void;
}

/**
 * The contract every provider adapter implements.
 *
 * Optional methods are gated by capabilities: if an adapter declares a
 * capability, the matching method must exist and work. If the capability is
 * false, the method may be absent. Shared Host and UI code must branch on
 * capabilities, never on provider identity.
 */
export interface AgentAdapter {
  readonly id: ProviderId;
  /** Human-readable provider name for diagnostics and logs. */
  readonly displayName: string;

  /** Called once before any other method. */
  init?(context: AdapterContext): void | Promise<void>;
  /** Called when the Host shuts down. */
  dispose?(): void | Promise<void>;

  /** Probes installation, authentication, version, and compatibility. */
  detect(): Promise<ProviderDetection>;
  /** Declares what this adapter can do. Must match implemented methods. */
  getCapabilities(): Promise<AgentCapabilities>;

  listModels(project: AgentProject): Promise<AgentModel[]>;
  listModes(project: AgentProject): Promise<AgentMode[]>;

  /**
   * Lists sessions for a project. Newest-first by default; `page.cursor` moves
   * through provider order and is opaque to callers.
   */
  listSessions(project: AgentProject, page?: PageRequest): Promise<AgentPage<AgentSession>>;
  getSession(sessionId: SessionId): Promise<AgentSession>;
  createSession(input: CreateSessionInput, project: AgentProject): Promise<AgentSession>;
  deleteSession?(sessionId: SessionId): Promise<void>;

  /**
   * Returns historical messages for a session, newest-first by default, using
   * opaque provider cursors. Fetched history is authoritative when reopening a
   * session; live events are the incremental overlay.
   */
  listMessages(sessionId: SessionId, page?: PageRequest): Promise<AgentPage<AgentMessage>>;

  /**
   * Sends a user message. Resolves once the provider has accepted the message,
   * not when the turn completes; progress arrives through normalized events.
   * When the session is already working, providers may steer or queue according
   * to their default behavior; clients should use `steer`/`queue` explicitly.
   */
  send(sessionId: SessionId, input: SendMessageInput): Promise<void>;
  interrupt?(sessionId: SessionId): Promise<void>;
  /** Injects a message into the active turn. */
  steer?(sessionId: SessionId, input: SendMessageInput): Promise<void>;
  /** Parks a message for delivery after the active turn (or starts one when idle). */
  queue?(sessionId: SessionId, input: SendMessageInput): Promise<void>;

  resolveApproval?(requestId: string, result: ApprovalResult): Promise<void>;
  answerQuestion?(requestId: string, answer: QuestionAnswer): Promise<void>;

  setModel?(sessionId: SessionId, input: SetModelInput): Promise<void>;
  setMode?(sessionId: SessionId, input: SetModeInput): Promise<void>;

  getDiff?(sessionId: SessionId): Promise<AgentDiff>;
  /** Required even when unsupported: return null and declare the capability false.
   * A supported provider may return null until it has trustworthy observations. */
  getSessionUsage(sessionId: SessionId): Promise<AgentSessionUsage | null>;
  getProviderUsage(): Promise<AgentProviderUsage | null>;
}

/**
 * Registers an adapter factory with the Host. Factories receive the validated
 * per-provider config object; they must not read environment variables.
 */
export interface AdapterRegistration {
  readonly id: ProviderId;
  readonly displayName: string;
  create(config: Readonly<Record<string, unknown>>): AgentAdapter;
}
