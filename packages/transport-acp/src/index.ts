/**
 * @homebase/transport-acp
 *
 * A provider-neutral Agent Client Protocol (ACP) v1 stdio transport built on
 * the official `@agentclientprotocol/sdk`. It owns local process lifecycle,
 * capability negotiation, request correlation/timeouts, and minimal client
 * callbacks. It knows nothing about any specific provider: adapters own
 * ACP-to-Homebase normalization.
 */
export * from "./errors.js";
export * from "./logger.js";
export * from "./process.js";
export * from "./transport.js";
