import { AdapterError } from "@homebase/adapter-sdk";
import type { AgentErrorCode } from "@homebase/protocol";

import { OpenCodeHttpError } from "./client.js";

/** Version this adapter was developed and verified against. */
export const OPENCODE_TESTED_VERSION = "2.0.18";

/** Maps HTTP status and OpenCode `_tag` values onto stable Homebase codes. */
export function errorCodeForStatus(status: number, tag?: string): AgentErrorCode {
  if (status === 0) return "provider_unavailable";
  if (status === 401 || status === 403) return "provider_not_authenticated";
  if (status === 404) return tag === "SessionNotFoundError" ? "session_not_found" : "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid_request";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "provider_error";
  return "provider_error";
}

/** Normalizes any thrown value from the client into an `AdapterError`. */
export function toAdapterError(error: unknown): AdapterError {
  if (error instanceof AdapterError) return error;
  if (error instanceof OpenCodeHttpError) {
    return new AdapterError(errorCodeForStatus(error.status, error.tag), error.message, {
      retryable: error.status === 0 || error.status >= 500,
      details: error.tag ? { tag: error.tag } : undefined,
    });
  }
  const message = error instanceof Error && error.message.length > 0 ? error.message : "OpenCode request failed.";
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

/**
 * Compatibility policy: 2.x is supported; anything newer than the tested
 * version warns instead of failing unless we know it broke the API.
 */
export function versionCompatibility(version: string | null): VersionCompatibility {
  if (!version) {
    return { compatible: true, warning: "OpenCode did not report its version." };
  }
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major)) {
    return { compatible: true, warning: `Unrecognized OpenCode version "${version}".` };
  }
  if (major < 2) {
    return { compatible: false, warning: `OpenCode ${version} predates the supported 2.x server API.` };
  }
  if (compareVersions(version, OPENCODE_TESTED_VERSION) > 0) {
    return {
      compatible: true,
      warning: `OpenCode ${version} is newer than the tested ${OPENCODE_TESTED_VERSION}.`,
    };
  }
  return { compatible: true };
}
