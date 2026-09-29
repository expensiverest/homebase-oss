import { describe, expect, it } from "vitest";

import {
  catalogFromInitializeMeta,
  mapPermissionOptions,
  mergeToolCall,
  modelsFromConfigOptions,
  planFromEntries,
  selectionFromConfigOptions,
} from "../src/mapper.js";

/**
 * Scrubbed capture of Grok 1.0.41 `initialize` `_meta.modelState` (model names
 * and effort levels only; no account or machine data).
 */
const GROK_MODEL_STATE = {
  currentModelId: "grok-4.7",
  availableModels: [
    {
      modelId: "grok-4.7",
      name: "Grok 4.7",
      description: "Frontier model",
      _meta: {
        totalContextTokens: 256_000,
        supportsReasoningEffort: true,
        reasoningEffort: "low",
        reasoningEfforts: [
          { id: "high", value: "high", label: "High", description: "Thorough.", default: true },
          { id: "low", value: "low", label: "Low", description: "Fastest.", default: false },
        ],
      },
    },
    { modelId: "grok-4.6", name: "Grok 4.6", _meta: { totalContextTokens: 500_000 } },
  ],
};

describe("initialize meta catalog", () => {
  it("maps the verified Grok modelState shape", () => {
    const { models } = catalogFromInitializeMeta({ modelState: GROK_MODEL_STATE }, "grok");
    expect(models.map((model) => model.id)).toEqual(["grok-4.7", "grok-4.6"]);
    expect(models[0]?.contextWindow).toBe(256_000);
    expect(models[0]?.thinkingLevels?.map((level) => level.id)).toEqual(["high", "low"]);
    expect(models[0]?.defaultThinkingLevel).toBe("low");
    expect(models[1]?.description).toBeUndefined();
    expect(models[1]?.thinkingLevels).toBeUndefined();
  });

  it("ignores unrecognized metadata shapes instead of guessing", () => {
    expect(catalogFromInitializeMeta({ modelState: { weird: true } }, "grok").models).toEqual([]);
    expect(catalogFromInitializeMeta(null, "grok").models).toEqual([]);
  });

  it("maps meta modes when present", () => {
    const { modes } = catalogFromInitializeMeta({ modes: [{ id: "plan", name: "Plan" }, { nope: true }] }, "grok");
    expect(modes).toEqual([{ id: "plan", name: "Plan" }]);
  });
});

describe("config option mapping", () => {
  const options = [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select" as const,
      currentValue: "grok-4.7",
      options: [
        { value: "grok-4.7", name: "Grok 4.7" },
        { value: "grok-4.6", name: "Grok 4.6" },
      ],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      type: "select" as const,
      currentValue: "high",
      options: [
        { value: "high", name: "High" },
        { value: "low", name: "Low" },
      ],
    },
  ];

  it("builds models with thinking levels from config options", () => {
    const models = modelsFromConfigOptions(options, "grok");
    expect(models.map((model) => model.id)).toEqual(["grok-4.7", "grok-4.6"]);
    expect(models[0]?.thinkingLevels?.map((level) => level.id)).toEqual(["high", "low"]);
    expect(models[0]?.defaultThinkingLevel).toBe("high");
  });

  it("reads the current selection", () => {
    expect(selectionFromConfigOptions(options)).toEqual({ modelId: "grok-4.7", thinkingLevel: "high" });
  });
});

describe("permission and tool mapping", () => {
  it("preserves all four provider option kinds", () => {
    const mapped = mapPermissionOptions([
      { optionId: "a", name: "Allow once", kind: "allow_once" },
      { optionId: "b", name: "Allow always", kind: "allow_always" },
      { optionId: "c", name: "Reject once", kind: "reject_once" },
      { optionId: "d", name: "Reject always", kind: "reject_always" },
    ]);
    expect(mapped.map((option) => option.kind)).toEqual(["allow_once", "allow_always", "deny", "deny"]);
    expect(mapped.map((option) => option.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("merges tool call updates without losing earlier fields", () => {
    const started = mergeToolCall(null, {
      toolCallId: "t1",
      title: "Run tests",
      kind: "execute",
      status: "pending",
      rawInput: { command: "npm test" },
    });
    expect(started.status).toBe("running");
    expect(started.input).toEqual({ command: "npm test" });
    const completed = mergeToolCall(started, { toolCallId: "t1", status: "completed", rawOutput: { exitCode: 0 } });
    expect(completed.status).toBe("completed");
    expect(completed.title).toBe("Run tests");
    expect(completed.output).toEqual({ exitCode: 0 });
    expect(completed.completedAt).toBeTruthy();
  });

  it("maps plan entries to homebase steps", () => {
    const plan = planFromEntries("p1", [
      { content: "One", priority: "high", status: "completed" },
      { content: "Two", priority: "low", status: "in_progress" },
      { content: "Three", priority: "low", status: "pending" },
    ]);
    expect(plan.steps.map((step) => step.status)).toEqual(["completed", "in_progress", "pending"]);
  });
});
