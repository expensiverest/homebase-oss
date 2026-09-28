interface Preferences {
  /** Last provider/model/mode chosen for a project. Not sensitive. */
  lastSelection: Record<string, { provider?: string; modelId?: string; mode?: string; thinkingLevel?: string | null }>;
}

const PREFS_KEY = "hb.prefs";

function readPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { lastSelection: {} };
    const parsed = JSON.parse(raw) as Preferences;
    return { lastSelection: parsed.lastSelection ?? {} };
  } catch {
    return { lastSelection: {} };
  }
}

function writePrefs(prefs: Preferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function readLastSelection(projectId: string): Preferences["lastSelection"][string] {
  return readPrefs().lastSelection[projectId] ?? {};
}

export function rememberSelection(projectId: string, selection: Preferences["lastSelection"][string]): void {
  const prefs = readPrefs();
  prefs.lastSelection[projectId] = selection;
  writePrefs(prefs);
}

/** Drafts are per session and never contain full conversation history. */
export function readDraft(sessionId: string): string {
  try {
    return sessionStorage.getItem(`hb.draft.${sessionId}`) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(sessionId: string, text: string): void {
  try {
    if (text.length === 0) sessionStorage.removeItem(`hb.draft.${sessionId}`);
    else sessionStorage.setItem(`hb.draft.${sessionId}`, text);
  } catch {
    // ignore
  }
}
