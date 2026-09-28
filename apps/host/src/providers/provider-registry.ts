import {
  createConsoleLogger,
  toAgentError,
  type AdapterContext,
  type AdapterLogger,
  type AdapterRegistration,
  type AgentAdapter,
  type ResolvedAttachment,
} from "@homebase/adapter-sdk";
import {
  agentModeSchema,
  agentModelSchema,
  defineCapabilities,
  noCapabilities,
  nowTimestamp,
  type AgentCapabilities,
  type AgentModel,
  type AgentMode,
  type AgentProvider,
  type AgentProject,
  type AttachmentId,
  type CapabilityKey,
  type ProjectId,
  type ProviderDetection,
  type ProviderId,
} from "@homebase/protocol";

import type { HostConfig } from "../config/index.js";
import { HostError } from "../errors.js";
import type { EventBus } from "../events/index.js";

export interface ProviderRegistryOptions {
  config: HostConfig;
  bus: EventBus;
  logger: AdapterLogger;
  hostVersion: string;
  /** Canonical, allowlisted path resolver owned by the project registry. */
  resolveProjectPath: (projectId: ProjectId) => Promise<string>;
  /** Reverse lookup used by adapters to associate provider directories with projects. */
  findProjectByPath: (path: string) => Promise<ProjectId | null>;
  /** Host-owned attachment resolver exposed to adapters. */
  resolveAttachment: (attachmentId: AttachmentId) => Promise<ResolvedAttachment>;
}

interface RegisteredProvider {
  registration: AdapterRegistration;
  adapter: AgentAdapter;
  detection: ProviderDetection | null;
  capabilities: AgentCapabilities;
  enabled: boolean;
  announced: boolean;
}

/**
 * Owns adapter instances, their detection state, and their capabilities.
 * Adapters receive a context whose `emit` feeds the global event bus and whose
 * `resolveProjectPath` is the allowlisted project registry resolver.
 */
export class ProviderRegistry {
  readonly #config: HostConfig;
  readonly #bus: EventBus;
  readonly #logger: AdapterLogger;
  readonly #hostVersion: string;
  readonly #resolveProjectPath: (projectId: ProjectId) => Promise<string>;
  readonly #findProjectByPath: (path: string) => Promise<ProjectId | null>;
  readonly #resolveAttachment: (attachmentId: AttachmentId) => Promise<ResolvedAttachment>;
  readonly #providers = new Map<ProviderId, RegisteredProvider>();

  constructor(options: ProviderRegistryOptions) {
    this.#config = options.config;
    this.#bus = options.bus;
    this.#logger = options.logger;
    this.#hostVersion = options.hostVersion;
    this.#resolveProjectPath = options.resolveProjectPath;
    this.#findProjectByPath = options.findProjectByPath;
    this.#resolveAttachment = options.resolveAttachment;
  }

