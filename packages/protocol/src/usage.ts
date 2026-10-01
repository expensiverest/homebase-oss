import { z } from "zod";
import { providerIdSchema, sessionIdSchema } from "./ids.js";
import { timestampSchema } from "./entities.js";

const tokens = z.number().int().nonnegative().nullable().optional();
const quantity = z.number().nonnegative().nullable().optional();

/** Input includes cached input; reasoning is a subset of output when the provider says so.
 * Adapters reconcile their native accounting before crossing this boundary. */
export const agentTokenUsageSchema = z.strictObject({
  inputTokens: tokens,
  outputTokens: tokens,
  reasoningTokens: tokens,
  cacheReadTokens: tokens,
  cacheWriteTokens: tokens,
  totalTokens: tokens,
});
export type AgentTokenUsage = z.infer<typeof agentTokenUsageSchema>;

const consumption = {
  provider: providerIdSchema,
  sessionId: sessionIdSchema,
  tokens: agentTokenUsageSchema,
  costUsd: quantity,
  contextTokens: tokens,
  contextWindow: z.number().int().positive().nullable().optional(),
  /** Partial observations must never masquerade as complete historical totals. */
  partial: z.boolean().optional(),
};
export const agentTurnUsageSchema = z.strictObject({
  ...consumption,
  turnId: z.string().min(1),
  observedAt: timestampSchema,
});
export type AgentTurnUsage = z.infer<typeof agentTurnUsageSchema>;
export const agentSessionUsageSchema = z.strictObject({ ...consumption, updatedAt: timestampSchema });
export type AgentSessionUsage = z.infer<typeof agentSessionUsageSchema>;
