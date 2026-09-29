import { AdapterError } from "@homebase/adapter-sdk";
import { z } from "zod";

/**
 * Grok adapter configuration lives under `providers.grok.config`.
 *
 * Homebase accepts no xAI credentials of any kind: Grok owns its own
 * authentication (`grok login` or `XAI_API_KEY` in the inherited environment).
 */
export const grokConfigSchema = z
  .object({
    /** Grok CLI executable. */
    executable: z.string().min(1).max(500).default("grok"),
    /** Spawn + ACP initialize deadline. */
    startupTimeoutMs: z.number().int().min(1_000).max(120_000).default(20_000),
    /** Timeout for ACP control calls (never applied to an active prompt). */
    controlTimeoutMs: z.number().int().min(250).max(120_000).default(10_000),
    /** Graceful shutdown deadline for the Grok process. */
    shutdownTimeoutMs: z.number().int().min(250).max(30_000).default(3_000),
    /** Bounded stderr tail kept for local diagnostics. */
    stderrLimitBytes: z.number().int().min(1_024).max(1_048_576).default(65_536),
  })
  .strict();

export type GrokConfig = z.infer<typeof grokConfigSchema>;

export function parseGrokConfig(raw: Readonly<Record<string, unknown>>): GrokConfig {
  const result = grokConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new AdapterError("invalid_request", "Invalid grok provider configuration.", {
      details: {
        issues: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      },
    });
  }
  return result.data;
}

/**
 * Documented Grok ACP entry point. `--no-auto-update` is a top-level flag and
 * must precede the `agent` subcommand. Homebase never passes approval-bypass
 * flags: permission prompts must reach the user.
 */
export function grokArguments(): string[] {
  return ["--no-auto-update", "agent", "stdio"];
}

/** Environment for the Grok child. Credentials are inherited, never copied. */
export function grokEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, GROK_DISABLE_AUTOUPDATER: "1" };
}
