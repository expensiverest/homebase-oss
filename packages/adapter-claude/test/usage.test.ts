import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeUsageLedger, claudeTokens } from "../src/usage.js";
const native = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 20,
  cache_creation_input_tokens: 30,
  output_tokens_details: { thinking_tokens: 2 },
};
describe("Claude consumption accounting", () => {
  it("includes cache in input and thinking in output without double counting", () => {
    expect(claudeTokens(native)).toEqual({
      inputTokens: 60,
      outputTokens: 5,
      cacheReadTokens: 20,
      cacheWriteTokens: 30,
      reasoningTokens: 2,
      totalTokens: 65,
    });
  });
  it("replaces repeated assistant snapshots and uses the final result for the turn", () => {
    const ledger = new ClaudeUsageLedger();
    ledger.observe("a", native);
    ledger.observe("a", native);
    expect(ledger.snapshot("session")?.tokens.outputTokens).toBeNull();
    expect(ledger.snapshot("session")?.tokens.inputTokens).toBe(60);
    ledger.finish("turn-a", { ...native, output_tokens: 8 }, 0.1);
    expect(ledger.snapshot("session")).toMatchObject({ tokens: { totalTokens: 68 }, costUsd: 0.1 });
    ledger.observe("a", native); // Late snapshot cannot count the completed call again.
    ledger.observe("b", native);
    ledger.finish("turn-b", native, 0.15);
    expect(ledger.snapshot("session")).toMatchObject({ tokens: { totalTokens: 133 }, costUsd: 0.15 });
  });
  it("does not invent missing token counters or unobserved usage", () => {
    const ledger = new ClaudeUsageLedger();
    expect(ledger.snapshot("session")).toBeNull();
    expect(claudeTokens({ input_tokens: 1, output_tokens: 2 })).toMatchObject({
      cacheReadTokens: null,
      totalTokens: null,
    });
    expect(claudeTokens({ input_tokens: -1, output_tokens: Infinity })).toMatchObject({
      inputTokens: null,
      outputTokens: null,
    });
  });
  it("does not add cumulative cost twice across turns, and retains spend across old CLI processes", () => {
    const ledger = new ClaudeUsageLedger();
    ledger.beginProcess();
    ledger.setVersion("2.1.268");
    ledger.finish("a", native, 0.1);
    ledger.finish("b", native, 0.15);
    expect(ledger.snapshot("s")?.costUsd).toBe(0.15);
    ledger.beginProcess();
    ledger.setVersion("2.1.268");
    ledger.finish("c", native, 0.05);
    expect(ledger.snapshot("s")?.costUsd).toBe(0.2);
    ledger.beginProcess();
    ledger.setVersion("2.1.277");
    ledger.finish("d", native, 0.25);
    expect(ledger.snapshot("s")?.costUsd).toBe(0.25);
  });
  it("does not erase observed spend with a zeroed execution-error result", () => {
    const ledger = new ClaudeUsageLedger();
    ledger.observe("a", native);
    ledger.finish("a", native, 0.1);
    ledger.observe("b", native);
    expect(
      ledger.finish(
        "b",
        { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        0,
        true,
      ),
    ).toBeNull();
    expect(ledger.snapshot("s")).toMatchObject({ costUsd: 0.1, partial: true, tokens: { outputTokens: null } });
  });
  it("restores deduplicated historical input/cache while leaving placeholder output and unrecorded cost unknown", () => {
    const dir = mkdtempSync(join(tmpdir(), "homebase-claude-usage-"));
    try {
      const path = join(dir, "history.jsonl");
      const frame = {
        type: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        message: { id: "native-a", model: "test-model", usage: { ...native, output_tokens: 1 } },
      };
      writeFileSync(
        path,
        [
          frame,
          frame,
          { ...frame, isSidechain: true, message: { ...frame.message, id: "subagent" } },
          { ...frame, isMeta: true, message: { ...frame.message, id: "meta" } },
          { ...frame, message: { ...frame.message, id: "notice", model: "<synthetic>" } },
        ]
          .map((value) => JSON.stringify(value))
          .concat("malformed")
          .join("\n"),
      );
      const ledger = new ClaudeUsageLedger();
      ledger.readHistory(path);
      ledger.readHistory(path);
      expect(ledger.snapshot("session")).toMatchObject({
        tokens: {
          inputTokens: 60,
          cacheReadTokens: 20,
          cacheWriteTokens: 30,
          outputTokens: null,
          reasoningTokens: null,
          totalTokens: null,
        },
        costUsd: null,
        partial: true,
        updatedAt: frame.timestamp,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
