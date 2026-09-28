import type { AdapterLogger, AgentAdapter } from "@homebase/adapter-sdk";
import type {
  AgentDiff,
  AgentSession,
  AgentUsage,
  ApprovalResult,
  CreateSessionInput,
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

export interface SessionServiceOptions {
  providers: ProviderRegistry;
  projects: ProjectRegistry;
  bus: EventBus;
  logger: AdapterLogger;
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

  readonly #sessions = new Map<SessionId, AgentSession>();
  readonly #providerBySession = new Map<SessionId, ProviderId>();
  readonly #pendingApprovals = new Map<string, ProviderId>();
  readonly #pendingQuestions = new Map<string, ProviderId>();

  constructor(options: SessionServiceOptions) {
    this.#providers = options.providers;
    this.#projects = options.projects;
    this.#logger = options.logger;
    options.bus.subscribe((event) => this.#applyEvent(event));
  }

  #applyEvent(event: SequencedAgentEvent): void {
    switch (event.type) {
      case "session.created":
      case "session.updated": {
        const session = event.data.session;
        this.#sessions.set(session.id, session);
        this.#providerBySession.set(session.id, session.provider);
        break;
      }
      case "session.deleted":
        this.#sessions.delete(event.data.sessionId);
        this.#providerBySession.delete(event.data.sessionId);
        break;
      case "turn.started":
        this.#setState(event.sessionId, "working");
        break;
      case "turn.completed":
      case "turn.interrupted":
        this.#setState(event.sessionId, "idle");
        break;
      case "turn.failed":
        this.#setState(event.sessionId, "failed");
        break;
      case "approval.requested":
        this.#pendingApprovals.set(event.data.approval.id, event.provider);
        break;
      case "approval.resolved":
        this.#pendingApprovals.delete(event.data.resolution.requestId);
        break;
      case "question.requested":
        this.#pendingQuestions.set(event.data.question.id, event.provider);
        break;
      case "question.resolved":
        this.#pendingQuestions.delete(event.data.resolution.requestId);
        break;
      default:
        break;
    }
  }

  #setState(sessionId: SessionId | null, state: AgentSession["state"]): void {
    if (!sessionId) return;
    const session = this.#sessions.get(sessionId);
    if (session) {
      this.#sessions.set(sessionId, { ...session, state });
    }
  }

  /** Sessions across all providers for one Homebase project. */
  async listForProject(projectId: ProjectId): Promise<AgentSession[]> {
    const project = this.#projects.require(projectId);
    const collected: AgentSession[] = [];

    for (const { id, adapter } of this.#providers.adapters()) {
      try {
        const sessions = await adapter.listSessions(project);
        for (const session of sessions) {
          this.#sessions.set(session.id, session);
          this.#providerBySession.set(session.id, id);
          collected.push(session);
        }
      } catch (error) {
        this.#logger.warn("Provider session listing failed.", {
          provider: id,
          project: projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return collected.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(sessionId: SessionId): Promise<AgentSession> {
    const cached = this.#sessions.get(sessionId);
    if (cached) return { ...cached };

    // The session may exist provider-side but not be in the in-memory index
    // (for example after a Host restart). Ask each adapter in turn.
    for (const { id, adapter } of this.#providers.adapters()) {
      try {
        const session = await adapter.getSession(sessionId);
        this.#sessions.set(session.id, session);
        this.#providerBySession.set(session.id, id);
        return { ...session };
      } catch {
        // Not this provider's session; keep looking.
      }
    }

    throw new HostError("session_not_found", `Unknown session "${sessionId}".`);
  }

  async create(input: CreateSessionInput): Promise<AgentSession> {
    const adapter = this.#providers.requireAdapter(input.provider);
    const project = this.#projects.require(input.projectId);
    const session = await adapter.createSession(input, project);
    this.#sessions.set(session.id, session);
    this.#providerBySession.set(session.id, session.provider);
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
    const { adapter } = await this.#resolveAdapter(sessionId);
    await adapter.send(sessionId, input);
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
    const providerId = this.#pendingApprovals.get(requestId);
    if (!providerId) {
      throw new HostError("not_found", `No pending approval with id "${requestId}".`);
    }
    this.#providers.requireCapability(providerId, "approvals");
    const adapter = this.#providers.requireAdapter(providerId);
    if (!adapter.resolveApproval) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support approvals.`);
    }
    await adapter.resolveApproval(requestId, result);
  }

  async answerQuestion(requestId: string, answer: QuestionAnswer): Promise<void> {
    const providerId = this.#pendingQuestions.get(requestId);
    if (!providerId) {
      throw new HostError("not_found", `No pending question with id "${requestId}".`);
    }
    this.#providers.requireCapability(providerId, "questions");
    const adapter = this.#providers.requireAdapter(providerId);
    if (!adapter.answerQuestion) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support questions.`);
    }
    await adapter.answerQuestion(requestId, answer);
  }

  async getUsage(providerId: ProviderId): Promise<AgentUsage | null> {
    this.#providers.requireCapability(providerId, "usage");
    const adapter = this.#providers.requireAdapter(providerId);
    if (!adapter.getUsage) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support usage.`);
    }
    return adapter.getUsage();
  }

  /** Session index snapshot, for diagnostics. */
  listKnown(): AgentSession[] {
    return [...this.#sessions.values()].map((session) => ({ ...session }));
  }

  async #resolveAdapter(sessionId: SessionId): Promise<{ providerId: ProviderId; adapter: AgentAdapter }> {
    let providerId = this.#providerBySession.get(sessionId);
    if (!providerId) {
      await this.get(sessionId); // Populates the index or throws session_not_found.
      providerId = this.#providerBySession.get(sessionId);
    }
    if (!providerId) {
      throw new HostError("session_not_found", `Unknown session "${sessionId}".`);
    }
    return { providerId, adapter: this.#providers.requireAdapter(providerId) };
  }
}
