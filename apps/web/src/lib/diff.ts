/**
 * Unified-diff parsing for the Code Block diff view. Input is a real patch from
 * AgentDiff; nothing here invents changes.
 */

export type DiffRow = { kind: "ctx" | "add" | "del" | "hunk"; text: string; number: number | null };

/** Unified patch → rows with the upstream single-gutter numbering. */
export function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  // A bare fragment without hunk headers is all content.
  let inHunk = !/^@@ /m.test(patch);
  for (const line of patch.replace(/\n$/, "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line, number: null });
    } else if (!inHunk || line.startsWith("\\")) {
      // File headers (diff --git, ---, +++) before the first hunk, and "\ No newline" markers.
      continue;
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), number: newLine });
      newLine += 1;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), number: oldLine });
      oldLine += 1;
    } else {
      rows.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line, number: newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return rows;
}
