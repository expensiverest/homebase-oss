import { describe, expect, it } from "vitest";

import { createConsoleLogger, createRecordingLogger, redactSecrets } from "../src/logger.js";

describe("secret redaction", () => {
  it("redacts common credential shapes", () => {
    const cases: Array<[string, string]> = [
      ["key sk-abcdefghijklmnopqrstuvwxyz01 end", "sk-***"],
      ["token ghp_abcdefghijklmnopqrstuvwx end", "ghp_***"],
      ["Authorization: Bearer abc.def.ghi", "Bearer ***"],
      ["https://example.com/cb?token=supersecretvalue&x=1", "token=***"],
      ["ANTHROPIC_API_KEY=sk-ant-verysecret", "ANTHROPIC_API_KEY=***"],
      ["password=hunter2secret", "password=***"],
    ];

    for (const [input, expected] of cases) {
      const output = redactSecrets(input);
      expect(output, input).toContain(expected);
    }
  });

  it("leaves ordinary text intact", () => {
    expect(redactSecrets("Session completed with 3 tool calls")).toBe("Session completed with 3 tool calls");
  });
});

describe("loggers", () => {
  it("records entries for tests", () => {
    const { logger, entries } = createRecordingLogger();
    logger.info("hello", { sessionId: "ses_1" });
    expect(entries).toEqual([{ level: "info", message: "hello", fields: { sessionId: "ses_1" } }]);
  });

  it("redacts secrets in console output and honors levels", () => {
    const lines: string[] = [];
    const sink = {
      debug: (...args: unknown[]) => lines.push(args.join(" ")),
      info: (...args: unknown[]) => lines.push(args.join(" ")),
      warn: (...args: unknown[]) => lines.push(args.join(" ")),
      error: (...args: unknown[]) => lines.push(args.join(" ")),
    };
    const logger = createConsoleLogger("test", { level: "warn", sink });

    logger.debug("sk-abcdefghijklmnopqrstuvwxyz01");
    logger.warn("API_KEY=supersecretvalue");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("API_KEY=***");
    expect(lines[0]).not.toContain("supersecretvalue");
  });
});
