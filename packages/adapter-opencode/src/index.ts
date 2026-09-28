import type { AdapterRegistration } from "@homebase/adapter-sdk";

import { OpenCodeAdapter, type OpenCodeAdapterOptions } from "./adapter.js";

export { OpenCodeAdapter, type OpenCodeAdapterOptions } from "./adapter.js";
export { opencodeConfigSchema, parseOpenCodeConfig, type OpenCodeConfig } from "./config.js";
export { OPENCODE_TESTED_VERSION } from "./errors.js";

/** Host registration for the OpenCode reference adapter. */
export const opencodeRegistration: AdapterRegistration = {
  id: "opencode",
  displayName: "OpenCode",
  create: (config) => new OpenCodeAdapter({ config }),
};

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): OpenCodeAdapter {
  return new OpenCodeAdapter(options);
}
