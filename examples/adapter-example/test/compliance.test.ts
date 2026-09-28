import type { AgentProject } from "@homebase/protocol";

import { defineAdapterComplianceSuite } from "@homebase/adapter-sdk/compliance";
import { ExampleAdapter } from "../src/index.js";

const PROJECT: AgentProject = {
  id: "prj_example",
  name: "example-project",
  path: "/tmp/homebase-example-project",
  providersAvailable: ["example"],
};

defineAdapterComplianceSuite({
  providerName: "Example",
  createAdapter: () => new ExampleAdapter(),
  createProject: () => PROJECT,
  live: true,
  timeoutMs: 10_000,
});
