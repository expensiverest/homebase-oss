import { z } from "zod";
import { agentProjectSchema, timestampSchema } from "./entities.js";
import { projectIdSchema } from "./ids.js";

export const projectRootSchema = z.object({
  id: z.string().regex(/^root_[a-f0-9]{12}$/),
  name: z.string(),
  path: z.string(),
  available: z.boolean(),
  projectCount: z.number().int().nonnegative(),
  lastActivityAt: timestampSchema.nullable(),
});
export type ProjectRoot = z.infer<typeof projectRootSchema>;
export const projectSummarySchema = agentProjectSchema.extend({
  rootId: projectRootSchema.shape.id,
  lastActivityAt: timestampSchema.nullable(),
  // Counts describe the Host's known session index, not a full provider census.
  knownSessionCount: z.number().int().nonnegative(),
  workingCount: z.number().int().nonnegative(),
  waitingCount: z.number().int().nonnegative(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export const projectOverviewSchema = z.object({
  recent: z.array(projectSummarySchema),
  roots: z.array(projectRootSchema),
});
export type ProjectOverview = z.infer<typeof projectOverviewSchema>;

export const projectFileEntrySchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  kind: z.enum(["file", "directory", "symlink", "other"]),
  sizeBytes: z.number().int().nonnegative().nullable(),
  modifiedAt: timestampSchema.nullable(),
  accessible: z.boolean(),
});
export type ProjectFileEntry = z.infer<typeof projectFileEntrySchema>;
export const projectDirectoryListingSchema = z.object({
  projectId: projectIdSchema,
  relativePath: z.string(),
  entries: z.array(projectFileEntrySchema),
  truncated: z.boolean(),
});
export type ProjectDirectoryListing = z.infer<typeof projectDirectoryListingSchema>;
export const projectFilePreviewSchema = z.object({
  projectId: projectIdSchema,
  relativePath: z.string(),
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  kind: z.enum(["text", "image", "unsupported", "too-large"]),
  language: z.string().nullable(),
  mimeType: z.string().nullable(),
  text: z.string().optional(),
});
export type ProjectFilePreview = z.infer<typeof projectFilePreviewSchema>;
