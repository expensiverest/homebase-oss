import { describe, expect, it } from "vitest";

import {
  approvalOptionToDecision,
  decisionToOptionId,
  parseModelId,
  publicDiffPath,
  toAgentDiff,
  toAgentMessage,
  toAgentModel,
  toAgentSession,
  toApprovalRequest,
  toFormAnswer,
  toQuestionRequest,
  toToolOutput,
} from "../src/mapper.js";
import {
  nativeAssistantMessage,
  nativeFileDiffs,
  nativeForm,
  nativeModel,
  nativeModelTextOnly,
  nativePermission,
  nativeSession,
  nativeUserMessage,
} from "./fixtures.js";

describe("model mapping", () => {
  it("maps native models onto neutral models with composite ids", () => {
    const model = toAgentModel(nativeModel);
    expect(model.id).toBe("example-provider/example-model");
    expect(model.provider).toBe("opencode");
    expect(model.contextWindow).toBe(200_000);
    expect(model.maxOutputTokens).toBe(32_000);
    expect(model.thinkingLevels?.map((level) => level.id)).toEqual(["none", "low", "high"]);
    expect(model.inputCapabilities).toEqual({ text: true, image: true, file: true });
  });

  it("maps text-only and deprecated models", () => {
    const model = toAgentModel(nativeModelTextOnly);
    expect(model.inputCapabilities).toEqual({ text: true, image: false, file: false });
    expect(model.deprecated).toBe(true);
    expect(model.thinkingLevels).toBeUndefined();
  });

  it("round-trips composite model ids", () => {
    expect(parseModelId("example-provider/example-model")).toEqual({
      providerID: "example-provider",
      id: "example-model",
    });
    expect(parseModelId("provider/with/slashes")).toEqual({ providerID: "provider", id: "with/slashes" });
    expect(parseModelId("no-slash")).toBeNull();
    expect(parseModelId("/leading")).toBeNull();
  });
});

describe("session mapping", () => {
  it("maps native sessions with ISO timestamps and neutral model refs", () => {
    const session = toAgentSession(nativeSession, "prj_1", "idle");
    expect(session.id).toBe("ses_example123");
    expect(session.provider).toBe("opencode");
    expect(session.projectId).toBe("prj_1");
    expect(session.createdAt).toBe(new Date(nativeSession.time.created).toISOString());
    expect(session.model?.modelId).toBe("example-provider/example-model");
    expect(session.model?.thinkingLevel).toBe("low");
    expect(session.mode).toBe("build");
  });
});

describe("message mapping", () => {
  it("maps user messages and their files without attachment ids", () => {
    const message = toAgentMessage(nativeUserMessage, "ses_1");
    expect(message?.role).toBe("user");
    const image = message?.parts.find((part) => part.type === "image");
    expect(image?.type === "image" ? image.name : undefined).toBe("screenshot.png");
    expect(image?.type === "image" ? image.attachmentId : "missing").toBeUndefined();
  });

  it("maps assistant content parts and tool state", () => {
    const message = toAgentMessage(nativeAssistantMessage, "ses_1");
    expect(message?.state).toBe("completed");
    const text = message?.parts.find((part) => part.type === "text");
    expect(text?.type === "text" ? text.text : "").toBe("Updated.");
    const tool = message?.parts.find((part) => part.type === "tool_call");
    expect(tool?.type === "tool_call" ? tool.toolCall.status : "").toBe("completed");
    expect(tool?.type === "tool_call" ? tool.toolCall.name : "").toBe("write");
    const serialized = JSON.stringify(tool);
    expect(serialized).toContain("README.md");
    expect(serialized).not.toContain("/home/example");
  });

  it("skips internal-only message types", () => {
    expect(
      toAgentMessage({ type: "idle", id: "msg_idle", time: { created: 1 }, outcome: "succeeded" }, "ses_1"),
    ).toBeNull();
    expect(
      toAgentMessage({ type: "synthetic", id: "msg_syn", time: { created: 1 }, text: "internal" } as never, "ses_1"),
    ).toBeNull();
  });

  it("sanitizes tool output: text kept, file URIs dropped", () => {
    const output = toToolOutput([
      { type: "text", text: "done" },
      { type: "file", uri: "/home/example/secret.txt", mime: "text/plain", name: "secret.txt" },
    ]);
    expect(JSON.stringify(output)).not.toContain("/home/example");
    expect(JSON.stringify(output)).toContain("secret.txt");
  });
});

