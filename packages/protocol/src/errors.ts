import { z } from "zod";

import { providerIdSchema } from "./ids.js";

/**
 * Stable, provider-neutral error codes. These are part of the public API
 * contract: both adapter errors and Host API errors use this vocabulary so the
 * client never has to parse provider-native errors.
 */
export const agentErrorCodeSchema = z.enum([
  "invalid_request",
  "not_found",
  "conflict",
  "rate_limited",
  "pairing_invalid",
  "pairing_expired",
  "pairing_used",

  "project_not_found",
  "project_not_allowed",
  "project_unavailable",

  "provider_not_found",
  "provider_unavailable",
  "provider_not_installed",
  "provider_not_authenticated",
  "provider_incompatible",
  "provider_error",

  "session_not_found",
  "session_not_active",
  "session_already_exists",

  "unsupported_capability",
  "invalid_attachment",

  "timeout",
  "aborted",
  "internal",
  "unknown",
]);
export type AgentErrorCode = z.infer<typeof agentErrorCodeSchema>;

/** A normalized provider/adapter error. Never contains credentials. */
export const agentErrorSchema = z.object({
  code: agentErrorCodeSchema,
  message: z.string(),
  provider: providerIdSchema.nullable().optional(),
  retryable: z.boolean().optional(),
  details: z.record(z.string(), z.json()).nullable().optional(),
});
export type AgentError = z.infer<typeof agentErrorSchema>;

/** The JSON body every Homebase API error response uses. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: agentErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.json()).nullable().optional(),
    requestId: z.string().nullable().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export function isAgentErrorCode(value: string): value is AgentErrorCode {
  return agentErrorCodeSchema.safeParse(value).success;
}
