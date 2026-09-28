import { AdapterError, isAdapterError } from "@homebase/adapter-sdk";
import { isAgentErrorCode, type AgentErrorCode, type ApiErrorBody, type JsonValue } from "@homebase/protocol";

/** HTTP status for each stable error code. */
const STATUS_BY_CODE: Record<AgentErrorCode, number> = {
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,

  project_not_found: 404,
  project_not_allowed: 403,
  project_unavailable: 409,

  provider_not_found: 404,
  provider_unavailable: 503,
  provider_not_installed: 503,
  provider_not_authenticated: 503,
  provider_incompatible: 503,
  provider_error: 502,

  session_not_found: 404,
  session_not_active: 409,
  session_already_exists: 409,

  unsupported_capability: 409,
  invalid_attachment: 400,

  timeout: 504,
  aborted: 409,
  internal: 500,
  unknown: 500,
};

export function httpStatusForCode(code: AgentErrorCode): number {
  return STATUS_BY_CODE[code];
}

export interface HostErrorOptions {
  status?: number;
  details?: Record<string, JsonValue>;
  cause?: unknown;
}

/** Application error with a stable code and an HTTP status. */
export class HostError extends Error {
  readonly code: AgentErrorCode;
  readonly status: number;
  readonly details: Record<string, JsonValue> | undefined;

  constructor(code: AgentErrorCode, message: string, options: HostErrorOptions = {}) {
    super(message);
    this.name = "HostError";
    this.code = code;
    this.status = options.status ?? httpStatusForCode(code);
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Maps any thrown value to a HostError without leaking unrelated internals.
 * Unrecognized errors become `internal` and are logged separately.
 */
export function normalizeError(error: unknown): HostError {
  if (error instanceof HostError) return error;

  if (isAdapterError(error)) {
    return new HostError(error.code, error.message, { details: error.details });
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const candidate = error as { code: unknown; message?: unknown };
    if (typeof candidate.code === "string" && isAgentErrorCode(candidate.code)) {
      const message = typeof candidate.message === "string" ? candidate.message : "The provider reported an error.";
      return new HostError(candidate.code, message);
    }
  }

  return new HostError("internal", "An unexpected error occurred.");
}

/** Builds the stable JSON error body used by every API failure. */
export function errorBody(error: HostError, requestId?: string): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details ?? null,
      requestId: requestId ?? null,
    },
  };
}

export { AdapterError };
