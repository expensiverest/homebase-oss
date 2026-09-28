import type { AgentProject } from "@homebase/protocol";

import { defineAdapterComplianceSuite } from "../src/compliance.js";
import { MockAdapter } from "../src/testing/mock-adapter.js";

const PROJECT: AgentProject = {
  id: "prj_compliance",
  name: "compliance-fixture",
  path: "/tmp/homebase-compliance-fixture",
  providersAvailable: ["mock"],
};

/**
 * The mock adapter is the reference implementation of the adapter contract, so
 * it runs the full compliance suite, including the live behavioral checks.
 */
defineAdapterComplianceSuite({
  providerName: "Mock",
  createAdapter: () => new MockAdapter({ stepDelayMs: 0 }),
  createProject: () => PROJECT,
  live: true,
  timeoutMs: 10_000,
});
