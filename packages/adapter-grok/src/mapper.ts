import type {
  AgentApprovalOption,
  AgentMode,
  AgentModel,
  AgentModelRef,
  AgentPlan,
  AgentPlanStep,
  AgentToolCall,
  ProviderId,
  ToolCallStatus as HomebaseToolStatus,
} from "@homebase/protocol";
import type {
  PermissionOption,
  PlanEntry,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionModeState,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";

/**
 * Pure ACP -> Homebase normalization. Nothing in here talks to the process or
 * the Host; unknown/extension shapes are ignored rather than guessed at.
 */

/** ACP permission kinds collapse onto the neutral approval option kinds. */
export function mapPermissionOptions(options: readonly PermissionOption[]): AgentApprovalOption[] {
  return options.map((option) => {
    const kind: AgentApprovalOption["kind"] =
      option.kind === "allow_once" || option.kind === "allow_always"
        ? option.kind
        : option.kind === "reject_once" || option.kind === "reject_always"
          ? "deny"
          : "custom";
    return {
      id: option.optionId,
      label: option.name,
      kind,
    };
  });
}

/** ACP tool status -> Homebase tool status. Anything unknown is `running`. */
export function mapToolStatus(status: string | null | undefined): HomebaseToolStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function isJsonSafe(value: unknown): value is NonNullable<AgentToolCall["input"]> {
  if (value === null) return true;
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    typeof value === "object"
  );
}

/** Merges a `tool_call` / `tool_call_update` payload onto a tool call. */
export function mergeToolCall(existing: AgentToolCall | null, update: ToolCall | ToolCallUpdate): AgentToolCall {
  const toolCallId = update.toolCallId;
  const status = update.status !== undefined ? mapToolStatus(update.status) : (existing?.status ?? "running");
  const base: AgentToolCall = existing ?? {
    id: toolCallId,
    name: toolCallId,
    status: "running",
  };
  const next: AgentToolCall = {
    ...base,
    id: toolCallId,
    status,
  };
  if (update.title !== undefined && update.title !== null) next.title = update.title;
  if (update.name !== undefined && update.name !== null) next.name = update.name;
  if (update.kind !== undefined && update.kind !== null && next.name === toolCallId) next.name = update.kind;
  if (update.rawInput !== undefined && isJsonSafe(update.rawInput)) next.input = update.rawInput;
  if (update.rawOutput !== undefined && isJsonSafe(update.rawOutput)) next.output = update.rawOutput;
  if (status === "completed" || status === "failed") {
    next.completedAt = next.completedAt ?? new Date().toISOString();
  } else if (!next.startedAt) {
    next.startedAt = new Date().toISOString();
  }
  return next;
}

export function planFromEntries(planId: string, entries: readonly PlanEntry[]): AgentPlan {
  const steps: AgentPlanStep[] = entries.map((entry, index) => ({
    id: `step_${index}`,
    title: entry.content,
    status: entry.status === "completed" ? "completed" : entry.status === "in_progress" ? "in_progress" : "pending",
  }));
  return { id: planId, steps, updatedAt: new Date().toISOString() };
}

function isSelectOption(value: unknown): value is SessionConfigSelectOption {
  return !!value && typeof value === "object" && "value" in value && "name" in value;
}

/** Flattens plain and grouped select options. */
export function selectEntries(
  option: SessionConfigOption,
): Array<{ value: string; name: string; description?: string }> {
  if (option.type !== "select") return [];
  const entries: Array<{ value: string; name: string; description?: string }> = [];
  for (const candidate of option.options as unknown[]) {
    if (isSelectOption(candidate)) {
      entries.push({
        value: String(candidate.value),
        name: String(candidate.name),
        ...(typeof candidate.description === "string" ? { description: candidate.description } : {}),
      });
      continue;
    }
    if (candidate && typeof candidate === "object" && "options" in candidate && Array.isArray(candidate.options)) {
      for (const grouped of candidate.options) {
        if (!isSelectOption(grouped)) continue;
        entries.push({
          value: String(grouped.value),
          name: String(grouped.name),
          ...(typeof grouped.description === "string" ? { description: grouped.description } : {}),
        });
      }
    }
  }
  return entries;
}

export function findSelectOption(
  options: readonly SessionConfigOption[] | null | undefined,
  predicate: (option: SessionConfigOption) => boolean,
): SessionConfigOption | null {
  if (!options) return null;
  for (const option of options) {
    if (option.type === "select" && predicate(option)) return option;
  }
  return null;
}

const MODEL_PREDICATE = (option: SessionConfigOption): boolean =>
  option.category === "model" || (!option.category && option.id === "model");
export const isModelConfigOption = MODEL_PREDICATE;
const THOUGHT_PREDICATE = (option: SessionConfigOption): boolean =>
  option.category === "thought_level" || (!option.category && /reason|think|effort/i.test(option.id));
export const isThoughtLevelConfigOption = THOUGHT_PREDICATE;

export interface ConfigSelection {
  modelId: string | null;
  thinkingLevel: string | null;
}

/** Reads the current model/effort selection from a session's config options. */
export function selectionFromConfigOptions(
  options: readonly SessionConfigOption[] | null | undefined,
): ConfigSelection {
  const model = findSelectOption(options, MODEL_PREDICATE);
  const thought = findSelectOption(options, THOUGHT_PREDICATE);
  return {
    modelId: model && model.type === "select" ? String(model.currentValue) : null,
    thinkingLevel: thought && thought.type === "select" ? String(thought.currentValue) : null,
  };
}

