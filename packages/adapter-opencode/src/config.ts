import { AdapterError } from "@homebase/adapter-sdk";
import { z } from "zod";

/**
 * OpenCode adapter configuration lives under `providers.opencode.config` in the
 * Host configuration. It is validated here, never in the top-level Host schema,
 * and the password never leaves the Host process.
 */
const httpUrl = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "baseUrl must be an http(s) URL." },
  );

export const opencodeConfigSchema = z.object({
  /**
   * How the OpenCode server endpoint is obtained.
   *
   * - `auto` (default): use a healthy configured server, otherwise start a
   *   Homebase-managed dedicated `opencode serve` child when the CLI is found.
   * - `external`: never spawn OpenCode; use `baseUrl`/`username`/`password`.
   * - `managed`: require the CLI and always run a Homebase-owned server.
   */
  serverMode: z.enum(["auto", "external", "managed"]).default("auto"),
  /** OpenCode server endpoint for external mode, for example http://127.0.0.1:4096. */
  baseUrl: httpUrl.default("http://127.0.0.1:4096"),
  /** Basic-auth username; OpenCode defaults to "opencode". */
  username: z.string().min(1).max(200).default("opencode"),
  /** Basic-auth password (OPENCODE_SERVER_PASSWORD). Optional for local servers. */
  password: z.string().min(1).max(4_096).optional(),
  /** Executable used for managed mode and CLI detection. */
  executable: z.string().min(1).max(500).default("opencode"),
  /**
   * Port for the managed server. `0` lets OpenCode choose an OS-assigned
   * ephemeral port, which Homebase learns from the server's own startup line.
   */
  managedPort: z.number().int().min(0).max(65_535).default(0),
  /** How long to wait for a managed server to become reachable. */
  startupTimeoutMs: z.number().int().min(1_000).max(120_000).default(20_000),
  /** Grace period before force-killing the managed server on shutdown. */
  shutdownTimeoutMs: z.number().int().min(250).max(30_000).default(4_000),
  /** Per-request timeout for catalog/session calls. */
  requestTimeoutMs: z.number().int().min(250).max(120_000).default(15_000),
});

export type OpenCodeConfig = z.infer<typeof opencodeConfigSchema>;

export function parseOpenCodeConfig(raw: Readonly<Record<string, unknown>>): OpenCodeConfig {
  const result = opencodeConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new AdapterError("invalid_request", "Invalid opencode provider configuration.", {
      details: {
        issues: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      },
    });
  }
  return result.data;
}
