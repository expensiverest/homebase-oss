import { serve } from "@hono/node-server";
import { createConsoleLogger, type AdapterLogger, type AdapterRegistration } from "@homebase/adapter-sdk";
import { claudeRegistration } from "@homebase/adapter-claude";
import { grokRegistration } from "@homebase/adapter-grok";
import { opencodeRegistration } from "@homebase/adapter-opencode";
import { MockAdapter } from "@homebase/adapter-sdk/testing";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Hono } from "hono";

import { createApiApp, type ApiEnv } from "./api/index.js";
import { createAuthenticator, DeviceState, type Authenticator } from "./auth/index.js";
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
  /** Absolute path to a built web client; defaults to apps/web/dist when present. */
  webDistPath?: string | null;
  stateDir?: string;
  onShutdown?: () => void;
}

export interface HostRuntime {
  readonly config: HostConfig;
  readonly bus: EventBus;
  readonly providers: ProviderRegistry;
  readonly projects: ProjectRegistry;
  readonly sessions: SessionService;
  readonly attachments: AttachmentStore;
  readonly auth: Authenticator;
  readonly devices?: DeviceState;
  readonly app: Hono<ApiEnv>;
  start(): Promise<{ hostname: string; port: number }>;
  close(): Promise<void>;
  readonly closed: Promise<void>;
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
    claudeRegistration,
    grokRegistration,
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
  const devices = config.auth.mode === "device" ? await DeviceState.open(options.stateDir) : undefined;
  const auth = createAuthenticator(config, devices);
  const attachments = new AttachmentStore();

  const defaultWebDist = path.resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));
  const webDist =
    options.webDistPath === null
      ? null
      : options.webDistPath !== undefined
        ? options.webDistPath
        : existsSync(path.join(defaultWebDist, "index.html"))
          ? defaultWebDist
          : null;

  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let closing: Promise<void> | null = null;
  let isClosing = false;
  const close = (): Promise<void> => {
    if (closing) return closing;
    isClosing = true;
    providers.beginClose();
    return (closing = (async () => {
      const errors: unknown[] = [];
      const running = server;
      server = null;
      try {
        if (running) {
          // Stop accepting first: no connection can arrive between socket teardown
          // and listener shutdown. Admin shutdown schedules close after response finish.
          await new Promise<void>((resolve, reject) => {
            running.close((error) => (error ? reject(error) : resolve()));
            if ("closeAllConnections" in running) running.closeAllConnections();
          });
        }
      } catch (error) {
        errors.push(error);
      } finally {
        try {
          await providers.dispose();
        } catch (error) {
          errors.push(error);
        } finally {
          try {
            attachments.dispose();
          } catch (error) {
            errors.push(error);
          } finally {
            // closed signals completion of all cleanup attempts; close() reports errors.
            resolveClosed();
            options.onShutdown?.();
          }
        }
      }
      if (errors.length) throw new AggregateError(errors, "Homebase shutdown cleanup failed.");
    })());
  };
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
    devices,
    logger,
    webDist,
    requestShutdown: () => {
      void close().catch((error: unknown) => logger.error("Host shutdown failed.", { error: String(error) }));
    },
    isClosing: () => isClosing,
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
    devices,
    app,
    closed,
    async start() {
      if (isClosing) throw new Error("The Homebase Host is shutting down.");
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
    close,
  };
}