/**
 * Builds a model catalog from a session's config options. The provider-declared
 * model selector values become Homebase model ids; a thought/reasoning level
 * selector becomes per-model thinking levels.
 */
export function modelsFromConfigOptions(
  options: readonly SessionConfigOption[] | null | undefined,
  provider: ProviderId,
): AgentModel[] {
  const model = findSelectOption(options, MODEL_PREDICATE);
  if (!model) return [];
  const thought = findSelectOption(options, THOUGHT_PREDICATE);
  const levels = thought ? selectEntries(thought).map((entry) => ({ id: entry.value, name: entry.name })) : [];
  const defaultLevel = thought && thought.type === "select" ? String(thought.currentValue) : null;
  return selectEntries(model).map((entry) => ({
    id: entry.value,
    provider,
    name: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
    ...(levels.length > 0 ? { thinkingLevels: levels } : {}),
    ...(defaultLevel ? { defaultThinkingLevel: defaultLevel } : {}),
  }));
}

/** Homebase model ref for the current session selection. */
export function modelRefFromConfigOptions(
  options: readonly SessionConfigOption[] | null | undefined,
  provider: ProviderId,
): AgentModelRef | null {
  const selection = selectionFromConfigOptions(options);
  if (!selection.modelId) return null;
  return { provider, modelId: selection.modelId, thinkingLevel: selection.thinkingLevel };
}

export function modesFromModeState(state: SessionModeState | null | undefined): AgentMode[] {
  if (!state) return [];
  return state.availableModes.map((mode) => ({
    id: mode.id,
    name: mode.name,
    ...(mode.description ? { description: mode.description } : {}),
  }));
}

export function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Best-effort model/mode catalog from `initialize` `_meta`. Provider metadata
 * is an extension surface, so every shape is validated defensively and an
 * unrecognized shape yields an empty catalog (capabilities stay false) rather
 * than guessed entries.
 */
export function catalogFromInitializeMeta(
  meta: Record<string, unknown> | null,
  provider: ProviderId,
): { models: AgentModel[]; modes: AgentMode[] } {
  const models: AgentModel[] = [];
  const modes: AgentMode[] = [];
  if (!meta) return { models, modes };
  const modelState = isRecord(meta.modelState) ? meta.modelState : null;
  const rawModels = Array.isArray(modelState?.models)
    ? modelState.models
    : Array.isArray(modelState?.availableModels)
      ? modelState.availableModels
      : Array.isArray(meta.models)
        ? meta.models
        : [];
  for (const candidate of rawModels) {
    if (!isRecord(candidate)) continue;
    const id =
      typeof candidate.id === "string"
        ? candidate.id
        : typeof candidate.modelId === "string"
          ? candidate.modelId
          : null;
    const name =
      typeof candidate.name === "string" ? candidate.name : typeof candidate.title === "string" ? candidate.title : id;
    if (!id || !name) continue;
    // Verified live Grok shape: model metadata lives under `_meta`
    // (`totalContextTokens`, `supportsReasoningEffort`, `reasoningEffort(s)`);
    // the generic shapes remain supported for other ACP agents.
    const modelMeta = isRecord(candidate._meta) ? candidate._meta : {};
    const rawLevels = Array.isArray(candidate.thinkingLevels)
      ? candidate.thinkingLevels
      : Array.isArray(candidate.effortLevels)
        ? candidate.effortLevels
        : Array.isArray(modelMeta.reasoningEfforts)
          ? modelMeta.reasoningEfforts
          : [];
    const thinkingLevels = rawLevels
      .map((level) => {
        if (typeof level === "string") return { id: level, name: level.charAt(0).toUpperCase() + level.slice(1) };
        if (isRecord(level)) {
          const levelId =
            typeof level.id === "string" ? level.id : typeof level.value === "string" ? level.value : null;
          if (!levelId) return null;
          const levelName =
            typeof level.name === "string" ? level.name : typeof level.label === "string" ? level.label : levelId;
          return {
            id: levelId,
            name: levelName,
            ...(typeof level.description === "string" ? { description: level.description } : {}),
          };
        }
        return null;
      })
      .filter((level): level is { id: string; name: string; description?: string } => level !== null);
    const defaultLevel =
      typeof candidate.defaultThinkingLevel === "string"
        ? candidate.defaultThinkingLevel
        : typeof modelMeta.reasoningEffort === "string"
          ? modelMeta.reasoningEffort
          : undefined;
    const contextWindow =
      typeof modelMeta.totalContextTokens === "number" && modelMeta.totalContextTokens > 0
        ? modelMeta.totalContextTokens
        : typeof candidate.contextWindow === "number" && candidate.contextWindow > 0
          ? candidate.contextWindow
          : undefined;
    models.push({
      id,
      provider,
      name,
      ...(typeof candidate.description === "string" ? { description: candidate.description } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(thinkingLevels.length > 0 ? { thinkingLevels } : {}),
      ...(defaultLevel !== undefined ? { defaultThinkingLevel: defaultLevel } : {}),
    });
  }

  const rawModes = Array.isArray(meta.modes)
    ? meta.modes
    : Array.isArray(meta.availableModes)
      ? meta.availableModes
      : Array.isArray(modelState?.modes)
        ? modelState.modes
        : [];
  for (const candidate of rawModes) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string") continue;
    modes.push({
      id: candidate.id,
      name: candidate.name,
      ...(typeof candidate.description === "string" ? { description: candidate.description } : {}),
    });
  }
  return { models, modes };
}
