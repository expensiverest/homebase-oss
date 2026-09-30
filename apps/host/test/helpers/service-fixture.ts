import { vi } from "vitest";
import type { ServiceDefinition, ServiceInspection, ServiceManager } from "../../src/service/types.js";
import type { SetupPrompter } from "../../src/setup/prompts.js";
import type { TailscaleStatus } from "../../src/remote/tailscale.js";
import { HOST_VERSION } from "../../src/version.js";
import { HOMEBASE_API_VERSION, HOMEBASE_PROTOCOL_VERSION } from "@homebase/protocol";
import type { HostHealth } from "../../src/service/health.js";

export function fakeManager() {
  const state: ServiceInspection = { installed: false, enabled: false, running: false };
  let installed: ServiceDefinition | null = null;
  return {
    kind: "windows-task",
    identifier: "Homebase Test",
    logSource: "fixture log",
    state,
    isAvailable: vi.fn(async () => true),
    inspect: vi.fn(async () => ({ ...state })),
    install: vi.fn(async (d: ServiceDefinition) => {
      installed = d;
      state.installed = true;
      state.enabled = true;
    }),
    start: vi.fn(async () => {
      state.running = true;
    }),
    stop: vi.fn(async () => {
      state.running = false;
    }),
    uninstall: vi.fn(async () => {
      state.installed = false;
      state.enabled = false;
      state.running = false;
    }),
    matches: vi.fn(
      (_s: ServiceInspection, d: ServiceDefinition) =>
        installed !== null &&
        Object.keys(installed).every(
          (key) => installed![key as keyof ServiceDefinition] === d[key as keyof ServiceDefinition],
        ),
    ),
  } satisfies ServiceManager & { state: ServiceInspection };
}
export function fakePrompts(confirms: boolean[] = [], inputs: string[] = []): SetupPrompter {
  return {
    confirm: vi.fn(async (_question, fallback = true) => confirms.shift() ?? fallback),
    input: vi.fn(async (_question, fallback = "") => inputs.shift() ?? fallback),
    choose: vi.fn(async (_question, choices) => choices[0]!),
  };
}
export function captureIo() {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line), error: (line: string) => lines.push(line) };
}
export const goodHealth: HostHealth = {
  status: "ok",
  version: HOST_VERSION,
  apiVersion: HOMEBASE_API_VERSION,
  protocolVersion: HOMEBASE_PROTOCOL_VERSION,
  uptimeSeconds: 1,
  latestSequence: 1,
};
export const goodTailscale: TailscaleStatus = {
  installed: true,
  connected: true,
  serve: "correct",
  url: "https://fixture.example.ts.net",
  message: "Private HTTPS configured.",
};
