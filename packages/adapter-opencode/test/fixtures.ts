/**
 * Synthetic OpenCode 2.0.18 payloads for tests. All values are fictional:
 * no real paths, accounts, or repository names.
 */

export const nativeModel = {
  id: "example-model",
  modelID: "example-model",
  providerID: "example-provider",
  name: "Example Model",
  status: "active" as const,
  enabled: true,
  capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
  variants: [{ id: "none" }, { id: "low" }, { id: "high" }],
  limit: { context: 200_000, input: 180_000, output: 32_000 },
};

export const nativeModelTextOnly = {
  id: "text-only",
  modelID: "text-only",
  providerID: "example-provider",
  name: "Text Only",
  status: "deprecated" as const,
  enabled: true,
  capabilities: { tools: false, input: ["text"], output: ["text"] },
  variants: [],
  limit: { context: 8_000, output: 2_000 },
};

export const nativeAgentPrimary = {
  id: "build",
  name: "Build",
  mode: "primary" as const,
  hidden: false,
  description: "Build things",
};

export const nativeAgentPlan = {
  id: "plan",
  name: "Plan",
  mode: "primary" as const,
  hidden: false,
};

export const nativeAgentHidden = {
  id: "compaction",
  name: "Compaction",
  mode: "primary" as const,
  hidden: true,
};

export const nativeAgentSubagent = {
  id: "explore",
  name: "Explore",
  mode: "subagent" as const,
  hidden: false,
};

export const nativeSession = {
  id: "ses_example123",
  projectID: "native-project",
  title: "Example session",
  agent: "build",
  model: { id: "example-model", providerID: "example-provider", variant: "low" },
  outcome: "succeeded" as const,
  time: { created: 1_760_000_000_000, updated: 1_760_000_060_000, idle: 1_760_000_060_000 },
  location: { directory: "/home/example/projects/demo" },
};

export const nativeUserMessage = {
  type: "user" as const,
  id: "msg_user1",
  time: { created: 1_760_000_000_000 },
  text: "Please update the readme",
  files: [{ mime: "image/png", name: "screenshot.png" }],
};

export const nativeAssistantMessage = {
  type: "assistant" as const,
  id: "msg_assistant1",
  time: { created: 1_760_000_000_000, completed: 1_760_000_005_000 },
  agent: "build",
  model: { id: "example-model", providerID: "example-provider" },
  content: [
    { type: "text" as const, text: "Updated." },
    { type: "reasoning" as const, text: "Thinking about docs" },
    {
      type: "tool" as const,
      id: "call_1",
      name: "write",
      state: {
        status: "completed" as const,
        input: { path: "README.md", content: "hello" },
        content: [
          { type: "text" as const, text: "Wrote README.md" },
          {
            type: "file" as const,
            uri: "/home/example/projects/demo/README.md",
            mime: "text/markdown",
            name: "README.md",
          },
        ],
      },
      time: { created: 1_760_000_001_000, completed: 1_760_000_002_000 },
    },
  ],
};

export const nativePermission = {
  id: "per_example1",
  sessionID: "ses_example123",
  action: "write",
  resources: ["/home/example/projects/demo/README.md"],
  save: ["README.md"],
  message: "Write to README.md",
  source: { type: "tool", messageID: "msg_assistant1", id: "call_1" },
};

export const nativeForm = {
  id: "frm_example1",
  sessionID: "ses_example123",
  title: "Questions",
  metadata: { kind: "question", tool: { messageID: "msg_assistant1", id: "call_1" } },
  fields: [
    {
      key: "q0",
      title: "Color",
      description: "Which color?",
      type: "string",
      required: true,
      options: [
        { value: "Red", label: "Red" },
        { value: "Blue", label: "Blue" },
      ],
      custom: true,
    },
  ],
};

export const nativeFileDiffs = [
  {
    file: "/home/example/projects/demo/README.md",
    patch: "@@ -1 +1 @@\n-hello\n+hello world\n",
    additions: 1,
    deletions: 1,
    status: "modified" as const,
  },
  { file: "src/new.ts", patch: "", additions: 3, deletions: 0, status: "added" as const },
];

export function event(type: string, data: Record<string, unknown>, created = 1_760_000_000_000) {
  return { id: `evt_${type}_${created}`, type, created, data };
}
