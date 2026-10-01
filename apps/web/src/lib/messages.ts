import type { AgentMessage } from "@homebase/protocol";

const text = (m: AgentMessage) =>
  m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n\n")
    .trim();

/** Merge two ordered sequences using shared identities as anchors. Timestamps
 * never determine conversation order. History is newest-first; live is arrival-order.
 * Optimistic prompts match one history user in their shared-message interval,
 * never an arbitrary old prompt with the same text. */
export function mergeMessages(newestFirst: AgentMessage[], live: AgentMessage[]): AgentMessage[] {
  const history: AgentMessage[] = [];
  const seen = new Set<string>();
  for (const m of [...newestFirst].reverse())
    if (!seen.has(m.id)) {
      seen.add(m.id);
      history.push(m);
    }
  const indices = new Map(history.map((m, i) => [m.id, i]));
  const matchedUsers = new Set<string>();
  const pending = live.filter((m, i) => {
    if (m.role !== "user" || indices.has(m.id)) return true;
    const optimistic = m.id.startsWith("optimistic_");
    // A provider's accepted user-message echo precedes its response. Replace
    // the adjacent pending prompt immediately, even before history refetches.
    const accepted = live.slice(i + 1).find((entry) => !entry.id.startsWith("optimistic_"));
    if (optimistic && accepted?.role === "user" && text(accepted) === text(m) && !matchedUsers.has(accepted.id)) {
      matchedUsers.add(accepted.id);
      return false;
    }
    const before = live
      .slice(0, i)
      .reverse()
      .find((entry) => indices.has(entry.id));
    const after = live.slice(i + 1).find((entry) => indices.has(entry.id));
    // Some providers assign a different persisted user id. Only the matching
    // response identity can prove that such an accepted echo overlaps history.
    if (!optimistic && after?.role !== "assistant") return true;
    // With no shared anchor we cannot prove this is the same accepted turn.
    if (!before && !after) return true;
    const low = before ? indices.get(before.id)! + 1 : 0;
    const high = after ? indices.get(after.id)! : history.length;
    const candidate = history
      .slice(low, high)
      .reverse()
      .find((entry) => entry.role === "user" && !matchedUsers.has(entry.id) && text(entry) === text(m));
    if (!candidate) return true;
    matchedUsers.add(candidate.id);
    return false;
  });
  const result = [...history];
  const slots = new Map(result.map((m, i) => [m.id, i]));
  // Unknown live messages go before their next shared anchor; otherwise after
  // history. Existing snapshots replace in-place without moving their slots.
  let previous = -1;
  for (let i = 0; i < pending.length; i++) {
    const m = pending[i]!;
    const known = slots.get(m.id);
    if (known !== undefined) {
      result[known] = m;
      previous = known;
      continue;
    }
    const next = pending.slice(i + 1).find((entry) => slots.has(entry.id));
    const at = next ? slots.get(next.id)! : Math.max(previous + 1, result.length);
    result.splice(at, 0, m);
    slots.clear();
    result.forEach((entry, index) => slots.set(entry.id, index));
    previous = at;
  }
  return result;
}
