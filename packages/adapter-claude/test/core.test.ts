import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseClaudeConfig } from "../src/config.js";
import { CLAUDE_TESTED_VERSION, parseClaudeVersion, versionCompatibility } from "../src/errors.js";
import {
  encodeProjectDir,
  listTranscriptSummaries,
  locateTranscript,
  readTranscriptMessages,
  resolveClaudeConfigDir,
} from "../src/history/transcripts.js";
import { toAgentModel } from "../src/models.js";
import { cliMode, isSafeMode, normalizeMode } from "../src/modes.js";
import { buildQuestionUpdatedInput, nativeQuestions, toAgentQuestions } from "../src/permissions/mapping.js";
import { matchesRule, resourcesOf, savePatterns } from "../src/permissions/policy.js";

const SESSION_ID = "0f0f0f0f-1111-2222-3333-444444444444";

describe("config, version, and modes", () => {
  it("validates provider config with safe defaults and rejects bad values", () => {
    const config = parseClaudeConfig({});
    expect(config.executable).toBe("claude");
    expect(config.idleTimeoutMs).toBe(600_000);
    expect(() => parseClaudeConfig({ idleTimeoutMs: -5 })).toThrowError(/Invalid claude provider configuration/);
  });

  it("parses versions and warns for newer-than-tested", () => {
    expect(parseClaudeVersion("2.1.268 (Claude Code)")).toBe("2.1.268");
    expect(versionCompatibility("2.1.268").compatible).toBe(true);
    expect(versionCompatibility("2.1.300").warning).toContain(CLAUDE_TESTED_VERSION);
    expect(versionCompatibility("1.9.0").compatible).toBe(false);
  });

  it("exposes only safe modes and normalizes CLI spellings", () => {
    expect(cliMode("default")).toBe("manual");
    expect(cliMode("acceptEdits")).toBe("acceptEdits");
    expect(cliMode("bypassPermissions")).toBeNull();
    expect(cliMode("dontAsk")).toBeNull();
    expect(isSafeMode("auto")).toBe(true);
    expect(normalizeMode("manual")).toBe("default");
    expect(normalizeMode("default")).toBe("default");
    expect(normalizeMode("unknown-thing")).toBe("default");
  });

  it("maps CLI-advertised models with their real effort levels", () => {
    const model = toAgentModel({
      value: "sonnet",
      displayName: "Claude Sonnet",
      supportsEffort: true,
      supportedEffortLevels: ["low", "high"],
    });
    expect(model.provider).toBe("claude");
    expect(model.id).toBe("sonnet");
    expect(model.thinkingLevels?.map((level) => level.id)).toEqual(["low", "high"]);
    expect(model.inputCapabilities).toEqual({ text: true, image: true, file: false });

    const haiku = toAgentModel({ value: "haiku", supportsEffort: false });
    expect(haiku.thinkingLevels).toBeUndefined();
  });
});

describe("permission policy", () => {
  it("extracts resources per tool", () => {
    expect(resourcesOf("Bash", { command: "git status" })).toEqual(["git status"]);
    expect(resourcesOf("Write", { file_path: "C:\\demo\\src\\a.ts" })).toEqual(["C:\\demo\\src\\a.ts"]);
    expect(resourcesOf("WebFetch", { url: "https://example.com/page" })).toEqual(["https://example.com/page"]);
    expect(resourcesOf("Glob", { pattern: "**" })).toEqual([]);
  });

  it("derives session-scoped always patterns", () => {
    expect(savePatterns("Bash", { command: "git rebase main" })).toEqual(["git rebase *"]);
    expect(savePatterns("Write", { file_path: "C:\\demo\\src\\a.ts" })).toEqual(["C:\\demo\\src\\*"]);
    expect(savePatterns("WebFetch", { url: "https://example.com/x" })).toEqual(["example.com/*"]);
    expect(savePatterns("Glob", {})).toEqual(["Glob *"]);
  });

  it("matches rules with separator boundaries and no directory bleed", () => {
    const rules = [
      { tool: "Write", pattern: "C:\\demo\\src\\*" },
      { tool: "Bash", pattern: "git rebase *" },
    ];
    expect(matchesRule(rules, "Write", { file_path: "C:\\demo\\src\\a.ts" })).toBe(true);
    expect(matchesRule(rules, "Write", { file_path: "C:\\demo\\srcs\\a.ts" })).toBe(false);
    expect(matchesRule(rules, "Write", { file_path: "C:\\demo\\lib\\a.ts" })).toBe(false);
    expect(matchesRule(rules, "Bash", { command: "git rebase --onto main" })).toBe(true);
    expect(matchesRule(rules, "Bash", { command: "git rebases" })).toBe(false);
    expect(matchesRule([{ tool: "Glob", pattern: "Glob *" }], "Glob", { pattern: "x" })).toBe(true);
  });
});

