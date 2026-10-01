import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestAdapterContext } from "@homebase/adapter-sdk/testing";
import { createPublicId } from "@homebase/adapter-sdk";
import { ClaudeAdapter } from "../src/adapter.js";
import { encodeProjectDir, readTranscriptMessages } from "../src/history/transcripts.js";

describe("Claude conversation chronology", () => {
  it("retains a user text block and reconciles tool results from the same transcript line", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hb-chronology-tool-"));
    try {
      const file = path.join(dir, "transcript.jsonl");
      writeFileSync(
        file,
        [
          {
            type: "assistant",
            message: { id: "assistant-a", content: [{ type: "tool_use", id: "tool-a", name: "Read", input: {} }] },
          },
          {
            type: "user",
            uuid: "user-b",
            message: {
              content: [
                { type: "tool_result", tool_use_id: "tool-a", content: "done" },
                { type: "text", text: "Follow up" },
              ],
            },
          },
        ]
          .map((value) => JSON.stringify(value))
          .join("\n"),
      );
      const messages = readTranscriptMessages(file, "session");
      expect(messages.map((message) => message.role)).toEqual(["assistant", "user"]);
      expect(messages[0]?.parts[0]).toMatchObject({
        type: "tool_call",
        toolCall: { status: "completed", output: { type: "text", text: "done" } },
      });
      expect(messages[1]?.parts[0]).toMatchObject({ type: "text", text: "Follow up" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("preserves transcript line order through cold reads, pagination and reload with equal/missing timestamps", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hb-chronology-"));
    const nativeId = "00000000-0000-4000-8000-000000000001",
      project = { id: "prj_fixture", name: "example", path: dir, providersAvailable: ["claude"] };
    const configDir = path.join(dir, "state"),
      transcriptDir = path.join(configDir, "projects", encodeProjectDir(dir));
    mkdirSync(transcriptDir, { recursive: true });
    const file = path.join(transcriptDir, `${nativeId}.jsonl`);
    writeFileSync(
      file,
      readFileSync(new URL("./fixtures/chronology.jsonl", import.meta.url), "utf8").replaceAll(
        "PROJECT_PATH",
        dir.replaceAll("\\", "\\\\"),
      ),
    );
    const expected = ["user", "assistant", "user", "assistant"];
    try {
      expect(readTranscriptMessages(file, nativeId).map((m) => m.role)).toEqual(expected);
      for (let reload = 0; reload < 2; reload++) {
        const adapter = new ClaudeAdapter({ config: { configDir } });
        adapter.init(createTestAdapterContext({ projectPath: dir, projectId: project.id }));
        try {
          const sessionId = createPublicId("claude", nativeId);
          const newest = await adapter.listMessages(sessionId, { limit: 2 });
          const older = await adapter.listMessages(sessionId, { limit: 2, cursor: newest.nextCursor });
          expect([...newest.items, ...older.items].reverse().map((m) => m.role)).toEqual(expected);
          expect(newest.items[0]?.id).toBe("assistant-b");
          expect(older.items[1]?.id).toBe("ccu_user-a");
        } finally {
          await adapter.dispose();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
