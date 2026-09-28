import type { AgentMode } from "@homebase/protocol";

/**
 * Homebase-safe Claude permission modes.
 *
 * `bypassPermissions` (unrestricted shell) and `dontAsk` (deny everything that
 * would prompt, which disables Homebase's approval UI entirely) are excluded
 * deliberately and can never be selected through Homebase.
 */
export const CLAUDE_MODES: AgentMode[] = [
  { id: "default", name: "Ask", description: "Ask before risky tool calls (CLI: manual)." },
  { id: "acceptEdits", name: "Auto-edit", description: "Apply file edits without asking." },
  { id: "plan", name: "Plan", description: "Explore and propose; make no changes." },
  { id: "auto", name: "Auto", description: "Let Claude's classifier approve most actions." },
];

const MODE_TO_CLI: Record<string, string> = {
  default: "manual",
  acceptEdits: "acceptEdits",
  plan: "plan",
  auto: "auto",
};

const UNSAFE_MODES = new Set(["bypassPermissions", "dontAsk"]);

/** Homebase mode id to the CLI flag value; null for unknown or unsafe modes. */
export function cliMode(mode: string): string | null {
  if (UNSAFE_MODES.has(mode)) return null;
  return MODE_TO_CLI[mode] ?? null;
}

/** CLI-reported mode to the Homebase mode id (`manual`/`default` normalize). */
export function normalizeMode(cliValue: string | null | undefined): string {
  if (cliValue === "manual" || cliValue === "default" || !cliValue) return "default";
  if (cliValue === "acceptEdits" || cliValue === "plan" || cliValue === "auto") return cliValue;
  return "default";
}

export function isSafeMode(mode: string): boolean {
  return cliMode(mode) !== null;
}
