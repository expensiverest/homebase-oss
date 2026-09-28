import { z } from "zod";

import { agentCapabilitiesSchema } from "./capabilities.js";
import { modelIdSchema, projectIdSchema, providerIdSchema, sessionIdSchema } from "./ids.js";

/** All protocol timestamps are ISO 8601 strings. */
export const timestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof timestampSchema>;

/** Current time as a protocol timestamp. */
export function nowTimestamp(): Timestamp {
  return new Date().toISOString();
}

/**
 * Result of probing the local environment for a provider CLI, server, or SDK.
 * Detection never returns credentials; only states the UI is allowed to show.
 */
export const providerDetectionSchema = z.object({
  installed: z.boolean(),
  authenticated: z.boolean().nullable(),
  compatible: z.boolean(),
  version: z.string().nullable().optional(),
  warning: z.string().nullable().optional(),
});
export type ProviderDetection = z.infer<typeof providerDetectionSchema>;

export const agentProviderSchema = z.object({
  id: providerIdSchema,
  name: z.string(),
  version: z.string().nullable().optional(),
  installed: z.boolean(),
  authenticated: z.boolean().nullable(),
  compatible: z.boolean(),
  capabilities: agentCapabilitiesSchema,
  warning: z.string().nullable().optional(),
});
export type AgentProvider = z.infer<typeof agentProviderSchema>;

/**
 * A Homebase project. `path` is always the canonical path resolved by the Host
 * from its own project registry; it is never supplied by a client.
 */
export const agentProjectSchema = z.object({
  id: projectIdSchema,
  name: z.string(),
  path: z.string(),
  gitRoot: z.string().nullable().optional(),
  gitRemote: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  providersAvailable: z.array(providerIdSchema),
});
export type AgentProject = z.infer<typeof agentProjectSchema>;

export const agentThinkingLevelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable().optional(),
});
export type AgentThinkingLevel = z.infer<typeof agentThinkingLevelSchema>;

export const agentModelSchema = z.object({
  id: modelIdSchema,
  provider: providerIdSchema,
  name: z.string(),
  description: z.string().nullable().optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxOutputTokens: z.number().int().positive().nullable().optional(),
  thinkingLevels: z.array(agentThinkingLevelSchema).optional(),
  defaultThinkingLevel: z.string().nullable().optional(),
  deprecated: z.boolean().optional(),
});
export type AgentModel = z.infer<typeof agentModelSchema>;

/** Reference to a model, optionally with a thinking/effort level. */
export const agentModelRefSchema = z.object({
  provider: providerIdSchema,
  modelId: modelIdSchema,
  thinkingLevel: z.string().nullable().optional(),
});
export type AgentModelRef = z.infer<typeof agentModelRefSchema>;

export const agentModeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable().optional(),
});
export type AgentMode = z.infer<typeof agentModeSchema>;

/**
 * Session states shared by every provider.
 *
 * `unknown` exists because some providers (notably transcript-backed ones)
 * cannot report the run state of a persisted session when Homebase starts.
 * Claiming `idle` there would be a lie; `unknown` lets the UI avoid showing a
 * stale "Working" state.
 */
export const agentSessionStateSchema = z.enum(["idle", "working", "waiting", "failed", "completed", "unknown"]);
export type AgentSessionState = z.infer<typeof agentSessionStateSchema>;

export const agentSessionSchema = z.object({
  id: sessionIdSchema,
  provider: providerIdSchema,
  projectId: projectIdSchema,
  title: z.string().nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  state: agentSessionStateSchema,
  model: agentModelRefSchema.nullable().optional(),
  mode: z.string().nullable().optional(),
  thinkingLevel: z.string().nullable().optional(),
});
export type AgentSession = z.infer<typeof agentSessionSchema>;
