/** Errors raised by the ACP transport. Provider adapters translate these. */
export type AcpTransportErrorCode =
  "not_started" | "spawn_failed" | "startup_timeout" | "process_exited" | "timeout" | "protocol" | "closed" | "request";

export class AcpTransportError extends Error {
  readonly code: AcpTransportErrorCode;
  /** JSON-RPC error code when the failure came from the peer. */
  readonly jsonRpcCode: number | undefined;

  constructor(code: AcpTransportErrorCode, message: string, options: { cause?: unknown; jsonRpcCode?: number } = {}) {
    super(message);
    this.name = "AcpTransportError";
    this.code = code;
    this.jsonRpcCode = options.jsonRpcCode;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function isAcpTransportError(value: unknown): value is AcpTransportError {
  return value instanceof AcpTransportError;
}
