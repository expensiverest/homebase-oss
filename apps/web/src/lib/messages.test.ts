import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@homebase/protocol";
import { mergeMessages } from "./messages.js";
import { fileURLToPath } from "node:url";
import { readTranscriptMessages } from "../../../../packages/adapter-claude/src/history/transcripts.js";
const msg = (id: string, role: "user" | "assistant", text: string): AgentMessage => ({
  id,
  sessionId: "s",
  role,
  createdAt: "2026-09-30T00:00:00Z",
  state: "completed",
  parts: [{ type: "text", id: `${id}-text`, text }],
});
const ua = msg("ua", "user", "A"),
  aa = msg("aa", "assistant", "Reply A"),
  ub = msg("ub", "user", "B"),
  ab = msg("ab", "assistant", "Reply B");
describe("conversation merge", () => {
  it("carries the Claude transcript fixture through pages, a live overlap, and cold reload", () => {
    const chronological = readTranscriptMessages(
      fileURLToPath(new URL("../../../../packages/adapter-claude/test/fixtures/chronology.jsonl", import.meta.url)),
      "fixture-session",
    );
    const history = [...chronological].reverse();
    expect(history.map((m) => m.role)).toEqual(["assistant", "user", "assistant", "user"]);
    const live = [msg("optimistic_b", "user", "Great, what model are you?"), ...chronological.slice(2)];
    expect(mergeMessages(history.slice(0, 2), live).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(mergeMessages(history, live).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(mergeMessages(history, []).map((m) => m.id)).toEqual(chronological.map((m) => m.id));
  });
  it("reverses paginated newest-first history without timestamp sorting", () => {
    expect(mergeMessages([ab, ub, aa, ua], []).map((m) => m.id)).toEqual(["ua", "aa", "ub", "ab"]);
  });
  it("anchors overlapping live snapshots and pending prompts around provider conversation order", () => {
    expect(mergeMessages([ab, ub, aa, ua], [msg("optimistic_b", "user", "B"), ab]).map((m) => m.id)).toEqual([
      "ua",
      "aa",
      "ub",
      "ab",
    ]);
    expect(mergeMessages([aa, ua], [msg("optimistic_b", "user", "B"), ub, ab]).map((m) => m.id)).toEqual([
      "ua",
      "aa",
      "ub",
      "ab",
    ]);
  });
  it("does not deduplicate an unrelated historical prompt with identical text", () => {
    expect(mergeMessages([aa, ua], [msg("optimistic_a", "user", "A")]).map((m) => m.id)).toEqual([
      "ua",
      "aa",
      "optimistic_a",
    ]);
  });
  it("preserves older-page prepend and cold reload ordering", () => {
    expect(mergeMessages([ab, ub], [ub, ab]).map((m) => m.id)).toEqual(["ub", "ab"]);
    expect(mergeMessages([ab, ub, aa, ua], [ub, ab]).map((m) => m.id)).toEqual(["ua", "aa", "ub", "ab"]);
  });
  it("places a not-yet-fetched user before its shared assistant anchor", () => {
    expect(mergeMessages([ab, aa, ua], [ub, ab]).map((m) => m.id)).toEqual(["ua", "aa", "ub", "ab"]);
  });
  it("matches a differently identified accepted user only inside its response interval", () => {
    const accepted = msg("accepted_b", "user", "B");
    expect(mergeMessages([ab, ub, aa, ua], [accepted, ab]).map((m) => m.id)).toEqual(["ua", "aa", "ub", "ab"]);
    expect(mergeMessages([ab, ub, aa, ua], [accepted]).map((m) => m.id)).toEqual([
      "ua",
      "aa",
      "ub",
      "ab",
      "accepted_b",
    ]);
  });
});