  register(registration: AdapterRegistration): void {
    if (this.#providers.has(registration.id)) {
      throw new HostError("conflict", `Provider "${registration.id}" is already registered.`);
    }
    const providerConfig = this.#config.providers[registration.id]?.config ?? {};
    this.#providers.set(registration.id, {
      registration,
      adapter: registration.create(Object.freeze({ ...providerConfig })),
      detection: null,
      capabilities: noCapabilities,
      enabled: true,
      announced: false,
    });
  }

  /** Initializes and detects every enabled provider. */
  async initialize(): Promise<void> {
    for (const entry of this.#providers.values()) {
      if (this.#config.providers[entry.registration.id]?.enabled === false) {
        entry.enabled = false;
        this.#logger.info("Provider disabled by configuration.", { provider: entry.registration.id });
        continue;
      }
      await this.#initializeProvider(entry);
    }
  }

  /** Re-runs detection for all enabled providers and publishes transitions. */
  async refresh(): Promise<void> {
    for (const entry of this.#providers.values()) {
      if (!entry.enabled) continue;
      const wasAvailable = this.#isAvailable(entry);
      await this.#probeProvider(entry);
      const isAvailableNow = this.#isAvailable(entry);
      if (wasAvailable && !isAvailableNow) {
        this.#bus.publish({
          type: "provider.disconnected",
          provider: entry.registration.id,
          projectId: null,
          sessionId: null,
          occurredAt: nowTimestamp(),
          data: {
            providerId: entry.registration.id,
            reason: entry.detection?.warning ?? "Provider is no longer available.",
          },
        });
      }
      this.#publishProvider(entry);
    }
  }

  async #initializeProvider(entry: RegisteredProvider): Promise<void> {
    const providerConfig = this.#config.providers[entry.registration.id]?.config ?? {};
    const context: AdapterContext = {
      hostVersion: this.#hostVersion,
      config: Object.freeze({ ...providerConfig }),
      logger: createConsoleLogger(`provider:${entry.registration.id}`, { level: this.#config.host.logLevel }),
      resolveProjectPath: this.#resolveProjectPath,
      findProjectByPath: this.#findProjectByPath,
      resolveAttachment: this.#resolveAttachment,
      emit: (event) => {
        this.#bus.publish(event);
      },
    };

    try {
      await entry.adapter.init?.(context);
    } catch (error) {
      const agentError = toAgentError(error, { provider: entry.registration.id });
      this.#logger.error("Provider failed to initialize.", {
        provider: entry.registration.id,
        error: agentError.message,
      });
      entry.detection = { installed: false, authenticated: null, compatible: false, warning: agentError.message };
      entry.capabilities = noCapabilities;
      this.#publishProvider(entry);
      return;
    }

    await this.#probeProvider(entry);
    this.#publishProvider(entry);
  }

  async #probeProvider(entry: RegisteredProvider): Promise<void> {
    try {
      const [detection, capabilities] = await Promise.all([entry.adapter.detect(), entry.adapter.getCapabilities()]);
      entry.detection = detection;
      entry.capabilities = defineCapabilities(capabilities);
    } catch (error) {
      const agentError = toAgentError(error, { provider: entry.registration.id });
      this.#logger.warn("Provider detection failed.", { provider: entry.registration.id, error: agentError.message });
      entry.detection = { installed: false, authenticated: null, compatible: false, warning: agentError.message };
      entry.capabilities = noCapabilities;
    }
  }

  #publishProvider(entry: RegisteredProvider): void {
    const provider = this.toAgentProvider(entry);
    if (!entry.announced) {
      entry.announced = true;
      this.#bus.publish({
        type: "provider.connected",
        provider: entry.registration.id,
        projectId: null,
        sessionId: null,
        occurredAt: nowTimestamp(),
        data: { provider },
      });
      return;
    }
    this.#bus.publish({
      type: "provider.updated",
      provider: entry.registration.id,
      projectId: null,
      sessionId: null,
      occurredAt: nowTimestamp(),
      data: { provider },
    });
  }

  #isAvailable(entry: RegisteredProvider): boolean {
    return entry.detection?.installed === true && entry.detection.compatible;
  }

  toAgentProvider(entry: RegisteredProvider): AgentProvider {
    return {
      id: entry.registration.id,
      name: entry.registration.displayName,
      version: entry.detection?.version ?? null,
      installed: entry.detection?.installed ?? false,
      authenticated: entry.detection?.authenticated ?? null,
      compatible: entry.detection?.compatible ?? false,
      capabilities: { ...entry.capabilities },
      warning: entry.detection?.warning ?? null,
    };
  }

  listProviders(): AgentProvider[] {
    return [...this.#providers.values()].filter((entry) => entry.enabled).map((entry) => this.toAgentProvider(entry));
  }

  getProvider(providerId: ProviderId): AgentProvider {
    return this.toAgentProvider(this.#requireEntry(providerId));
  }

  /** Adapter instances for enabled providers (used for session listing). */
  adapters(): Array<{ id: ProviderId; adapter: AgentAdapter }> {
    return [...this.#providers.values()]
      .filter((entry) => entry.enabled)
      .map((entry) => ({ id: entry.registration.id, adapter: entry.adapter }));
  }

  requireAdapter(providerId: ProviderId): AgentAdapter {
    return this.#requireEntry(providerId).adapter;
  }

  requireCapability(providerId: ProviderId, capability: CapabilityKey): void {
    const entry = this.#requireEntry(providerId);
    if (!entry.capabilities[capability]) {
      throw new HostError("unsupported_capability", `Provider "${providerId}" does not support "${capability}".`, {
        details: { provider: providerId, capability },
      });
    }
  }

  /** Model catalog with capability gating and schema validation of adapter output. */
  async listModels(providerId: ProviderId, project: AgentProject): Promise<AgentModel[]> {
    this.requireCapability(providerId, "models");
    const models = await this.requireAdapter(providerId).listModels(project);
    return this.#validateCatalog(providerId, "model", models, agentModelSchema);
  }

  /** Mode catalog with capability gating and schema validation of adapter output. */
  async listModes(providerId: ProviderId, project: AgentProject): Promise<AgentMode[]> {
    this.requireCapability(providerId, "modes");
    const modes = await this.requireAdapter(providerId).listModes(project);
    return this.#validateCatalog(providerId, "mode", modes, agentModeSchema);
  }

  #validateCatalog<T>(
    providerId: ProviderId,
    kind: string,
    entries: T[],
    schema: {
      safeParse: (value: unknown) => {
        success: boolean;
        data?: T;
        error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
      };
    },
  ): T[] {
    const valid: T[] = [];
    for (const entry of entries) {
      const parsed = schema.safeParse(entry);
      if (parsed.success && parsed.data !== undefined) {
        valid.push(parsed.data);
      } else {
        this.#logger.warn(`Adapter returned an invalid ${kind}; ignoring it.`, {
          provider: providerId,
          issues: parsed.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) ?? [],
        });
      }
    }
    return valid;
  }

  /** Providers that are installed and compatible, for project availability. */
  availableProviderIds(): ProviderId[] {
    return [...this.#providers.values()]
      .filter((entry) => entry.enabled && this.#isAvailable(entry))
      .map((entry) => entry.registration.id);
  }

  async dispose(): Promise<void> {
    for (const entry of this.#providers.values()) {
      try {
        await entry.adapter.dispose?.();
      } catch (error) {
        this.#logger.warn("Provider dispose failed.", {
          provider: entry.registration.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  #requireEntry(providerId: ProviderId): RegisteredProvider {
    const entry = this.#providers.get(providerId);
    if (!entry || !entry.enabled) {
      throw new HostError("provider_not_found", `Unknown provider "${providerId}".`);
    }
    return entry;
  }
}
