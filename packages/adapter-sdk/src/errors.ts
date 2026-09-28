import type { AgentError, AgentErrorCode, CapabilityKey, JsonValue, ProviderId } from "@homebase/protocol";

export interface AdapterErrorOptions {
  retryable?: boolean;
  details?: Record<string, JsonValue>;
  cause?: unknown;
}

/**
 * Provider-neutral adapter failure. Adapters must throw this (or let the SDK
 * normalize unknown errors) instead of leaking native provider errors upward.
 */
export class AdapterError extends Error {
  readonly code: AgentErrorCode;
  readonly retryable: boolean | undefined;
  readonly details: Record<string, JsonValue> | undefined;

  constructor(code: AgentErrorCode, message: string, options: AdapterErrorOptions = {}) {
    super(sanitizeErrorMessage(message));
    this.name = "AdapterError";
    this.code = code;
    this.retryable = options.retryable;
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  toAgentError(provider?: ProviderId): AgentError {
    return {
      code: this.code,
      message: this.message,
      provider: provider ?? null,
      retryable: this.retryable ?? false,
      details: this.details ?? null,
    };
  }
}

/** Strips control characters and bounds error messages that go to clients. */
export function sanitizeErrorMessage(message: string, maxLength = 500): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

export function isAdapterError(value: unknown): value is AdapterError {
  return value instanceof AdapterError;
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && (value.name === "AbortError" || value.name === "TimeoutError");
}

/**
 * Normalizes any thrown value into the protocol's error shape. Unknown errors
 * become `provider_error` with a bounded, sanitized message.
 */
export function toAgentError(
  error: unknown,
  options: { provider?: ProviderId; fallbackMessage?: string } = {},
): AgentError {
  if (isAdapterError(error)) {
    return error.toAgentError(options.provider);
  }
  if (isAbortError(error)) {
    return {
      code: "aborted",
      message: options.fallbackMessage ?? "The operation was aborted.",
      provider: options.provider ?? null,
      retryable: true,
    };
  }
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? sanitizeErrorMessage(error.message)
      : (options.fallbackMessage ?? "The provider failed for an unknown reason.");
  return {
    code: "provider_error",
    message,
    provider: options.provider ?? null,
    retryable: false,
  };
}

/** Standard error for a method that the provider does not support. */
export function unsupportedCapability(capability: CapabilityKey, provider: ProviderId): AdapterError {
  return new AdapterError(
    "unsupported_capability",
    `Provider "${provider}" does not support capability "${capability}".`,
  );
}
