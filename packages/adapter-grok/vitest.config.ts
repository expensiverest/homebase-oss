import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@homebase/transport-acp",
        replacement: fileURLToPath(new URL("../transport-acp/src/index.ts", import.meta.url)),
      },
      {
        find: "@homebase/adapter-sdk/compliance",
        replacement: fileURLToPath(new URL("../adapter-sdk/src/compliance.ts", import.meta.url)),
      },
      {
        find: "@homebase/adapter-sdk/testing",
        replacement: fileURLToPath(new URL("../adapter-sdk/src/testing/index.ts", import.meta.url)),
      },
      {
        find: "@homebase/adapter-sdk",
        replacement: fileURLToPath(new URL("../adapter-sdk/src/index.ts", import.meta.url)),
      },
      {
        find: "@homebase/protocol",
        replacement: fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    name: "adapter-grok",
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
