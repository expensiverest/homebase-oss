import { AdapterError } from "@homebase/adapter-sdk";
import type { AgentErrorCode } from "@homebase/protocol";
import { isAcpTransportError } from "@homebase/transport-acp";

/** Version this adapter was developed and verified against (documented). */
export const GROK_TESTED_VERSION = "1.0.41";

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

/** Extracts a semantic version from `grok --version` output. */
export function parseGrokVersion(output: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(output);
  return match?.[1] ?? null;
}

/**
 * Compatibility policy: the ACP v1 surface is the integration contract, so any
 * 1.x release is accepted; newer-than-tested releases warn instead of failing.
 */
export function versionCompatibility(version: string | null): VersionCompatibility {
  if (!version) return { compatible: true, warning: "Grok did not report its version." };
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major)) {
    return { compatible: true, warning: `Unrecognized Grok version "${version}".` };
  }
  if (major < 1) {
    return { compatible: false, warning: `Grok ${version} predates the supported ACP v1 surface.` };
  }
  if (compareVersions(version, GROK_TESTED_VERSION) > 0) {
    return { compatible: true, warning: `Grok ${version} is newer than the tested ${GROK_TESTED_VERSION}.` };
  }
  return { compatible: true };
}

/** Maps a transport failure onto stable Homebase error codes. */
export function toAdapterError(error: unknown): AdapterError {
  if (error instanceof AdapterError) return error;
  if (isAcpTransportError(error)) {
    const code: AgentErrorCode =
      error.code === "timeout" || error.code === "startup_timeout"
        ? "timeout"
        : error.code === "process_exited" || error.code === "closed"
          ? "provider_unavailable"
          : error.code === "spawn_failed" || error.code === "not_started"
            ? "provider_not_installed"
            : "provider_error";
    return new AdapterError(code, error.message, { cause: error });
  }
  const message = error instanceof Error && error.message.length > 0 ? error.message : "Grok request failed.";
  return new AdapterError("provider_error", message, { cause: error });
}
