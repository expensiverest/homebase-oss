import type {
  AgentApprovalRequest,
  AgentCapabilities,
  AgentMessage,
  AgentModel,
  AgentProvider,
  AgentSession,
  AgentToolCall,
} from "@homebase/protocol";

// --- provider + capability helpers -----------------------------------------

export function supports(provider: AgentProvider | undefined, key: keyof AgentCapabilities): boolean {
  return provider?.capabilities[key] === true;
}

export interface AttachmentRules {
  images: boolean;
  files: boolean;
}

/**
 * Attachment eligibility from capabilities plus model metadata only. Provider
 * identity is never consulted.
 */
export function attachmentRules(provider: AgentProvider | undefined, model: AgentModel | undefined): AttachmentRules {
  const modelInput = model?.inputCapabilities;
  return {
    images: supports(provider, "imageInput") && modelInput?.image !== false,
    files: supports(provider, "attachments") && modelInput?.file !== false,
  };
}

export function validThinkingLevels(model: AgentModel | undefined): string[] {
  return (model?.thinkingLevels ?? []).map((level) => level.id);
}

/** Returns the level to keep, or null when the current choice is invalid. */
export function resolveThinkingLevel(
  model: AgentModel | undefined,
  requested: string | null | undefined,
): string | null {
  const levels = validThinkingLevels(model);
  if (requested && levels.includes(requested)) return requested;
  return model?.defaultThinkingLevel && levels.includes(model.defaultThinkingLevel) ? model.defaultThinkingLevel : null;
}

// --- status language --------------------------------------------------------

export type StatusTone = "working" | "waiting" | "failed" | "muted" | "ok";

export function sessionStatus(state: AgentSession["state"]): { label: string; tone: StatusTone } {
  switch (state) {
    case "working":
      return { label: "Working", tone: "working" };
    case "waiting":
      return { label: "Needs you", tone: "waiting" };
    case "failed":
      return { label: "Failed", tone: "failed" };
    case "completed":
      return { label: "Completed", tone: "ok" };
    case "unknown":
      return { label: "Status unknown", tone: "muted" };
    case "idle":
    default:
      return { label: "Idle", tone: "muted" };
  }
}

export function providerStatus(provider: AgentProvider): { label: string; tone: StatusTone; detail: string | null } {
  if (!provider.installed) {
    return { label: "Unavailable", tone: "failed", detail: provider.warning ?? null };
  }
  if (!provider.compatible) {
    return { label: "Incompatible version", tone: "failed", detail: provider.warning ?? null };
  }
  if (provider.authenticated === false) {
    return { label: "Sign in required", tone: "waiting", detail: provider.warning ?? null };
  }
  if (provider.warning) {
    return { label: "Ready", tone: "ok", detail: provider.warning };
  }
  return { label: "Ready", tone: "ok", detail: null };
}

// --- tool presentation ------------------------------------------------------

export interface ToolPresentation {
  verb: string;
  detail: string | null;
  tone: StatusTone;
}

const TOOL_VERBS: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  multiedit: "Edit",
  notebookedit: "Edit",
  bash: "Run",
  shell: "Run",
  powershell: "Run",
  run: "Run",
  grep: "Search",
  search: "Search",
  glob: "Find",
  find: "Find",
  webfetch: "Fetch",
  fetch: "Fetch",
  websearch: "Search",
  task: "Agent",
  agent: "Agent",
  subagent: "Agent",
  todowrite: "Plan",
  todo: "Plan",
  plan: "Plan",
  question: "Ask",
  askuserquestion: "Ask",
};

function firstString(input: unknown, keys: string[]): string | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

const DETAIL_KEYS = ["command", "file_path", "path", "pattern", "query", "url", "description", "text"];

export function toolPresentation(tool: AgentToolCall): ToolPresentation {
  const verb =
    TOOL_VERBS[tool.name.toLowerCase()] ??
    tool.name.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  const detail = tool.title && tool.title !== tool.name ? tool.title : firstString(tool.input, DETAIL_KEYS);
  const tone: StatusTone = tool.status === "running" ? "working" : tool.status === "completed" ? "muted" : "failed";
  return { verb, detail: detail ? shorten(detail, 90) : null, tone };
}

