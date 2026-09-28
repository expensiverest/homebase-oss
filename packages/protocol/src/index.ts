/**
 * @homebase/protocol
 *
 * Provider-neutral entities, capabilities, content, events, and errors shared
 * by the Homebase Host, adapters, and the web client.
 *
 * Rules for this package:
 * - No provider-specific names or payload shapes (`Oc*`, ACP method names,
 *   transcript formats, CLI flags) may appear here.
 * - Provider differences are expressed through `AgentCapabilities`.
 * - Everything must be JSON-serializable.
 */
export * from "./ids.js";
export * from "./capabilities.js";
export * from "./entities.js";
export * from "./content.js";
export * from "./events.js";
export * from "./errors.js";
export * from "./inputs.js";
export * from "./pagination.js";
export * from "./version.js";
