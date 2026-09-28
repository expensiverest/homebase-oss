import { z } from "zod";

/**
 * Provider ids are stable, lowercase, provider-owned identifiers such as
 * `opencode`, `claude`, `grok`, `gemini`, `codex`, or `copilot`.
 */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const providerIdSchema = z.string().regex(PROVIDER_ID_PATTERN, "provider ids must be lowercase slugs");

export type ProviderId = z.infer<typeof providerIdSchema>;

/**
 * Homebase-owned ids. These are opaque to clients; only the Host produces and
 * resolves them. Clients must never treat them as filesystem paths.
 */
export const projectIdSchema = z.string().min(1).max(200);
export const sessionIdSchema = z.string().min(1).max(200);
export const messageIdSchema = z.string().min(1).max(200);
export const partIdSchema = z.string().min(1).max(200);
export const toolCallIdSchema = z.string().min(1).max(200);
export const requestIdSchema = z.string().min(1).max(200);
export const attachmentIdSchema = z.string().min(1).max(200);
export const eventIdSchema = z.string().min(1).max(200);
export const modelIdSchema = z.string().min(1).max(200);
export const modeIdSchema = z.string().min(1).max(200);
export const thinkingLevelIdSchema = z.string().min(1).max(200);

export type ProjectId = z.infer<typeof projectIdSchema>;
export type SessionId = z.infer<typeof sessionIdSchema>;
export type MessageId = z.infer<typeof messageIdSchema>;
export type PartId = z.infer<typeof partIdSchema>;
export type ToolCallId = z.infer<typeof toolCallIdSchema>;
export type RequestId = z.infer<typeof requestIdSchema>;
export type AttachmentId = z.infer<typeof attachmentIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
export type ModelId = z.infer<typeof modelIdSchema>;
