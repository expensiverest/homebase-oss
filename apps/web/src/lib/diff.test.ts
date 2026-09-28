import { describe, expect, it } from "vitest";

import { parsePatch } from "./diff.js";

describe("parsePatch", () => {
  it("numbers removals with the old line and everything else with the new line", () => {
    const rows = parsePatch(
      "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -10,3 +10,4 @@\n keep\n-old\n+new\n+added\n tail\n",
    );
    expect(rows.map((row) => [row.kind, row.number, row.text])).toEqual([
      ["hunk", null, "@@ -10,3 +10,4 @@"],
      ["ctx", 10, "keep"],
      ["del", 11, "old"],
      ["add", 11, "new"],
      ["add", 12, "added"],
      ["ctx", 13, "tail"],
    ]);
  });

  it("keeps a removed line that starts with dashes once inside a hunk", () => {
    const rows = parsePatch("@@ -1 +1 @@\n---flag\n+--flag\n");
    expect(rows.map((row) => row.kind)).toEqual(["hunk", "del", "add"]);
    expect(rows[1]?.text).toBe("--flag");
  });

  it("treats a fragment without hunk headers as content", () => {
    expect(parsePatch("+a\n-b\n c").map((row) => row.kind)).toEqual(["add", "del", "ctx"]);
  });
});
