import { AdapterError } from "@homebase/adapter-sdk";
import { z } from "zod";

/**
 * Claude adapter configuration (`providers.claude.config`).
 *
 * Homebase drives the user's already-installed `claude` CLI; there is no API
 * key, OAuth token, email, or org id in this configuration by design.
 */
export const claudeConfigSchema = z.object({
  /** Executable name or absolute path; defaults to `claude` on PATH. */
  executable: z.string().min(1).max(1_000).default("claude"),
  /** Kill the idle child process after this long; the next prompt resumes it. */
  idleTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(24 * 60 * 60 * 1_000)
    .default(10 * 60 * 1_000),
  /** How long to wait for the init frame after spawning. */
  startupTimeoutMs: z.number().int().min(1_000).max(120_000).default(20_000),
  /** How long to wait for a control_request response (interrupt/model/mode). */
  controlTimeoutMs: z.number().int().min(500).max(60_000).default(10_000),
  /** How long a pending approval may wait for the operator before it is denied. */
  approvalTimeoutMs: z
    .number()
    .int()
    .min(1_000)
    .max(24 * 60 * 60 * 1_000)
    .default(60 * 60 * 1_000),
  /** Override the Claude config directory used for transcripts (tests). */
  configDir: z.string().min(1).max(1_000).optional(),
});

export type ClaudeConfig = z.infer<typeof claudeConfigSchema>;

export function parseClaudeConfig(raw: Readonly<Record<string, unknown>>): ClaudeConfig {
  const result = claudeConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new AdapterError("invalid_request", "Invalid claude provider configuration.", {
      details: {
        issues: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      },
    });
  }
  return result.data;
}
