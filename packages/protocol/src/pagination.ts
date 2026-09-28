import { z } from "zod";

/**
 * Provider-neutral pagination.
 *
 * Cursors are opaque strings owned by the adapter. Clients must round-trip them
 * without interpreting their contents. `items` keep the provider order across
 * pages; list operations default to newest-first unless documented otherwise.
 */
export const pageRequestSchema = z.object({
  cursor: z.string().min(1).max(65_536).nullable().optional(),
  limit: z.number().int().min(1).max(500).nullable().optional(),
});
export type PageRequest = z.infer<typeof pageRequestSchema>;

export interface AgentPage<T> {
  items: T[];
  /** Cursor for the next page in provider order, or null when exhausted. */
  nextCursor: string | null;
  /** Cursor for the previous page, or null when at the start. */
  previousCursor: string | null;
}

export function toAgentPage<T>(
  items: T[],
  cursor: { next?: string | null; previous?: string | null } | null | undefined = undefined,
): AgentPage<T> {
  return {
    items,
    nextCursor: cursor?.next ?? null,
    previousCursor: cursor?.previous ?? null,
  };
}

/** Builds a Zod schema for a page of a given item schema. */
export function agentPageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    previousCursor: z.string().nullable(),
  });
}
