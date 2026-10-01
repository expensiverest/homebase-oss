import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { AdapterError } from "@homebase/adapter-sdk";
import { timestampSchema, type AgentMessage, type AgentToolCall } from "@homebase/protocol";

/**
 * Claude Code transcript access.
 *
 * IMPORTANT: the `~/.claude/projects/<project>/<session>.jsonl` files are an
 * internal format, not a public contract. This module is intentionally tolerant: unknown entry types,
 * malformed lines, sidechains, meta entries, and thinking blocks are skipped,
 * and the format is never treated as stable. Message history and session
 * discovery are the only consumers, both kept inside this adapter.
 */

export const CLAUDE_UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Project directory encoding: every non-alphanumeric character becomes `-`. */
export function encodeProjectDir(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

export function resolveClaudeConfigDir(override: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (override && override.trim().length > 0) return override;
  const fromEnv = env.CLAUDE_CONFIG_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.join(homedir(), ".claude");
}

export interface TranscriptSummary {
  nativeId: string;
  mtimeMs: number;
  size: number;
  title: string | null;
}

export interface LocatedTranscript {
  filePath: string;
  cwd: string | null;
  mtimeMs: number;
}

const TITLE_SCAN_BYTES = 256 * 1024;

function readPrefix(filePath: string, maxBytes: number): string {
  try {
    const size = statSync(filePath).size;
    const fd = readFileSync(filePath, { flag: "r" });
    return fd.subarray(0, Math.min(size, maxBytes)).toString("utf8");
  } catch {
    return "";
  }
}

interface TranscriptMetadata {
  cwd: string | null;
  title: string | null;
  firstPrompt: string | null;
}

function scanMetadata(text: string): TranscriptMetadata {
  const metadata: TranscriptMetadata = { cwd: null, title: null, firstPrompt: null };
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // partial or malformed line
    }
    if (metadata.cwd === null && typeof entry.cwd === "string" && entry.cwd.length > 0) {
      metadata.cwd = entry.cwd;
    }
    if (entry.type === "ai-title" && typeof entry.aiTitle === "string" && entry.aiTitle.trim().length > 0) {
      metadata.title = entry.aiTitle.trim(); // last one wins
    }
    if (
      metadata.firstPrompt === null &&
      entry.type === "user" &&
      typeof (entry.message as { content?: unknown })?.content === "string"
    ) {
      const textContent = (entry.message as { content: string }).content.trim();
      if (textContent.length > 0 && !textContent.startsWith("<")) {
        metadata.firstPrompt = textContent.length > 80 ? `${textContent.slice(0, 79)}…` : textContent;
      }
    }
  }
  return metadata;
}