describe("approval mapping", () => {
  it("offers allow-always only when save patterns exist", () => {
    const withSave = toApprovalRequest(nativePermission);
    expect(withSave.options.map((option) => option.id)).toEqual(["allow_once", "allow_always", "deny"]);
    expect(withSave.kind).toBe("file");
    expect(withSave.toolCallId).toBe("call_1");

    const withoutSave = toApprovalRequest({ ...nativePermission, save: undefined });
    expect(withoutSave.options.map((option) => option.id)).toEqual(["allow_once", "deny"]);
  });

  it("maps neutral options onto OpenCode decisions both ways", () => {
    expect(approvalOptionToDecision("allow_once")).toBe("once");
    expect(approvalOptionToDecision("allow_always")).toBe("always");
    expect(approvalOptionToDecision("deny")).toBe("reject");
    expect(approvalOptionToDecision("nonsense")).toBeNull();
    expect(decisionToOptionId("once")).toBe("allow_once");
    expect(decisionToOptionId("reject")).toBe("deny");
  });
});

describe("question mapping", () => {
  it("maps string fields with options to single select", () => {
    const request = toQuestionRequest(nativeForm);
    const question = request?.questions[0];
    expect(question?.kind).toBe("single_select");
    expect(question?.options?.map((option) => option.id)).toEqual(["Red", "Blue"]);
    expect(question?.allowFreeform).toBe(true);
  });

  it("maps boolean, number, and text fields", () => {
    const request = toQuestionRequest({
      id: "frm_2",
      sessionID: "ses_1",
      title: "More",
      fields: [
        { key: "confirm", type: "boolean" },
        { key: "count", type: "number", title: "How many?", minimum: 1, maximum: 10 },
        { key: "notes", type: "string" },
      ],
    });
    expect(request?.questions.map((question) => question.kind)).toEqual(["confirm", "text", "text"]);
    expect(request?.questions[1]?.question).toContain("min 1");
  });

  it("builds form answers with type coercion and rejects bad numbers", () => {
    const answer = toFormAnswer(nativeForm, {
      answers: [{ questionId: "q0", selectedOptionIds: ["Blue"] }],
    });
    expect(answer).toEqual({ answer: { q0: "Blue" } });

    const numeric = {
      id: "frm_3",
      sessionID: "ses_1",
      title: "Numbers",
      fields: [{ key: "count", type: "integer" as const }],
    };
    expect(toFormAnswer(numeric, { answers: [{ questionId: "count", text: "3.7" }] })).toEqual({
      answer: { count: 3 },
    });
    expect(() => toFormAnswer(numeric, { answers: [{ questionId: "count", text: "many" }] })).toThrowError(
      /must be a number/,
    );
  });
});

describe("diff mapping", () => {
  it("makes absolute paths project-relative where possible", () => {
    expect(publicDiffPath("/home/example/projects/demo/README.md", "/home/example/projects/demo")).toBe("README.md");
    expect(publicDiffPath("/elsewhere/secret.txt", "/home/example/projects/demo")).toBe("secret.txt");
    expect(publicDiffPath("src/app.ts", "/home/example/projects/demo")).toBe("src/app.ts");
  });

  it("maps file diffs and marks empty patches as binary", () => {
    const diff = toAgentDiff(nativeFileDiffs, "/home/example/projects/demo", "ses_1");
    expect(diff.files.map((file) => file.path)).toEqual(["README.md", "src/new.ts"]);
    expect(diff.files[1]?.binary).toBe(true);
    expect(JSON.stringify(diff)).not.toContain("/home/example");
  });
});
