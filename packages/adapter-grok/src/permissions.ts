import { AdapterError, createPublicId, type AdapterLogger, type AdapterContext } from "@homebase/adapter-sdk";
import {
  nowTimestamp,
  type AgentApprovalRequest,
  type ApprovalResult,
  type ProjectId,
  type ProviderId,
  type SessionId,
} from "@homebase/protocol";
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";

import { mapPermissionOptions } from "./mapper.js";

interface PendingPermission {
  request: AgentApprovalRequest;
  nativeSessionId: string;
  publicSessionId: SessionId;
  projectId: ProjectId;
  options: RequestPermissionRequest["options"];
  resolve(response: RequestPermissionResponse): void;
}

export interface PermissionRegistration {
  nativeSessionId: string;
  publicSessionId: SessionId;
  projectId: ProjectId;
}

/**
 * Bridges ACP `session/request_permission` into Homebase approval cards.
 *
 * The ACP request stays pending until the remote user decides; the exact
 * provider option (allow once / allow always / reject once / reject always) is
 * preserved and sent back. "Always" semantics belong to Grok.
 */
export class GrokPermissionBridge {
  readonly #provider: ProviderId;
  readonly #emit: (event: Parameters<AdapterContext["emit"]>[0]) => void;
  readonly #logger: AdapterLogger | undefined;
  readonly #pending = new Map<string, PendingPermission>();
  #counter = 0;

  constructor(options: {
    provider: ProviderId;
    emit: (event: Parameters<AdapterContext["emit"]>[0]) => void;
    logger?: AdapterLogger;
  }) {
    this.#provider = options.provider;
    this.#emit = options.emit;
    this.#logger = options.logger;
  }

  /** Registers a pending approval and emits `approval.requested`. */
  register(
    request: RequestPermissionRequest,
    route: PermissionRegistration,
  ): { requestId: string; response: Promise<RequestPermissionResponse> } {
    const publicId = createPublicId(this.#provider, `perm_${++this.#counter}_${request.toolCall.toolCallId}`);
    const toolCall = request.toolCall;
    const approval: AgentApprovalRequest = {
      id: publicId,
      sessionId: route.publicSessionId,
      provider: this.#provider,
      createdAt: nowTimestamp(),
      kind: toolCall.kind === "execute" ? "command" : toolCall.kind === "other" ? "other" : "tool",
      title: toolCall.title ?? toolCall.name ?? "Approval required",
      detail: toolCall.name && toolCall.name !== toolCall.title ? toolCall.name : null,
      toolCallId: toolCall.toolCallId,
      options: mapPermissionOptions(request.options),
    };
    const response = new Promise<RequestPermissionResponse>((resolve) => {
      this.#pending.set(publicId, {
        request: approval,
        nativeSessionId: route.nativeSessionId,
        publicSessionId: route.publicSessionId,
        projectId: route.projectId,
        options: request.options,
        resolve,
      });
      this.#emit({
        type: "approval.requested",
        provider: this.#provider,
        projectId: route.projectId,
        sessionId: route.publicSessionId,
        occurredAt: nowTimestamp(),
        data: { approval },
      });
    });
    return { requestId: publicId, response };
  }

  /** Resolves a pending approval with the exact provider option id. */
  resolve(requestId: string, result: ApprovalResult): void {
    const pending = this.#pending.get(requestId);
    if (!pending) {
      throw new AdapterError("not_found", `No pending Grok approval with id "${requestId}".`);
    }
    const option = pending.options.find((candidate) => candidate.optionId === result.optionId);
    if (!option) {
      throw new AdapterError("invalid_request", `Unknown Grok approval option "${result.optionId}".`);
    }
    this.#settle(pending, { outcome: { outcome: "selected", optionId: option.optionId } }, "user");
  }

  /** Cancels every pending approval for one session (interrupt/exit). */
  cancelSession(nativeSessionId: string, resolvedBy: "user" | "system" = "system"): void {
    for (const pending of [...this.#pending.values()]) {
      if (pending.nativeSessionId === nativeSessionId) {
        this.#settle(pending, { outcome: { outcome: "cancelled" } }, resolvedBy);
      }
    }
  }

  /** Cancels every pending approval (process death/dispose). */
  cancelAll(resolvedBy: "system" = "system"): void {
    for (const pending of [...this.#pending.values()]) {
      this.#settle(pending, { outcome: { outcome: "cancelled" } }, resolvedBy);
    }
  }

  pendingCount(): number {
    return this.#pending.size;
  }

  #settle(pending: PendingPermission, response: RequestPermissionResponse, resolvedBy: "user" | "system"): void {
    this.#pending.delete(pending.request.id);
    pending.resolve(response);
    const optionId =
      response.outcome.outcome === "selected"
        ? response.outcome.optionId
        : (pending.request.options[0]?.id ?? "cancelled");
    this.#emit({
      type: "approval.resolved",
      provider: this.#provider,
      projectId: pending.projectId,
      sessionId: pending.publicSessionId,
      occurredAt: nowTimestamp(),
      data: {
        resolution: {
          requestId: pending.request.id,
          optionId,
          resolvedAt: nowTimestamp(),
          resolvedBy,
        },
      },
    });
    this.#logger?.debug("Grok approval resolved.");
  }
}
