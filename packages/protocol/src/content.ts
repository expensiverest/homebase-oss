import { z } from "zod";

import { attachmentIdSchema, partIdSchema, providerIdSchema, sessionIdSchema, toolCallIdSchema } from "./ids.js";
import { agentSessionSchema, timestampSchema } from "./entities.js";

/** JSON-safe values. Provider payloads must be normalized before they get here. */
export const jsonValueSchema = z.json();
export type JsonValue = z.infer<typeof jsonValueSchema>;

export const agentAttachmentRefSchema = z.object({
  id: attachmentIdSchema,
  kind: z.enum(["image", "file"]),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
});
export type AgentAttachmentRef = z.infer<typeof agentAttachmentRefSchema>;

export const messageRoleSchema = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageStateSchema = z.enum(["streaming", "completed", "failed", "interrupted"]);
export type MessageState = z.infer<typeof messageStateSchema>;

export const toolCallStatusSchema = z.enum(["running", "completed", "failed", "denied"]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const agentToolCallSchema = z.object({
  id: toolCallIdSchema,
  name: z.string(),
  status: toolCallStatusSchema,
  title: z.string().nullable().optional(),
  input: jsonValueSchema.nullable().optional(),
  output: jsonValueSchema.nullable().optional(),
  error: z.string().nullable().optional(),
  startedAt: timestampSchema.nullable().optional(),
  completedAt: timestampSchema.nullable().optional(),
});
export type AgentToolCall = z.infer<typeof agentToolCallSchema>;

export const planStepStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type PlanStepStatus = z.infer<typeof planStepStatusSchema>;

export const agentPlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: planStepStatusSchema,
  detail: z.string().nullable().optional(),
});
export type AgentPlanStep = z.infer<typeof agentPlanStepSchema>;

export const agentPlanSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable().optional(),
  steps: z.array(agentPlanStepSchema),
  updatedAt: timestampSchema,
});
export type AgentPlan = z.infer<typeof agentPlanSchema>;

/**
 * Structured message content. Every part has a stable `id` so streaming
 * deltas (`message.delta`, `reasoning.delta`) can address a part directly.
 */
export const agentContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), id: partIdSchema, text: z.string() }),
  z.object({ type: z.literal("reasoning"), id: partIdSchema, text: z.string() }),
  z.object({
    type: z.literal("image"),
    id: partIdSchema,
    attachmentId: attachmentIdSchema.optional(),
    mimeType: z.string(),
    name: z.string().nullable().optional(),
    alt: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("file"),
    id: partIdSchema,
    attachmentId: attachmentIdSchema.optional(),
    name: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative().nullable().optional(),
  }),
  z.object({ type: z.literal("tool_call"), id: partIdSchema, toolCall: agentToolCallSchema }),
  z.object({ type: z.literal("plan"), id: partIdSchema, plan: agentPlanSchema }),
  z.object({
    type: z.literal("status"),
    id: partIdSchema,
    label: z.string(),
    detail: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("error"),
    id: partIdSchema,
    message: z.string(),
    code: z.string().nullable().optional(),
  }),
]);
export type AgentContentPart = z.infer<typeof agentContentPartSchema>;
export type AgentContentPartType = AgentContentPart["type"];

export const agentMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: sessionIdSchema,
  role: messageRoleSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema.nullable().optional(),
  state: messageStateSchema,
  parts: z.array(agentContentPartSchema),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const approvalOptionKindSchema = z.enum(["allow_once", "allow_always", "deny", "custom"]);
export type ApprovalOptionKind = z.infer<typeof approvalOptionKindSchema>;

export const agentApprovalOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  kind: approvalOptionKindSchema,
  description: z.string().nullable().optional(),
});
export type AgentApprovalOption = z.infer<typeof agentApprovalOptionSchema>;

export const agentApprovalRequestSchema = z.object({
  id: z.string().min(1),
  sessionId: sessionIdSchema,
  provider: providerIdSchema,
  createdAt: timestampSchema,
  kind: z.enum(["tool", "command", "file", "plan", "other"]),
  title: z.string(),
  detail: z.string().nullable().optional(),
  toolCallId: z.string().nullable().optional(),
  options: z.array(agentApprovalOptionSchema).min(1),
  expiresAt: timestampSchema.nullable().optional(),
});
export type AgentApprovalRequest = z.infer<typeof agentApprovalRequestSchema>;