export function shorten(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

// --- timeline folding -------------------------------------------------------

export interface TimelineWorkItem {
  kind: "work";
  id: string;
  tools: AgentToolCall[];
  reasoningCount: number;
  foldedTextCount: number;
  active: boolean;
  startedAt: string;
  endedAt: string | null;
}

export type TimelineItem =
  | { kind: "user"; id: string; message: AgentMessage }
  | { kind: "final"; id: string; message: AgentMessage }
  | TimelineWorkItem;

function assistantText(message: AgentMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n\n")
    .trim();
}

function collectTools(messages: AgentMessage[]): AgentToolCall[] {
  const tools = new Map<string, AgentToolCall>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool_call") tools.set(part.toolCall.id, part.toolCall);
    }
  }
  return [...tools.values()];
}

function reasoningCount(messages: AgentMessage[]): number {
  return messages.reduce(
    (count, message) =>
      count + message.parts.filter((part) => part.type === "reasoning" && part.text.trim().length > 0).length,
    0,
  );
}

/**
 * Groups a conversation into user prompts, folded completed work, and the
 * final answer of each run. The newest run stays expanded while it streams.
 */
export function foldTimeline(messages: AgentMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!message) break;

    if (message.role === "user") {
      items.push({ kind: "user", id: message.id, message });
      index += 1;
      continue;
    }

    // Collect the run: assistant messages until the next user message.
    const run: AgentMessage[] = [];
    while (index < messages.length) {
      const candidate = messages[index];
      if (!candidate || candidate.role === "user") break;
      run.push(candidate);
      index += 1;
    }
    if (run.length === 0) continue;

    const last = run[run.length - 1];
    const followingUser = messages[index]?.role === "user";
    const finished = !followingUser || last?.state !== "streaming";
    const finalText = last ? assistantText(last) : "";
    const folded = run.slice(0, -1);
    const tools = collectTools(run);
    const reasoning = reasoningCount(run);
    const foldedTexts = folded.filter((entry) => assistantText(entry).length > 0).length;

    // Work only folds when there is something to fold; a simple answer stays a
    // simple answer.
    if (finished && (tools.length > 0 || reasoning > 0 || foldedTexts > 0)) {
      items.push({
        kind: "work",
        id: `work:${run[0]?.id ?? "run"}`,
        tools,
        reasoningCount: reasoning,
        foldedTextCount: foldedTexts,
        active: false,
        startedAt: run[0]?.createdAt ?? new Date().toISOString(),
        endedAt: last?.updatedAt ?? null,
      });
    }

    if (last && finalText.length > 0) {
      items.push({ kind: "final", id: last.id, message: last });
    } else if (last && last.state === "streaming") {
      items.push({ kind: "final", id: last.id, message: last });
    }
  }

  return items;
}

export function runIsActive(items: TimelineItem[]): boolean {
  const last = items[items.length - 1];
  return last?.kind === "final" && last.message.state === "streaming";
}

// --- approvals / links ------------------------------------------------------

export function approvalAction(request: AgentApprovalRequest): string {
  const detail = request.detail ?? request.title;
  return shorten(detail, 120);
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, "https://homebase.invalid");
    return SAFE_PROTOCOLS.has(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

// --- project summaries ------------------------------------------------------

export interface ProjectSummary {
  total: number;
  working: number;
  waiting: number;
  failed: number;
  lastProvider: string | null;
}

export function summarizeSessions(sessions: AgentSession[]): ProjectSummary {
  const summary: ProjectSummary = { total: sessions.length, working: 0, waiting: 0, failed: 0, lastProvider: null };
  for (const session of sessions) {
    if (session.state === "working") summary.working += 1;
    else if (session.state === "waiting") summary.waiting += 1;
    else if (session.state === "failed") summary.failed += 1;
  }
  summary.lastProvider = sessions[0]?.provider ?? null;
  return summary;
}
