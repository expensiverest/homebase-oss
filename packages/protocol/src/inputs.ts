import { z } from "zod";

import { agentAttachmentRefSchema } from "./content.js";
import { agentModelRefSchema } from "./entities.js";
import { modeIdSchema, projectIdSchema, providerIdSchema, thinkingLevelIdSchema } from "./ids.js";

/**
 * Inputs the Host accepts from the web client. These objects are strict: any
 * unknown field is rejected by validation.
 *
 * Note there is deliberately no `path`, `cwd`, or `directory` field anywhere.
 * Working directories are resolved by the Host from its own project registry;
 * the browser cannot name a filesystem location.
 */
export const createSessionInputSchema = z.strictObject({
  provider: providerIdSchema,
  projectId: projectIdSchema,
  title: z.string().max(500).nullable().optional(),
  model: agentModelRefSchema.nullable().optional(),
  mode: modeIdSchema.nullable().optional(),
  thinkingLevel: thinkingLevelIdSchema.nullable().optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

export const sendMessageInputSchema = z.strictObject({
  text: z.string().min(1).max(200_000),
  attachments: z.array(agentAttachmentRefSchema).max(20).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const approvalResultSchema = z.strictObject({
  optionId: z.string().min(1).max(200),
  note: z.string().max(2_000).nullable().optional(),
});
export type ApprovalResult = z.infer<typeof approvalResultSchema>;

export const questionAnswerItemSchema = z.strictObject({
  questionId: z.string().min(1).max(200),
  selectedOptionIds: z.array(z.string().min(1).max(200)).max(50).optional(),
  text: z.string().max(20_000).nullable().optional(),
  confirmed: z.boolean().nullable().optional(),
});

export const questionAnswerSchema = z.strictObject({
  answers: z.array(questionAnswerItemSchema).min(1).max(50),
});
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>;

export const setModelInputSchema = z.strictObject({
  modelId: z.string().min(1).max(200),
  thinkingLevel: thinkingLevelIdSchema.nullable().optional(),
});
export type SetModelInput = z.infer<typeof setModelInputSchema>;

export const setModeInputSchema = z.strictObject({
  mode: modeIdSchema,
});
export type SetModeInput = z.infer<typeof setModeInputSchema>;
