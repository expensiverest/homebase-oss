import type {
  AgentApprovalRequest,
  AgentPlan,
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

const DETAIL_KEYS = ["command", "file_path", "pattern", "query", "url", "path", "description", "text"];

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

/** One step of a run's execution trace, in the order the agent produced it. */
export type TraceStep =
  | { kind: "reasoning"; id: string; text: string; streaming: boolean }
  | { kind: "tool"; id: string; tool: AgentToolCall }
  | { kind: "text"; id: string; text: string };

export interface TimelineWorkItem {
  kind: "work";
  id: string;
  /** Reasoning, tool calls and interim updates, chronological; tools de-duplicated by call id. */
  steps: TraceStep[];
  /** The newest plan the run reported, if any. */
  plan: AgentPlan | null;
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
 * The execution trace of a run: reasoning, tool calls and interim text in the
 * order they arrived. The last message's text is the answer, not a trace step.
 * A tool call reported more than once keeps its latest state at its first slot.
 */
export function buildTrace(run: AgentMessage[]): { steps: TraceStep[]; plan: AgentPlan | null } {
  const steps: TraceStep[] = [];
  const toolIndex = new Map<string, number>();
  let plan: AgentPlan | null = null;
  const last = run[run.length - 1];
  for (const message of run) {
    const streaming = message.state === "streaming";
    for (const part of message.parts) {
      if (part.type === "reasoning") {
        if (part.text.trim().length > 0 || streaming) {
          steps.push({ kind: "reasoning", id: part.id, text: part.text, streaming });
        }
      } else if (part.type === "tool_call") {
        const existing = toolIndex.get(part.toolCall.id);
        if (existing === undefined) {
          toolIndex.set(part.toolCall.id, steps.length);
          steps.push({ kind: "tool", id: part.toolCall.id, tool: part.toolCall });
        } else {
          steps[existing] = { kind: "tool", id: part.toolCall.id, tool: part.toolCall };
        }
      } else if (part.type === "text" && message !== last && part.text.trim().length > 0) {
        steps.push({ kind: "text", id: part.id, text: part.text });
      } else if (part.type === "plan") {
        plan = part.plan;
      }
    }
  }
  return { steps, plan };
}

/**
 * Groups a conversation into user prompts, each run's work (its trace), and
 * the final answer of each run.
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
    const finalText = last ? assistantText(last) : "";
    const folded = run.slice(0, -1);
    const tools = collectTools(run);
    const reasoning = reasoningCount(run);
    const foldedTexts = folded.filter((entry) => assistantText(entry).length > 0).length;
    const trace = buildTrace(run);

    // A run gets a work item only when there is something besides the answer;
    // a simple answer stays a simple answer.
    if (trace.steps.length > 0 || trace.plan) {
      items.push({
        kind: "work",
        id: `work:${run[0]?.id ?? "run"}`,
        steps: trace.steps,
        plan: trace.plan,
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

// --- display names ----------------------------------------------------------

/** Providers that can start sessions here, limited to the project's providers when it names any. */
export function usableProviders(providers: AgentProvider[], available?: string[] | null): AgentProvider[] {
  const allowed = available && available.length > 0 ? new Set(available) : null;
  return providers.filter(
    (provider) => provider.installed && provider.compatible && (!allowed || allowed.has(provider.id)),
  );
}

/** A thinking level's display name: the catalog's name, capitalised when it is a bare id. */
export function levelLabel(model: AgentModel | undefined, level: string): string {
  const name = model?.thinkingLevels?.find((entry) => entry.id === level)?.name ?? level;
  return /[A-Z]/.test(name) ? name : name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * A readable model name: the catalog name when known, otherwise the id's last
 * segment ("example-provider/aurora-1" → "Aurora 1").
 */
export function modelDisplayName(modelId: string | null | undefined, models?: AgentModel[]): string | null {
  if (!modelId) return null;
  const known = models?.find((model) => model.id === modelId)?.name;
  if (known) return known;
  const tail = modelId.split("/").pop() ?? modelId;
  return tail
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

// --- active-run presentation ------------------------------------------------

export type ActiveRunView =
  { mode: "none" } | { mode: "orbit"; label: string } | { mode: "trace"; workId: string | null };

/**
 * One narrative for a running turn:
 *
 *   not running                       → none (history renders folded work)
 *   running, nothing visible yet      → orbit ("Starting…", or "Working…" once
 *                                        the assistant message exists)
 *   reasoning, tools, plan or text    → trace (Thinking / Task Rows / text);
 *                                        the orbit is gone
 */
export function activeRunView(items: TimelineItem[], running: boolean): ActiveRunView {
  if (!running) return { mode: "none" };
  let start = items.length;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === "user") break;
    start = index;
  }
  const run = items.slice(start);
  const work = run.find((item): item is TimelineWorkItem => item.kind === "work");
  const final = run.find((item) => item.kind === "final") as { kind: "final"; message: AgentMessage } | undefined;
  const hasTrace = Boolean(work && (work.steps.length > 0 || work.plan));
  const hasText = final ? assistantText(final.message).length > 0 : false;
  const hasOther = final
    ? final.message.parts.some((part) => part.type === "image" || part.type === "file" || part.type === "error")
    : false;
  if (!hasTrace && !hasText && !hasOther) {
    return { mode: "orbit", label: final ? "Working…" : "Starting…" };
  }
  return { mode: "trace", workId: work?.id ?? null };
}

// --- sub-agents ---------------------------------------------------------------

/**
 * A sub-agent the model spawned. Providers report these as ordinary tool calls
 * (Claude's `Task`, OpenCode's `task`), so this is derived from normalized tool
 * calls and needs no provider-specific event.
 */
export interface SubagentView {
  id: string;
  title: string;
  /** The kind of agent asked for (e.g. "explore"), when the provider says. */
  kind: string | null;
  status: AgentToolCall["status"];
  prompt: string | null;
  result: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** The sub-agent's own thread (a child session), when the provider exposes one. */
  threadId: string | null;
}

const SUBAGENT_TOOL_NAMES = new Set(["task", "agent", "subagent"]);

export function isSubagentTool(tool: AgentToolCall): boolean {
  return SUBAGENT_TOOL_NAMES.has(tool.name.toLowerCase());
}

function inputString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function outputText(output: AgentToolCall["output"]): string | null {
  if (output == null) return null;
  if (typeof output === "string") return output.trim() || null;
  if (typeof output === "object" && !Array.isArray(output) && typeof (output as { text?: unknown }).text === "string") {
    return (output as { text: string }).text.trim() || null;
  }
  return null;
}

export function subagentsOf(tools: AgentToolCall[]): SubagentView[] {
  return tools.filter(isSubagentTool).map((tool) => ({
    id: tool.id,
    title: shorten(
      inputString(tool.input, "description") ?? (tool.title && tool.title !== tool.name ? tool.title : "Sub-agent"),
      90,
    ),
    kind: inputString(tool.input, "subagent_type"),
    status: tool.status,
    prompt: inputString(tool.input, "prompt"),
    result: outputText(tool.output),
    error: tool.error ?? null,
    startedAt: tool.startedAt ?? null,
    completedAt: tool.completedAt ?? null,
    threadId: tool.childSessionId ?? null,
  }));
}

export interface SubagentSummary {
  total: number;
  working: number;
  done: number;
  failed: number;
}

export function subagentSummary(agents: SubagentView[]): SubagentSummary {
  let working = 0;
  let done = 0;
  let failed = 0;
  for (const agent of agents) {
    if (agent.status === "running") working += 1;
    else if (agent.status === "completed") done += 1;
    else failed += 1;
  }
  return { total: agents.length, working, done, failed };
}

/** The sub-agents of the run after the newest user prompt: what the user is currently watching. */
export function currentSubagents(items: TimelineItem[]): SubagentView[] {
  let lastUser = -1;
  items.forEach((item, index) => {
    if (item.kind === "user") lastUser = index;
  });
  const tools: AgentToolCall[] = [];
  for (const item of items.slice(lastUser + 1)) {
    if (item.kind === "work") tools.push(...item.tools);
  }
  return subagentsOf(tools);
}
