import type { AgentEvent, AgentEventType } from "@homebase/protocol";

import type { AdapterLogger } from "../adapter.js";
import type { ResolvedAttachment } from "../attachments.js";
import { AdapterError } from "../errors.js";
import { createRecordingLogger, type RecordedLogEntry } from "../logger.js";

export interface TestAdapterContextOptions {
  /** Canonical project path returned by `resolveProjectPath`. */
  projectPath?: string;
  /** Project id returned by `findProjectByPath` for the canonical path. */
  projectId?: string;
  config?: Record<string, unknown>;
  hostVersion?: string;
  logger?: AdapterLogger;
  /** Attachment bytes available to the adapter under test. */
  attachments?: Map<string, ResolvedAttachment>;
}

interface Waiter {
  type: AgentEventType;
  predicate: (event: AgentEvent) => boolean;
  resolve: (event: AgentEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface TestAdapterContext {
  readonly hostVersion: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly logger: AdapterLogger;
  /** Every event emitted through this context, in order. */
  readonly events: AgentEvent[];
  resolveProjectPath(projectId: string): Promise<string>;
  findProjectByPath(path: string): Promise<string | null>;
  resolveAttachment(attachmentId: string): Promise<ResolvedAttachment>;
  emit(event: AgentEvent): void;
  waitForEvent<T extends AgentEventType>(
    type: T,
    predicate?: (event: Extract<AgentEvent, { type: T }>) => boolean,
    timeoutMs?: number,
  ): Promise<Extract<AgentEvent, { type: T }>>;
  clearEvents(): void;
  logs(): RecordedLogEntry[];
}

/**
 * In-memory `AdapterContext` for unit tests, compliance suites, and examples.
 * Records emitted events, provides `waitForEvent`, and refuses project paths and
 * attachments it was not given (mirroring the Host's allowlist behavior).
 */
export function createTestAdapterContext(options: TestAdapterContextOptions = {}): TestAdapterContext {
  const recording = createRecordingLogger();
  const events: AgentEvent[] = [];
  const waiters: Waiter[] = [];
  const attachments = options.attachments ?? new Map();

  const emit = (event: AgentEvent) => {
    events.push(event);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (!waiter || waiter.type !== event.type || !waiter.predicate(event)) continue;
      clearTimeout(waiter.timer);
      waiters.splice(index, 1);
      waiter.resolve(event);
    }
  };

  const context: TestAdapterContext = {
    hostVersion: options.hostVersion ?? "0.0.1-test",
    config: Object.freeze({ ...(options.config ?? {}) }),
    logger: options.logger ?? recording.logger,
    events,
    async resolveProjectPath(projectId) {
      if (options.projectPath === undefined) {
        throw new AdapterError("project_not_found", `Test context has no project path for project "${projectId}".`);
      }
      return options.projectPath;
    },
    async findProjectByPath(path) {
      if (options.projectPath !== undefined && path === options.projectPath) {
        return options.projectId ?? null;
      }
      return null;
    },
    async resolveAttachment(attachmentId) {
      const attachment = attachments.get(attachmentId);
      if (!attachment) {
        throw new AdapterError("invalid_attachment", `Unknown or expired attachment "${attachmentId}".`);
      }
      return attachment;
    },
    emit,
    waitForEvent(type, predicate, timeoutMs = 5_000) {
      const matches = (event: AgentEvent): event is Extract<AgentEvent, { type: typeof type }> =>
        event.type === type && (predicate ? predicate(event as Extract<AgentEvent, { type: typeof type }>) : true);

      const existing = events.find(matches);
      if (existing) return Promise.resolve(existing);

      return new Promise((resolve, reject) => {
        const waiter: Waiter = {
          type,
          predicate: (event) => matches(event),
          resolve: (event) => resolve(event as Extract<AgentEvent, { type: typeof type }>),
          reject,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${type}" event.`));
          }, timeoutMs),
        };
        waiters.push(waiter);
      });
    },
    clearEvents() {
      events.length = 0;
    },
    logs() {
      return recording.entries;
    },
  };

  return context;
}
