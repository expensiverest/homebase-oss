import type { AdapterRegistration } from "@homebase/adapter-sdk";

import { ClaudeAdapter, type ClaudeAdapterOptions } from "./adapter.js";

export { ClaudeAdapter, type ClaudeAdapterOptions } from "./adapter.js";
export { claudeConfigSchema, parseClaudeConfig, type ClaudeConfig } from "./config.js";
export { CLAUDE_TESTED_VERSION } from "./errors.js";
export { encodeProjectDir, resolveClaudeConfigDir } from "./history/transcripts.js";
export { CLAUDE_MODES, cliMode, isSafeMode, normalizeMode } from "./modes.js";

/** Host registration for the Claude Code adapter. */
export const claudeRegistration: AdapterRegistration = {
  id: "claude",
  displayName: "Claude Code",
  create: (config) => new ClaudeAdapter({ config }),
};

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): ClaudeAdapter {
  return new ClaudeAdapter(options);
}