export const agentApprovalResolutionSchema = z.object({
  requestId: z.string().min(1),
  optionId: z.string().min(1),
  resolvedAt: timestampSchema,
  resolvedBy: z.enum(["user", "auto", "system", "timeout", "provider"]).optional(),
});
export type AgentApprovalResolution = z.infer<typeof agentApprovalResolutionSchema>;

export const questionKindSchema = z.enum(["single_select", "multi_select", "text", "confirm"]);
export type QuestionKind = z.infer<typeof questionKindSchema>;

export const agentQuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  description: z.string().nullable().optional(),
});
export type AgentQuestionOption = z.infer<typeof agentQuestionOptionSchema>;

export const agentQuestionSchema = z.object({
  id: z.string().min(1),
  header: z.string().nullable().optional(),
  question: z.string(),
  kind: questionKindSchema,
  options: z.array(agentQuestionOptionSchema).optional(),
  required: z.boolean().optional(),
  allowFreeform: z.boolean().optional(),
});
export type AgentQuestion = z.infer<typeof agentQuestionSchema>;

export const agentQuestionRequestSchema = z.object({
  id: z.string().min(1),
  sessionId: sessionIdSchema,
  provider: providerIdSchema,
  createdAt: timestampSchema,
  title: z.string().nullable().optional(),
  questions: z.array(agentQuestionSchema).min(1),
});
export type AgentQuestionRequest = z.infer<typeof agentQuestionRequestSchema>;

export const agentQuestionAnswerItemSchema = z.object({
  questionId: z.string().min(1),
  selectedOptionIds: z.array(z.string().min(1)).optional(),
  text: z.string().nullable().optional(),
  confirmed: z.boolean().nullable().optional(),
});
export type AgentQuestionAnswerItem = z.infer<typeof agentQuestionAnswerItemSchema>;

export const agentQuestionResolutionSchema = z.object({
  requestId: z.string().min(1),
  answers: z.array(agentQuestionAnswerItemSchema),
  resolvedAt: timestampSchema,
});
export type AgentQuestionResolution = z.infer<typeof agentQuestionResolutionSchema>;

export const diffFileStatusSchema = z.enum(["added", "modified", "deleted", "renamed", "copied", "unknown"]);
export type DiffFileStatus = z.infer<typeof diffFileStatusSchema>;

export const agentDiffFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable().optional(),
  status: diffFileStatusSchema,
  additions: z.number().int().nonnegative().nullable().optional(),
  deletions: z.number().int().nonnegative().nullable().optional(),
  patch: z.string().nullable().optional(),
  binary: z.boolean().optional(),
});
export type AgentDiffFile = z.infer<typeof agentDiffFileSchema>;

export const agentDiffSchema = z.object({
  provider: providerIdSchema,
  projectId: z.string().nullable().optional(),
  sessionId: sessionIdSchema.nullable().optional(),
  files: z.array(agentDiffFileSchema),
  truncated: z.boolean().optional(),
});
export type AgentDiff = z.infer<typeof agentDiffSchema>;

export const agentDiffSummarySchema = z.object({
  provider: providerIdSchema,
  sessionId: sessionIdSchema.nullable().optional(),
  files: z.array(
    z.object({
      path: z.string(),
      status: diffFileStatusSchema,
      additions: z.number().int().nonnegative().nullable().optional(),
      deletions: z.number().int().nonnegative().nullable().optional(),
    }),
  ),
  updatedAt: timestampSchema,
});
export type AgentDiffSummary = z.infer<typeof agentDiffSummarySchema>;

export const usageUnitSchema = z.enum(["percent", "tokens", "requests", "usd", "minutes"]);
export type UsageUnit = z.infer<typeof usageUnitSchema>;

export const agentUsageWindowSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  unit: usageUnitSchema,
  usedPercent: z.number().min(0).max(100).nullable().optional(),
  used: z.number().nonnegative().nullable().optional(),
  limit: z.number().nonnegative().nullable().optional(),
  resetsAt: timestampSchema.nullable().optional(),
  windowSeconds: z.number().int().positive().nullable().optional(),
});
export type AgentUsageWindow = z.infer<typeof agentUsageWindowSchema>;

export const agentUsageSchema = z.object({
  provider: providerIdSchema,
  planName: z.string().nullable().optional(),
  windows: z.array(agentUsageWindowSchema),
  fetchedAt: timestampSchema,
});
export type AgentUsage = z.infer<typeof agentUsageSchema>;

/** Re-exported for convenience: sessions are commonly embedded in event data. */
export { agentSessionSchema };
