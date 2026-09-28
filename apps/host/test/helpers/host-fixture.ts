import { createConsoleLogger } from "@homebase/adapter-sdk";
import type { AdapterRegistration } from "@homebase/adapter-sdk";
import { MockAdapter } from "@homebase/adapter-sdk/testing";
import type { AgentCapabilities, AgentEventType, SequencedAgentEvent } from "@homebase/protocol";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { hostConfigSchema } from "../../src/config/index.js";
import type { GitMetadataReader } from "../../src/projects/index.js";
import { createHostRuntime, type HostRuntime } from "../../src/server.js";

/** Git is not required to test discovery; metadata is faked deterministically. */
export const fakeGitReader: GitMetadataReader = {
  async read(projectPath) {
    return { branch: "main", remote: "https://example.com/example/repo.git", gitRoot: projectPath };
  },
};

const silentSink = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface TestHostOptions {
  /** Map of repository directory name to nested repository paths. */
  repositories?: Record<string, string[]>;
  /** Shallow config overrides merged over test defaults. */
  config?: Record<string, unknown>;
  registrations?: AdapterRegistration[];
  eventBufferSize?: number;
}

export interface TestHost {
  runtime: HostRuntime;
  rootDir: string;
  cleanup(): Promise<void>;
}

export function defaultMockRegistration(
  options: { capabilities?: Partial<AgentCapabilities> } = {},
): AdapterRegistration {
  return {
    id: "mock",
    displayName: "Mock Agent",
    create: () =>
      new MockAdapter({
        stepDelayMs: 0,
        ...(options.capabilities ? { capabilities: options.capabilities } : {}),
      }),
  };
}

export async function createTestHost(options: TestHostOptions = {}): Promise<TestHost> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "homebase-host-"));
  const repositories = options.repositories ?? { "repo-alpha": [], "repo-beta": ["nested/deep-repo"] };

  for (const [name, nested] of Object.entries(repositories)) {
    await mkdir(path.join(rootDir, name, ".git"), { recursive: true });
    for (const child of nested) {
      await mkdir(path.join(rootDir, name, child, ".git"), { recursive: true });
    }
  }
  await mkdir(path.join(rootDir, "plain-folder"), { recursive: true });

  const config = hostConfigSchema.parse({
    host: { port: 0, bindAddress: "127.0.0.1", logLevel: "error" },
    projectRoots: [rootDir],
    ...options.config,
  });

  const runtime = await createHostRuntime({
    config,
    registrations: options.registrations ?? [defaultMockRegistration()],
    git: fakeGitReader,
    eventBufferSize: options.eventBufferSize ?? 200,
    logger: createConsoleLogger("host-test", { level: "error", sink: silentSink }),
  });

  return {
    runtime,
    rootDir,
    async cleanup() {
      await runtime.close();
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

/** Waits for a bus event matching a type, including events already buffered. */
export function waitForEvent<T extends AgentEventType>(
  runtime: HostRuntime,
  type: T,
  predicate: (event: Extract<SequencedAgentEvent, { type: T }>) => boolean = () => true,
  options: { since?: number; timeoutMs?: number } = {},
): Promise<Extract<SequencedAgentEvent, { type: T }>> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const matches = (event: SequencedAgentEvent): event is Extract<SequencedAgentEvent, { type: T }> =>
    event.type === type && predicate(event as Extract<SequencedAgentEvent, { type: T }>);

  if (options.since !== undefined) {
    const buffered = runtime.bus.getAfter(options.since).find(matches);
    if (buffered) return Promise.resolve(buffered);
  }

  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${type}".`));
    }, timeoutMs);

    unsubscribe = runtime.bus.subscribe((event) => {
      if (!matches(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

export async function jsonBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
