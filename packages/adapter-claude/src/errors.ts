import { AdapterError } from "@homebase/adapter-sdk";
import type { AgentErrorCode } from "@homebase/protocol";

/** Claude Code version this adapter was developed and verified against. */
export const CLAUDE_TESTED_VERSION = "2.1.268";

/** Error thrown by the process controller and detection helpers. */
export class ClaudeProcessError extends Error {
  readonly code: AgentErrorCode;

  constructor(code: AgentErrorCode, message: string) {
    super(message);
    this.name = "ClaudeProcessError";
    this.code = code;
  }
}

export function toAdapterError(error: unknown): AdapterError {
  if (error instanceof AdapterError) return error;
  if (error instanceof ClaudeProcessError) {
    return new AdapterError(error.code, error.message, { retryable: error.code === "provider_unavailable" });
  }
  const message = error instanceof Error && error.message.length > 0 ? error.message : "Claude Code request failed.";
  return new AdapterError("provider_error", message);
}

export interface VersionCompatibility {
  compatible: boolean;
  warning?: string;
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Parses `2.1.268 (Claude Code)` into `2.1.268`. */
export function parseClaudeVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+)/.exec(output);
  return match?.[1] ?? null;
}

/**
 * Compatibility policy: 2.x is supported; newer than tested warns instead of
 * failing so auto-updated CLIs keep working unless we know the API broke.
 */
export function versionCompatibility(version: string | null): VersionCompatibility {
  if (!version) return { compatible: true, warning: "Claude Code did not report its version." };
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major)) return { compatible: true, warning: `Unrecognized Claude Code version "${version}".` };
  if (major < 2)
    return { compatible: false, warning: `Claude Code ${version} predates the structured 2.x CLI interface.` };
  if (compareVersions(version, CLAUDE_TESTED_VERSION) > 0) {
    return { compatible: true, warning: `Claude Code ${version} is newer than the tested ${CLAUDE_TESTED_VERSION}.` };
  }
  return { compatible: true };
}
