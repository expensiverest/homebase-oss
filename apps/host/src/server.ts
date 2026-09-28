import { serve } from "@hono/node-server";
import { createConsoleLogger, type AdapterLogger, type AdapterRegistration } from "@homebase/adapter-sdk";
import { opencodeRegistration } from "@homebase/adapter-opencode";
import { MockAdapter } from "@homebase/adapter-sdk/testing";
import type { Hono } from "hono";

import { createApiApp, type ApiEnv } from "./api/index.js";
import { createAuthenticator, type Authenticator } from "./auth/index.js";
import { AttachmentStore } from "./attachments/index.js";
import type { HostConfig } from "./config/index.js";
import { EventBus } from "./events/index.js";
import { PathAllowlist } from "./paths.js";
import { ProjectRegistry, type GitMetadataReader } from "./projects/index.js";
import { ProviderRegistry } from "./providers/index.js";
import { SessionService } from "./sessions/index.js";
import { HOST_VERSION } from "./version.js";

export interface CreateHostRuntimeOptions {
  config: HostConfig;
  /** Override the provider registrations; defaults to the built-in set. */
  registrations?: AdapterRegistration[];
  logger?: AdapterLogger;
  /** Injectable git metadata reader (tests avoid requiring a git binary). */
  git?: GitMetadataReader;
  /** Event replay buffer size, for tests. */
  eventBufferSize?: number;
}

export interface HostRuntime {
  readonly config: HostConfig;
  readonly bus: EventBus;
  readonly providers: ProviderRegistry;
  readonly projects: ProjectRegistry;
  readonly sessions: SessionService;
  readonly attachments: AttachmentStore;
  readonly auth: Authenticator;
  readonly app: Hono<ApiEnv>;
  start(): Promise<{ hostname: string; port: number }>;
  close(): Promise<void>;
}

/**
 * Built-in provider registrations. The mock adapter is a development fixture
 * and can be disabled with `providers.mock.enabled = false`; OpenCode is the
 * reference real provider and degrades to `installed: false` when absent.
 */
export function createDefaultRegistrations(): AdapterRegistration[] {
  return [
    {
      id: "mock",
      displayName: "Mock Agent",
      create: (config) =>
        new MockAdapter({
          stepDelayMs: typeof config.stepDelayMs === "number" ? config.stepDelayMs : 5,
        }),
    },
    opencodeRegistration,
  ];
}

/** Wires configuration, registries, the event bus, and the HTTP app. */
export async function createHostRuntime(options: CreateHostRuntimeOptions): Promise<HostRuntime> {
  const config = options.config;
  const logger = options.logger ?? createConsoleLogger("host", { level: config.host.logLevel });

  const bus = new EventBus({
    bufferSize: options.eventBufferSize ?? 10_000,
    onListenerError: (error) => {
      logger.warn("Event listener failed.", { error: error instanceof Error ? error.message : String(error) });
    },
  });

  const { allowlist, unavailableRoots } = await PathAllowlist.create(config.projectRoots);
  for (const root of unavailableRoots) {
    logger.warn("Configured project root is unavailable and will not be used.", { root });
  }

  const projects = new ProjectRegistry({
    roots: allowlist.roots,
    allowlist,
    scanDepth: config.projectScanDepth,
    logger,
    ...(options.git !== undefined ? { git: options.git } : {}),
  });
  await projects.discover();

  const providers = new ProviderRegistry({
    config,
    bus,
    logger,
    hostVersion: HOST_VERSION,
    resolveProjectPath: (projectId) => projects.resolvePath(projectId),
    findProjectByPath: async (candidate) => {
      const project = await projects.findByPath(candidate);
      return project?.id ?? null;
    },
    resolveAttachment: async (attachmentId) => attachments.get(attachmentId),
  });
  for (const registration of options.registrations ?? createDefaultRegistrations()) {
    providers.register(registration);
  }
  await providers.initialize();

  const sessions = new SessionService({ providers, projects, bus, logger });
  const auth = createAuthenticator(config);
  const attachments = new AttachmentStore();

  const app = createApiApp({
    version: HOST_VERSION,
    startedAt: Date.now(),
    config,
    bus,
    providers,
    projects,
    sessions,
    attachments,
    auth,
    logger,
  });

  let server: ReturnType<typeof serve> | null = null;

  return {
    config,
    bus,
    providers,
    projects,
    sessions,
    attachments,
    auth,
    app,
    async start() {
      if (server) {
        throw new Error("The Homebase Host is already running.");
      }

      const address = await new Promise<{ hostname: string; port: number }>((resolve, reject) => {
        const created = serve({ fetch: app.fetch, hostname: config.host.bindAddress, port: config.host.port }, (info) =>
          resolve({ hostname: info.address, port: info.port }),
        );
        created.once("error", reject);
        server = created;
      });

      return address;
    },
    async close() {
      await providers.dispose();
      attachments.dispose();
      const running = server;
      server = null;
      if (running) {
        await new Promise<void>((resolve, reject) => {
          running.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  };
}
