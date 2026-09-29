import { fileURLToPath } from "node:url";

import { runExecutable, spawnExecutable } from "@homebase/adapter-sdk";
import { defineAdapterComplianceSuite } from "@homebase/adapter-sdk/compliance";

import { GrokAdapter, GROK_PROVIDER_ID } from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("../../transport-acp/test/fixtures/fake-agent.mjs", import.meta.url));
const PROJECT_PATH = "/home/example/projects/demo";

/**
 * The full adapter compliance suite runs against the deterministic fake ACP
 * agent, so it never needs Grok, network access, or model quota.
 */
defineAdapterComplianceSuite({
  providerName: "Grok",
  createAdapter: () =>
    new GrokAdapter({
      config: { executable: "grok", startupTimeoutMs: 8_000, controlTimeoutMs: 5_000, shutdownTimeoutMs: 1_000 },
      spawnFn: (_command, args, options) =>
        spawnExecutable(process.execPath, [FIXTURE, ...args], {
          ...options,
          env: { ...(options?.env ?? {}), FAKE_ACP_AUTH: "cached", FAKE_ACP_MODE: "normal" },
        }),
      runFn: (_command, args, options) =>
        runExecutable(process.execPath, [FIXTURE, ...args], {
          ...options,
          env: { ...process.env, FAKE_ACP_VERSION_OUTPUT: "grok 1.0.41 (fixture) [alpha]" },
        }),
    }),
  createProject: () => ({
    id: "prj_fixture",
    name: "demo",
    path: PROJECT_PATH,
    providersAvailable: [GROK_PROVIDER_ID],
  }),
  live: true,
  timeoutMs: 20_000,
});
