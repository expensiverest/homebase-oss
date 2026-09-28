import { z } from "zod";

/**
 * The capability model is the contract between providers and every shared
 * surface (Host logic and PWA alike). Shared code must branch on capabilities,
 * never on provider identity.
 *
 * A capability must only be declared `true` when the adapter can fulfill it end
 * to end. Unsupported features stay unsupported; do not fake parity.
 */
export const agentCapabilitiesSchema = z.object({
  /** The adapter can re-open a previously persisted provider session. */
  resume: z.boolean(),
  /** The adapter can delete a provider session. */
  deleteSession: z.boolean(),

  /** Incremental output is delivered while a turn is running. */
  streaming: z.boolean(),
  /** A running turn can be stopped. */
  interrupt: z.boolean(),
  /** A message can be delivered to a turn that is already running. */
  steer: z.boolean(),
  /** Messages can be queued until the current turn finishes. */
  queue: z.boolean(),

  /** The adapter can enumerate models. */
  models: z.boolean(),
  /** The active model can be changed for an existing session. */
  modelSwitching: z.boolean(),
  /** Models expose thinking/effort levels that can be selected. */
  thinkingLevels: z.boolean(),
  /** The adapter exposes selectable modes (for example plan/agent modes). */
  modes: z.boolean(),

  /** The adapter accepts file attachments. */
  attachments: z.boolean(),
  /** The adapter accepts image input. */
  imageInput: z.boolean(),

  /** Tool calls are surfaced as structured content. */
  tools: z.boolean(),
  /** The provider can request user approval for an action. */
  approvals: z.boolean(),
  /** The provider can ask the user structured questions. */
  questions: z.boolean(),
  /** The provider produces plans that can be rendered. */
  plans: z.boolean(),

  /** The adapter can produce a diff for a session. */
  diffs: z.boolean(),
  /** The adapter can report usage windows through a supported interface. */
  usage: z.boolean(),
  /** The provider exposes slash commands that Homebase can surface. */
  slashCommands: z.boolean(),
});

export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;

export type CapabilityKey = keyof AgentCapabilities;

export const capabilityKeys = Object.keys(agentCapabilitiesSchema.shape) as CapabilityKey[];

/** Baseline with every capability explicitly disabled. Adapters opt in. */
export const noCapabilities: AgentCapabilities = Object.freeze({
  resume: false,
  deleteSession: false,
  streaming: false,
  interrupt: false,
  steer: false,
  queue: false,
  models: false,
  modelSwitching: false,
  thinkingLevels: false,
  modes: false,
  attachments: false,
  imageInput: false,
  tools: false,
  approvals: false,
  questions: false,
  plans: false,
  diffs: false,
  usage: false,
  slashCommands: false,
});

/**
 * Builds a complete capability record from the capabilities an adapter
 * supports. Everything omitted is explicitly unsupported.
 */
export function defineCapabilities(supported: Partial<AgentCapabilities>): AgentCapabilities {
  return { ...noCapabilities, ...supported };
}

/**
 * Convenience check for shared code. Prefer `supports(capabilities, key)` over
 * provider identity checks in the Host and the web client.
 */
export function supports(capabilities: AgentCapabilities, key: CapabilityKey): boolean {
  return capabilities[key];
}

/** Names of the capabilities that are enabled. Useful for diagnostics and UI. */
export function enabledCapabilities(capabilities: AgentCapabilities): CapabilityKey[] {
  return capabilityKeys.filter((key) => capabilities[key]);
}
