/**
 * Minimal logging surface owned by the transport package so `transport-acp`
 * does not depend on Homebase adapter/logger packages. Adapters pass their own
 * logger; every message here is a fixed diagnostic string that never includes
 * credentials or raw stderr.
 */
export interface AcpTransportLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export const noopAcpTransportLogger: AcpTransportLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
