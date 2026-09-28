import { z } from "zod";

import {
  agentDiffSummarySchema,
  agentApprovalRequestSchema,
  agentApprovalResolutionSchema,
  agentMessageSchema,
  agentPlanSchema,
  agentQuestionRequestSchema,
  agentQuestionResolutionSchema,
  agentToolCallSchema,
  agentUsageSchema,
  jsonValueSchema,
} from "./content.js";
import { agentProviderSchema, agentSessionSchema, timestampSchema } from "./entities.js";
import {
  eventIdSchema,
  messageIdSchema,
  partIdSchema,
  projectIdSchema,
  providerIdSchema,
  sessionIdSchema,
} from "./ids.js";
import { agentErrorSchema } from "./errors.js";

/**
 * Every provider feeds this single normalized event vocabulary. Adapters emit
 * these events; the Host stamps sequence numbers and fans them out. Native
 * provider payloads never cross this boundary (except `provider.event`, which
 * is an explicit escape hatch).
 */
const eventBase = {
  provider: providerIdSchema,
  projectId: projectIdSchema.nullable(),
  sessionId: sessionIdSchema.nullable(),
  /** Adapters may omit this; the Host stamps host time when publishing. */
  occurredAt: timestampSchema.optional(),
};

const event = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({
    type: z.literal(type),
    ...eventBase,
    data,
  });

export const agentEventSchema = z.discriminatedUnion("type", [
  event("provider.connected", z.object({ provider: agentProviderSchema })),
  event("provider.disconnected", z.object({ providerId: providerIdSchema, reason: z.string().nullable().optional() })),
  event("provider.updated", z.object({ provider: agentProviderSchema })),

  event("session.created", z.object({ session: agentSessionSchema })),
  event("session.updated", z.object({ session: agentSessionSchema })),
  event("session.deleted", z.object({ sessionId: sessionIdSchema })),

  event("turn.started", z.object({ turnId: z.string().min(1), messageId: messageIdSchema.nullable().optional() })),
  event("turn.completed", z.object({ turnId: z.string().min(1), usage: agentUsageSchema.nullable().optional() })),
  event("turn.failed", z.object({ turnId: z.string().min(1), error: agentErrorSchema })),
  event("turn.interrupted", z.object({ turnId: z.string().min(1) })),

  event("message.started", z.object({ message: agentMessageSchema })),
  event("message.delta", z.object({ messageId: messageIdSchema, partId: partIdSchema, delta: z.string() })),
  event("message.completed", z.object({ message: agentMessageSchema })),

  event(
    "reasoning.started",
    z.object({ messageId: messageIdSchema, partId: partIdSchema, text: z.string().optional() }),
  ),
  event("reasoning.delta", z.object({ messageId: messageIdSchema, partId: partIdSchema, delta: z.string() })),
  event(
    "reasoning.completed",
    z.object({ messageId: messageIdSchema, partId: partIdSchema, text: z.string().optional() }),
  ),

  event("tool.started", z.object({ toolCall: agentToolCallSchema })),
  event("tool.updated", z.object({ toolCall: agentToolCallSchema })),
  event("tool.completed", z.object({ toolCall: agentToolCallSchema })),
  event("tool.failed", z.object({ toolCall: agentToolCallSchema })),

  event("approval.requested", z.object({ approval: agentApprovalRequestSchema })),
  event("approval.resolved", z.object({ resolution: agentApprovalResolutionSchema })),

  event("question.requested", z.object({ question: agentQuestionRequestSchema })),
  event("question.resolved", z.object({ resolution: agentQuestionResolutionSchema })),

  event("plan.updated", z.object({ plan: agentPlanSchema, messageId: messageIdSchema.nullable().optional() })),
  event("diff.updated", z.object({ diff: agentDiffSummarySchema })),
  event("usage.updated", z.object({ usage: agentUsageSchema })),

  /** Escape hatch. Normal UI code should rarely consume this. */
  event(
    "provider.event",
    z.object({ provider: providerIdSchema, nativeType: z.string(), data: jsonValueSchema.nullable().optional() }),
  ),
]);

/** A normalized event as emitted by an adapter, before Host sequencing. */
export type AgentEvent = z.infer<typeof agentEventSchema>;

export type AgentEventType = AgentEvent["type"];

/** All normalized event type names, useful for diagnostics and tests. */
export const AGENT_EVENT_TYPES = agentEventSchema.options.map((option) => option.shape.type.value) as AgentEventType[];

/**
 * An event as delivered by the Host: globally sequenced and stamped. The Host
 * owns `id`, `sequence`, and `occurredAt`; clients use `sequence` for
 * reconnect/replay after app suspension.
 */
export const sequencedAgentEventSchema = z.intersection(
  agentEventSchema,
  z.object({
    id: eventIdSchema,
    sequence: z.number().int().nonnegative(),
    occurredAt: timestampSchema,
  }),
);

export type SequencedAgentEvent = z.infer<typeof sequencedAgentEventSchema>;
