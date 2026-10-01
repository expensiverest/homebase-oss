import type { AdapterLogger, AgentAdapter } from "@homebase/adapter-sdk";
import { parsePublicId } from "@homebase/adapter-sdk";
import { agentSessionUsageSchema, agentProviderUsageSchema, nowTimestamp } from "@homebase/protocol";
import type {
  AgentApprovalRequest,
  AgentDiff,
  AgentMessage,
  AgentPage,
  AgentQuestionRequest,
  AgentSession,
  AgentProviderUsage,
  AgentSessionUsage,
  ApprovalResult,
  CreateSessionInput,
  PageRequest,
  ProjectId,
  ProviderId,
  QuestionAnswer,
  SendMessageInput,
  SequencedAgentEvent,
  SessionId,
  SetModelInput,
  SetModeInput,
} from "@homebase/protocol";

import { HostError } from "../errors.js";
import type { EventBus } from "../events/index.js";
import type { ProjectRegistry } from "../projects/index.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { ProjectActivity } from "../projects/activity.js";

const DEFAULT_SESSION_PAGE_SIZE = 50;
const MAX_SESSION_PAGE_SIZE = 100;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_MESSAGE_PAGE_SIZE = 200;

interface ProviderCursorState {
  cursor: string | null;
  done: boolean;
}

interface SessionCursor {
  v: 1;
  /** Per-provider progress through independently paginated session lists. */
  providers: Record<ProviderId, ProviderCursorState>;
  /** Merged items that did not fit in the previous page. */
  pending: AgentSession[];
}

function clampPageSize(limit: number | null | undefined, fallback: number, max: number): number {
  if (limit == null) return fallback;
  return Math.max(1, Math.min(limit, max));
}

function encodeSessionCursor(cursor: SessionCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSessionCursor(cursor: string): SessionCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as SessionCursor;
    if (parsed?.v !== 1 || typeof parsed.providers !== "object" || !Array.isArray(parsed.pending)) {
      throw new Error("bad shape");
    }
    return parsed;
  } catch {
    throw new HostError("invalid_request", "Invalid pagination cursor.");
  }
}

export interface SessionServiceOptions {
  providers: ProviderRegistry;
  projects: ProjectRegistry;
  bus: EventBus;
  logger: AdapterLogger;
  activity?: ProjectActivity;
}

/**
 * Routes session operations to the right adapter and keeps the Host's session
 * index and pending approval/question routing tables up to date from the
 * normalized event stream.
 *
 * The index is in-memory for Phase 1; sessions are always re-discoverable from
 * their provider through `listSessions` / `getSession`.
 */
export class SessionService {
  readonly #providers: ProviderRegistry;
  readonly #projects: ProjectRegistry;
  readonly #logger: AdapterLogger;
  readonly #activity: ProjectActivity | undefined;

  readonly #sessions = new Map<SessionId, AgentSession>();
  readonly #providerBySession = new Map<SessionId, ProviderId>();
  /**
   * Full normalized pending requests, not just routing ids, so a browser
   * reload can rebuild approval/question cards from the Host after it has
   * already emitted `approval.requested` / `question.requested`.
   */
  readonly #pendingApprovals = new Map<string, { providerId: ProviderId; request: AgentApprovalRequest }>();
  readonly #pendingQuestions = new Map<string, { providerId: ProviderId; request: AgentQuestionRequest }>();