/** Lists transcript summaries for one project directory (newest first). */
export function listTranscriptSummaries(projectPath: string, configDir: string): TranscriptSummary[] {
  const dir = path.join(configDir, "projects", encodeProjectDir(projectPath));
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith(".jsonl"));
  } catch {
    return [];
  }

  const summaries: TranscriptSummary[] = [];
  for (const file of files) {
    const nativeId = file.slice(0, -".jsonl".length);
    if (!CLAUDE_UUID_PATTERN.test(nativeId)) continue;
    const filePath = path.join(dir, file);
    let size = 0;
    let mtimeMs = 0;
    try {
      const stat = statSync(filePath);
      size = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch {
      continue;
    }
    const metadata = scanMetadata(readPrefix(filePath, TITLE_SCAN_BYTES));
    summaries.push({ nativeId, mtimeMs, size, title: metadata.title ?? metadata.firstPrompt });
  }
  return summaries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Scans all transcript directories for one native session id. Used after a
 * Host restart when the session is not in the in-memory index. The recorded
 * cwd is only a hint; callers must still resolve it through the Host project
 * registry before exposing anything.
 */
export function locateTranscript(configDir: string, nativeId: string): LocatedTranscript | null {
  if (!CLAUDE_UUID_PATTERN.test(nativeId)) return null;
  const projectsRoot = path.join(configDir, "projects");
  let dirs: string[];
  try {
    dirs = readdirSync(projectsRoot);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const filePath = path.join(projectsRoot, dir, `${nativeId}.jsonl`);
    if (!existsSync(filePath)) continue;
    try {
      const stat = statSync(filePath);
      const metadata = scanMetadata(readPrefix(filePath, 64 * 1024));
      return { filePath, cwd: metadata.cwd, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }
  return null;
}

interface MutableAssistant {
  id: string;
  createdAt: string;
  model: string | null;
  parts: AgentMessage["parts"];
  toolIndex: Map<string, number>;
}

const SKIP_ENTRYPOINTS = new Set(["claude-desktop", "claude-vscode", "desktop", "vscode"]);

/**
 * Builds normalized messages from a transcript file. Tolerant by design:
 * anything unrecognized is skipped rather than failing the page.
 */
export function readTranscriptMessages(
  filePath: string,
  nativeSessionId: string,
  maxBytes = 16 * 1024 * 1024,
): AgentMessage[] {
  let text: string;
  try {
    const size = statSync(filePath).size;
    if (size > maxBytes) {
      throw new AdapterError("provider_error", "The Claude transcript is too large to read for history.");
    }
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError("session_not_found", "The Claude transcript could not be read.");
  }

  const messages: AgentMessage[] = [];
  const assistants = new Map<string, MutableAssistant>();
  const toolOwners = new Map<string, string>();
  let lastTimestamp = new Date(0).toISOString();

  const ensureAssistant = (id: string, createdAt: string): MutableAssistant => {
    let assistant = assistants.get(id);
    if (!assistant) {
      assistant = { id, createdAt, model: null, parts: [], toolIndex: new Map() };
      assistants.set(id, assistant);
      // Reserve its conversation slot at first occurrence, not after all user
      // lines. Repeated content/tool frames update the same parts in that slot.
      messages.push({
        id,
        sessionId: nativeSessionId,
        role: "assistant",
        createdAt,
        state: "completed",
        parts: assistant.parts,
      });
    }
    return assistant;
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // partial final line etc.
    }
    if (entry.isSidechain === true || entry.isMeta === true) continue;
    const entrypoint = typeof entry.entrypoint === "string" ? entry.entrypoint : null;
    if (entrypoint && SKIP_ENTRYPOINTS.has(entrypoint)) continue;
    const timestamp = timestampSchema.safeParse(entry.timestamp).success ? String(entry.timestamp) : lastTimestamp;
    lastTimestamp = timestamp;

    const type = entry.type;
    if (type === "user") {
      const message = entry.message as { content?: unknown; id?: unknown } | undefined;
      const content = message?.content;
      const userText =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((block) => block?.type === "text" && typeof block.text === "string")
                .map((block) => block.text)
                .join("\n\n")
            : "";
      if (userText.trim().length > 0) {
        messages.push({
          id: typeof message?.id === "string" ? `ccu_${message.id}` : `ccu_${entry.uuid ?? messages.length}`,
          sessionId: nativeSessionId,
          role: "user",
          createdAt: timestamp,
          state: "completed",
          parts: [{ type: "text", id: `ccu_part_${messages.length}`, text: userText }],
        });
      }
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type !== "tool_result") continue;
          const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
          if (!toolUseId) continue;
          const ownerId = toolOwners.get(toolUseId);
          const owner = ownerId ? assistants.get(ownerId) : undefined;
          if (!owner) continue;
          const index = owner.toolIndex.get(toolUseId);
          if (index === undefined) continue;
          const part = owner.parts[index];
          if (part?.type !== "tool_call") continue;
          const isError = block.is_error === true;
          part.toolCall = {
            ...part.toolCall,
            status: isError ? "failed" : "completed",
            output: toolResultToOutput(block.content),
            ...(isError ? { error: toolResultText(block.content) } : {}),
            completedAt: timestamp,
          };
        }
      }
      continue;
    }

    if (type === "assistant") {
      const message = entry.message as { id?: unknown; model?: unknown; content?: unknown } | undefined;
      const model = typeof message?.model === "string" ? message.model : null;
      // `<synthetic>` entries are provider-generated noise (login prompts,
      // notifications), never user-visible conversation.
      if (model !== null && model.startsWith("<")) continue;
      const messageId =
        typeof message?.id === "string"
          ? message.id
          : typeof entry.uuid === "string"
            ? entry.uuid
            : `cca_${assistants.size}`;
      if (model) {
        ensureAssistant(messageId, timestamp).model = model;
      } else {
        ensureAssistant(messageId, timestamp);
      }
      const assistant = ensureAssistant(messageId, timestamp);
      const blocks = Array.isArray(message?.content) ? (message.content as Array<Record<string, unknown>>) : [];
      for (const block of blocks) {
        if (block.type === "text" && typeof block.text === "string") {
          assistant.parts.push({ type: "text", id: `${messageId}:text:${assistant.parts.length}`, text: block.text });
        } else if (block.type === "tool_use") {
          const toolUseId = typeof block.id === "string" ? block.id : `${messageId}:tool:${assistant.parts.length}`;
          const name = typeof block.name === "string" ? block.name : "tool";
          const toolCall: AgentToolCall = {
            id: toolUseId,
            name,
            title: name,
            status: "running",
            input: (block.input as AgentToolCall["input"]) ?? null,
            startedAt: timestamp,
          };
          assistant.toolIndex.set(toolUseId, assistant.parts.length);
          assistant.parts.push({ type: "tool_call", id: toolUseId, toolCall });
          toolOwners.set(toolUseId, messageId);
        }
        // thinking blocks are ignored: they carry no user-visible text.
      }
    }
  }

  // Transcript order is authoritative, including equal/missing timestamps.
  return messages;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 500);
  if (!Array.isArray(content)) return "The tool failed.";
  const texts = content
    .map((block) =>
      typeof block === "string"
        ? block
        : typeof block === "object" && block !== null && (block as { type?: string }).type === "text"
          ? String((block as { text?: unknown }).text ?? "")
          : "",
    )
    .filter((entry) => entry.length > 0);
  const joined = texts.join("\n").trim();
  return joined.length > 0 ? joined.slice(0, 500) : "The tool failed.";
}

function toolResultToOutput(content: unknown): AgentToolCall["output"] {
  if (typeof content === "string") return content.length > 0 ? { type: "text", text: content } : null;
  if (!Array.isArray(content)) return null;
  const mapped: Array<Record<string, string> | null> = content.map((block): Record<string, string> | null => {
    if (typeof block === "string") return { type: "text", text: block };
    if (typeof block !== "object" || block === null) return null;
    const record = block as { type?: unknown; text?: unknown; name?: unknown; mime?: unknown };
    if (record.type === "text" && typeof record.text === "string") return { type: "text", text: record.text };
    if (record.type === "image")
      return { type: "image", name: typeof record.name === "string" ? record.name : "image" };
    return null;
  });
  const filled = mapped.filter((entry): entry is Record<string, string> => entry !== null);
  return filled.length > 0 ? (filled as unknown as AgentToolCall["output"]) : null;
}
