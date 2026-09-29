import type { AdapterRegistration } from "@homebase/adapter-sdk";

import { GROK_PROVIDER_ID, GrokAdapter } from "./adapter.js";

export { GROK_PROVIDER_ID, GrokAdapter, type GrokAdapterOptions } from "./adapter.js";
export { GROK_TESTED_VERSION, parseGrokVersion, versionCompatibility } from "./errors.js";
export { grokArguments, parseGrokConfig, type GrokConfig } from "./config.js";

/** Registers Grok Build with the Host. Absence degrades to installed: false. */
export const grokRegistration: AdapterRegistration = {
  id: GROK_PROVIDER_ID,
  displayName: "Grok",
  create: (config) => new GrokAdapter({ config }),
};