  constructor(options: SessionServiceOptions) {
    this.#providers = options.providers;
    this.#projects = options.projects;
    this.#logger = options.logger;
    this.#activity = options.activity;
    options.bus.subscribe((event) => this.#applyEvent(event));
  }

  #applyEvent(event: SequencedAgentEvent): void {
    switch (event.type) {
      case "session.created":
      case "session.updated": {
        const session = event.data.session;
        this.#sessions.set(session.id, session);
        this.#providerBySession.set(session.id, session.provider);
        this.#recordActivity(session);
        break;
      }
      case "session.deleted":
        this.#sessions.delete(event.data.sessionId);
        this.#providerBySession.delete(event.data.sessionId);
        this.#dropActionsForSession(event.data.sessionId);
        break;
      case "turn.started":
        this.#setState(event.sessionId, "working");
        if (event.projectId && this.#projects.get(event.projectId))
          this.#activity?.advance(event.projectId, event.occurredAt);
        break;
      case "turn.completed":
      case "turn.interrupted":
        this.#setState(event.sessionId, "idle");
        // A terminal run cannot leave actionable requests behind.
        this.#dropActionsForSession(event.sessionId);
        break;
      case "turn.failed":
        this.#setState(event.sessionId, "failed");
        this.#dropActionsForSession(event.sessionId);
        break;
      case "approval.requested":
        this.#pendingApprovals.set(event.data.approval.id, {
          providerId: event.provider,
          request: event.data.approval,
        });
        break;
      case "approval.resolved":
        this.#pendingApprovals.delete(event.data.resolution.requestId);
        break;
      case "question.requested":
        this.#pendingQuestions.set(event.data.question.id, {
          providerId: event.provider,
          request: event.data.question,
        });
        break;
      case "question.resolved":
        this.#pendingQuestions.delete(event.data.resolution.requestId);
        break;
      default:
        break;
    }
  }

  #dropActionsForSession(sessionId: SessionId | null): void {
    if (!sessionId) return;
    for (const [requestId, entry] of [...this.#pendingApprovals]) {
      if (entry.request.sessionId === sessionId) this.#pendingApprovals.delete(requestId);
    }
    for (const [requestId, entry] of [...this.#pendingQuestions]) {
      if (entry.request.sessionId === sessionId) this.#pendingQuestions.delete(requestId);
    }
  }

  #setState(sessionId: SessionId | null, state: AgentSession["state"]): void {
    if (!sessionId) return;
    const session = this.#sessions.get(sessionId);
    if (session) {
      this.#sessions.set(sessionId, { ...session, state });
    }
  }

  /**
   * Sessions across all providers for one Homebase project.
   *
   * Providers paginate independently, so the Host merges their pages and wraps
   * the per-provider cursors (plus any overflow) in one opaque cursor. Only
   * forward paging is supported for the merged view; `previousCursor` is null.
   */
  async listForProject(projectId: ProjectId, page: PageRequest = {}): Promise<AgentPage<AgentSession>> {
    const project = this.#projects.require(projectId);
    const limit = clampPageSize(page.limit, DEFAULT_SESSION_PAGE_SIZE, MAX_SESSION_PAGE_SIZE);
    const available = this.#providers.adapters();
    const state: SessionCursor = page.cursor
      ? decodeSessionCursor(page.cursor)
      : {
          v: 1,
          providers: Object.fromEntries(available.map(({ id }) => [id, { cursor: null, done: false }])),
          pending: [],
        };

    const collected: AgentSession[] = [...state.pending];
    const participants = available.filter(({ id }) => id in state.providers);
    const rounds = Math.max(1, participants.length * 4);

    for (let round = 0; round < rounds && collected.length < limit; round += 1) {
      let progressed = false;
      for (const { id } of participants) {
        const providerState = state.providers[id];
        if (!providerState || providerState.done) continue;
        try {
          // A prior provider/page may have awaited across runtime shutdown.
          const adapter = this.#providers.requireAdapter(id);
          const result = await adapter.listSessions(project, {
            limit,
            ...(providerState.cursor !== null ? { cursor: providerState.cursor } : {}),
          });
          for (const session of result.items) {
            this.#sessions.set(session.id, session);
            this.#providerBySession.set(session.id, id);
            this.#recordActivity(session);
            collected.push(session);
          }
          providerState.cursor = result.nextCursor;
          providerState.done = result.nextCursor === null;
          progressed = true;
        } catch (error) {
          this.#logger.warn("Provider session listing failed.", {
            provider: id,
            project: projectId,
            error: error instanceof Error ? error.message : String(error),
          });
          providerState.done = true;
        }
        if (collected.length >= limit) break;
      }
      if (!progressed) break;
    }

    collected.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const items = collected.slice(0, limit);
    const overflow = collected.slice(limit);
    const exhausted = participants.every(({ id }) => state.providers[id]?.done ?? true);
    const nextCursor =
      !exhausted || overflow.length > 0
        ? encodeSessionCursor({ v: 1, providers: state.providers, pending: overflow })
        : null;

    return { items, nextCursor, previousCursor: null };
  }

  /** Historical messages for one session, newest-first, using opaque cursors. */
  async listMessages(sessionId: SessionId, page: PageRequest = {}): Promise<AgentPage<AgentMessage>> {
    const { providerId } = await this.#resolveAdapter(sessionId);
    const adapter = this.#providers.requireAdapter(providerId);
    return adapter.listMessages(sessionId, {
      limit: clampPageSize(page.limit, DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE),
      ...(page.cursor != null ? { cursor: page.cursor } : {}),
    });
  }

  async get(sessionId: SessionId): Promise<AgentSession> {
    const cached = this.#sessions.get(sessionId);
    if (cached) return { ...cached };

    // Public ids carry trusted provider scope, so routing is deterministic:
    // never probe other adapters for an unknown session, and never swallow a
    // provider failure as "maybe another provider owns it".
    const parsed = parsePublicId(sessionId);
    if (!parsed) {
      throw new HostError("session_not_found", `Unknown session "${sessionId}".`);
    }
    const adapter = this.#providers.requireAdapter(parsed.providerId);
    const session = await adapter.getSession(sessionId);
    this.#sessions.set(session.id, session);
    this.#providerBySession.set(session.id, parsed.providerId);
    this.#recordActivity(session);
    return { ...session };
  }

  async create(input: CreateSessionInput): Promise<AgentSession> {
    const adapter = this.#providers.requireAdapter(input.provider);
    const project = this.#projects.require(input.projectId);
    const session = await adapter.createSession(input, project);
    this.#sessions.set(session.id, session);
    this.#providerBySession.set(session.id, session.provider);
    this.#activity?.advance(project.id, nowTimestamp());
    return { ...session };
  }

  async delete(sessionId: SessionId): Promise<void> {
    const { providerId, adapter } = await this.#resolveAdapter(sessionId);
    this.#providers.requireCapability(providerId, "deleteSession");
    if (!adapter.deleteSession) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support deleting sessions.`);
    }
    await adapter.deleteSession(sessionId);
    this.#sessions.delete(sessionId);
    this.#providerBySession.delete(sessionId);
  }

  async send(sessionId: SessionId, input: SendMessageInput): Promise<void> {
    const { providerId } = await this.#resolveAdapter(sessionId);
    const adapter = this.#providers.requireAdapter(providerId);
    await adapter.send(sessionId, input);
    const session = await this.get(sessionId);
    this.#activity?.advance(session.projectId, nowTimestamp());
  }

  async interrupt(sessionId: SessionId): Promise<void> {
    const { providerId, adapter } = await this.#resolveAdapter(sessionId);
    this.#providers.requireCapability(providerId, "interrupt");
    if (!adapter.interrupt) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support interrupt.`);
    }
    await adapter.interrupt(sessionId);
  }

  async steer(sessionId: SessionId, input: SendMessageInput): Promise<void> {
    const { providerId, adapter } = await this.#resolveAdapter(sessionId);
    this.#providers.requireCapability(providerId, "steer");
    if (!adapter.steer) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support steering.`);
    }
    await adapter.steer(sessionId, input);
  }

  async queue(sessionId: SessionId, input: SendMessageInput): Promise<void> {
    const { providerId, adapter } = await this.#resolveAdapter(sessionId);
    this.#providers.requireCapability(providerId, "queue");
    if (!adapter.queue) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support queueing.`);
    }
    await adapter.queue(sessionId, input);
  }

  async setModel(sessionId: SessionId, input: SetModelInput): Promise<void> {
    const { providerId, adapter } = await this.#resolveAdapter(sessionId);
    this.#providers.requireCapability(providerId, "modelSwitching");
    if (!adapter.setModel) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support model switching.`);
    }
    await adapter.setModel(sessionId, input);
  }

  async setMode(sessionId: SessionId, input: SetModeInput): Promise<void> {
    const { providerId, adapter } = await this.#resolveAdapter(sessionId);
    this.#providers.requireCapability(providerId, "modes");
    if (!adapter.setMode) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support modes.`);
    }
    await adapter.setMode(sessionId, input);
  }

  async getDiff(sessionId: SessionId): Promise<AgentDiff> {
    const { providerId, adapter } = await this.#resolveAdapter(sessionId);
    this.#providers.requireCapability(providerId, "diffs");
    if (!adapter.getDiff) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support diffs.`);
    }
    return adapter.getDiff(sessionId);
  }

  async resolveApproval(requestId: string, result: ApprovalResult): Promise<void> {
    const entry = this.#pendingApprovals.get(requestId);
    if (!entry) {
      throw new HostError("not_found", `No pending approval with id "${requestId}".`);
    }
    this.#providers.requireCapability(entry.providerId, "approvals");
    const adapter = this.#providers.requireAdapter(entry.providerId);
    if (!adapter.resolveApproval) {
      throw new HostError("unsupported_capability", `Provider "${entry.providerId}" does not support approvals.`);
    }
    await adapter.resolveApproval(requestId, result);
  }

  async answerQuestion(requestId: string, answer: QuestionAnswer): Promise<void> {
    const entry = this.#pendingQuestions.get(requestId);
    if (!entry) {
      throw new HostError("not_found", `No pending question with id "${requestId}".`);
    }
    this.#providers.requireCapability(entry.providerId, "questions");
    const adapter = this.#providers.requireAdapter(entry.providerId);
    if (!adapter.answerQuestion) {
      throw new HostError("unsupported_capability", `Provider "${entry.providerId}" does not support questions.`);
    }
    await adapter.answerQuestion(requestId, answer);
  }

  /**
   * Pending approval/question state for one session, oldest first, rebuilt
   * from normalized events so a browser reload can re-render action cards.
   */
  async listActions(
    sessionId: SessionId,
  ): Promise<{ approvals: AgentApprovalRequest[]; questions: AgentQuestionRequest[] }> {
    // Resolving the session validates scope and lets adapters that reconcile
    // provider-side pending state (OpenCode) refresh it.
    await this.get(sessionId);
    const approvals = [...this.#pendingApprovals.values()]
      .filter((entry) => entry.request.sessionId === sessionId)
      .map((entry) => structuredClone(entry.request))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const questions = [...this.#pendingQuestions.values()]
      .filter((entry) => entry.request.sessionId === sessionId)
      .map((entry) => structuredClone(entry.request))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { approvals, questions };
  }

  async getProviderUsage(providerId: ProviderId): Promise<AgentProviderUsage | null> {
    this.#providers.requireCapability(providerId, "providerUsage");
    const adapter = this.#providers.requireAdapter(providerId);
    if (!adapter.getProviderUsage) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support usage.`);
    }
    const value = await adapter.getProviderUsage();
    if (value === null) return null;
    const parsed = agentProviderUsageSchema.safeParse(value);
    if (!parsed.success || parsed.data.provider !== providerId)
      throw new HostError("provider_error", "Provider returned invalid usage limits.");
    return parsed.data;
  }

  async getSessionUsage(sessionId: SessionId): Promise<AgentSessionUsage | null> {
    const session = await this.get(sessionId);
    const { providerId, adapter } = await this.#resolveAdapter(sessionId);
    this.#projects.require(session.projectId);
    if (!this.#providers.getProvider(providerId).capabilities.sessionUsage) return null;
    const value = await adapter.getSessionUsage(sessionId);
    if (value === null) return null;
    const parsed = agentSessionUsageSchema.safeParse(value);
    if (!parsed.success || parsed.data.provider !== providerId || parsed.data.sessionId !== sessionId)
      throw new HostError("provider_error", "Provider returned invalid session usage.");
    return parsed.data;
  }

  #recordActivity(session: AgentSession): void {
    if (this.#projects.get(session.projectId)) this.#activity?.advance(session.projectId, session.updatedAt);
  }

  /** Session index snapshot, for diagnostics. */
  listKnown(): AgentSession[] {
    return [...this.#sessions.values()].map((session) => ({ ...session }));
  }

  async #resolveAdapter(sessionId: SessionId): Promise<{ providerId: ProviderId; adapter: AgentAdapter }> {
    // Public ids carry trusted provider scope; malformed or foreign ids fail
    // closed instead of being probed across adapters.
    const parsed = parsePublicId(sessionId);
    if (!parsed) {
      throw new HostError("session_not_found", `Unknown session "${sessionId}".`);
    }
    return { providerId: parsed.providerId, adapter: this.#providers.requireAdapter(parsed.providerId) };
  }
}