describe("question mapping", () => {
  const input = {
    questions: [
      {
        question: "Which db?",
        header: "Database",
        options: [{ label: "SQLite", description: "local" }, { label: "Postgres" }],
        multiSelect: false,
      },
      { question: "Extras?", header: "Extras", options: [{ label: "A" }, { label: "B" }], multiSelect: true },
    ],
  };

  it("maps native questions to neutral questions", () => {
    const questions = toAgentQuestions(nativeQuestions(input));
    expect(questions[0]?.kind).toBe("single_select");
    expect(questions[0]?.options?.map((option) => option.label)).toEqual(["SQLite", "Postgres"]);
    expect(questions[1]?.kind).toBe("multi_select");
  });

  it("builds updatedInput with answers keyed by question text", () => {
    const questions = nativeQuestions(input);
    const updated = buildQuestionUpdatedInput(input, questions, [
      { questionId: "q0", selectedOptionIds: ["SQLite"] },
      { questionId: "q1", selectedOptionIds: ["A", "B"] },
    ]);
    expect(updated.answers).toEqual({ "Which db?": "SQLite", "Extras?": "A, B" });
    expect(Array.isArray(updated.questions)).toBe(true);
  });
});

describe("transcripts", () => {
  it("reads tolerant history: merges assistant frames, binds tool results, skips noise", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hb-claude-tx-"));
    try {
      const file = path.join(dir, `${SESSION_ID}.jsonl`);
      const lines = [
        JSON.stringify({ type: "ai-title", aiTitle: "Example session", sessionId: SESSION_ID }),
        JSON.stringify({
          type: "user",
          uuid: "u1",
          sessionId: SESSION_ID,
          cwd: "/home/example/projects/demo",
          entrypoint: "sdk-cli",
          isSidechain: false,
          timestamp: "2026-01-01T00:00:00.000Z",
          message: { content: "Do the thing" },
        }),
        "not json",
        JSON.stringify({
          type: "assistant",
          uuid: "a1",
          sessionId: SESSION_ID,
          cwd: "/home/example/projects/demo",
          entrypoint: "sdk-cli",
          isSidechain: false,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: { id: "msg_1", model: "claude-sonnet-5", content: [{ type: "text", text: "Working" }] },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "a2",
          sessionId: SESSION_ID,
          cwd: "/home/example/projects/demo",
          entrypoint: "sdk-cli",
          isSidechain: false,
          timestamp: "2026-01-01T00:00:02.000Z",
          message: {
            id: "msg_1",
            model: "claude-sonnet-5",
            content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: "a.ts" } }],
          },
        }),
        JSON.stringify({
          type: "user",
          uuid: "u2",
          sessionId: SESSION_ID,
          cwd: "/home/example/projects/demo",
          entrypoint: "sdk-cli",
          isSidechain: false,
          timestamp: "2026-01-01T00:00:03.000Z",
          message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "a3",
          sessionId: SESSION_ID,
          cwd: "/home/example/projects/demo",
          entrypoint: "sdk-cli",
          isSidechain: true,
          timestamp: "2026-01-01T00:00:04.000Z",
          message: { id: "msg_side", content: [{ type: "text", text: "subagent noise" }] },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "a4",
          sessionId: SESSION_ID,
          cwd: "/home/example/projects/demo",
          entrypoint: "sdk-cli",
          isMeta: true,
          timestamp: "2026-01-01T00:00:04.500Z",
          message: { id: "msg_meta", content: [{ type: "text", text: "meta noise" }] },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "a5",
          sessionId: SESSION_ID,
          cwd: "/home/example/projects/demo",
          entrypoint: "sdk-cli",
          isSidechain: false,
          timestamp: "2026-01-01T00:00:05.000Z",
          message: { id: "msg_2", model: "<synthetic>", content: [{ type: "text", text: "synthetic noise" }] },
        }),
      ].join("\n");
      writeFileSync(file, lines, "utf8");

      const messages = readTranscriptMessages(file, SESSION_ID);
      const roles = messages.map((message) => message.role);
      expect(roles).toEqual(["user", "assistant"]);
      const assistant = messages.find((message) => message.id === "msg_1");
      expect(assistant?.parts.some((part) => part.type === "text" && part.text === "Working")).toBe(true);
      const tool = assistant?.parts.find((part) => part.type === "tool_call");
      expect(tool?.type === "tool_call" ? tool.toolCall.status : "").toBe("completed");
      expect(JSON.stringify(messages)).not.toContain("subagent noise");
      expect(JSON.stringify(messages)).not.toContain("meta noise");
      expect(JSON.stringify(messages)).not.toContain("synthetic noise");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists and locates transcripts by project with titles", () => {
    const configDir = mkdtempSync(path.join(tmpdir(), "hb-claude-cfg-"));
    try {
      const projectPath = "/home/example/projects/demo";
      const dir = path.join(configDir, "projects", encodeProjectDir(projectPath));
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, `${SESSION_ID}.jsonl`),
        `${JSON.stringify({ type: "user", cwd: projectPath, entrypoint: "sdk-cli", timestamp: "2026-01-01T00:00:00.000Z", message: { content: "First prompt title fallback" } })}\n`,
        "utf8",
      );
      writeFileSync(path.join(dir, "not-a-session.jsonl"), "{}", "utf8");

      const summaries = listTranscriptSummaries(projectPath, configDir);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.nativeId).toBe(SESSION_ID);
      expect(summaries[0]?.title).toContain("First prompt title fallback");

      const located = locateTranscript(configDir, SESSION_ID);
      expect(located?.cwd).toBe(projectPath);
      expect(locateTranscript(configDir, "not-a-uuid")).toBeNull();
      expect(resolveClaudeConfigDir(undefined, { CLAUDE_CONFIG_DIR: configDir })).toBe(configDir);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
