import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@homebase/adapter-opencode",
        replacement: fileURLToPath(new URL("../../packages/adapter-opencode/src/index.ts", import.meta.url)),
      },
      {
        find: "@homebase/adapter-sdk/testing",
        replacement: fileURLToPath(new URL("../../packages/adapter-sdk/src/testing/index.ts", import.meta.url)),
      },
      {
        find: "@homebase/adapter-sdk",
        replacement: fileURLToPath(new URL("../../packages/adapter-sdk/src/index.ts", import.meta.url)),
      },
      {
        find: "@homebase/protocol",
        replacement: fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    name: "host",
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
