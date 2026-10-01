import { describe, it, expect } from "vitest";
import { AcpTransport } from "@homebase/transport-acp";

describe.skipIf(process.env.HOMEBASE_TEST_DOGFOOD !== "1")("no-model Grok dogfood", () => {
  it("advertises its extension family and recognizes structured usage without creating a session", async () => {
    const transport = new AcpTransport({
      command: "grok",
      args: ["--no-auto-update", "agent", "stdio"],
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    try {
      const initialized = await transport.start();
      expect(initialized.meta?.grokShell).toBe(true);
      // A deliberately nonexistent session establishes method support only.
      // No user history, login flow or model turn is touched.
      await expect(
        transport.requestExtension(
          "_x.ai/session/usage",
          { sessionId: "homebase-no-model-probe" },
          { timeoutMs: 3000 },
        ),
      ).rejects.toMatchObject({ jsonRpcCode: -32002 });
    } finally {
      await transport.stop();
    }
  }, 30000);
});
