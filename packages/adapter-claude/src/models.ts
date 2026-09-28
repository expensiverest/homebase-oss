import type { AgentModel } from "@homebase/protocol";

export const CLAUDE_PROVIDER_ID = "claude";

/** Shape of one entry in the `initialize` control response `models` array. */
export interface NativeModelInfo {
  value?: string;
  resolvedModel?: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsAdaptiveThinking?: boolean;
  supportsAutoMode?: boolean;
  supportsFastMode?: boolean;
}

const EFFORT_NAMES: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultracode: "Ultracode",
};

function displayNameFor(value: string): string {
  if (value === "default") return "Default (Claude Code)";
  if (/^[a-z]+$/.test(value)) return `Claude ${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  return value;
}

/**
 * Maps one CLI-advertised model. Effort availability comes from the running
 * CLI itself (`supportedEffortLevels`), so the picker never offers levels a
 * model rejects. Context/output limits are omitted rather than invented.
 */
export function toAgentModel(info: NativeModelInfo): AgentModel {
  const value = info.value?.trim();
  const id = value && value.length > 0 ? value : (info.resolvedModel?.trim() ?? "default");
  const effortLevels = info.supportsEffort === true ? (info.supportedEffortLevels ?? []) : [];
  return {
    id,
    provider: CLAUDE_PROVIDER_ID,
    name: info.displayName?.trim() || displayNameFor(id),
    description: info.description ?? null,
    thinkingLevels:
      effortLevels.length > 0
        ? effortLevels.map((level) => ({ id: level, name: EFFORT_NAMES[level] ?? level }))
        : undefined,
    inputCapabilities: { text: true, image: true, file: false },
  };
}

/**
 * Fallback catalog used only when the CLI cannot be asked (unavailable at
 * list time). Effort lists mirror current documentation and are intentionally
 * conservative; the live `initialize` response wins whenever available.
 */
export const CLAUDE_FALLBACK_MODELS: AgentModel[] = [
  {
    id: "default",
    provider: CLAUDE_PROVIDER_ID,
    name: "Default (Claude Code)",
    inputCapabilities: { text: true, image: true, file: false },
  },
  {
    id: "sonnet",
    provider: CLAUDE_PROVIDER_ID,
    name: "Claude Sonnet",
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id, name: EFFORT_NAMES[id] ?? id })),
    inputCapabilities: { text: true, image: true, file: false },
  },
  {
    id: "opus",
    provider: CLAUDE_PROVIDER_ID,
    name: "Claude Opus",
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id, name: EFFORT_NAMES[id] ?? id })),
    inputCapabilities: { text: true, image: true, file: false },
  },
  {
    id: "haiku",
    provider: CLAUDE_PROVIDER_ID,
    name: "Claude Haiku",
    inputCapabilities: { text: true, image: true, file: false },
  },
  {
    id: "fable",
    provider: CLAUDE_PROVIDER_ID,
    name: "Claude Fable",
    thinkingLevels: ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id, name: EFFORT_NAMES[id] ?? id })),
    inputCapabilities: { text: true, image: true, file: false },
  },
];
