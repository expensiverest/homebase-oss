import type { AgentQuestion, AgentQuestionAnswerItem, AgentQuestionOption } from "@homebase/protocol";

/**
 * Pure mapping helpers for Claude AskUserQuestion payloads.
 *
 * Claude's shape (verified 2.1.268):
 *   { questions: [{ question, header, options: [{label, description}], multiSelect }] }
 * Answers are returned as `updatedInput` with the original questions plus an
 * `answers` map keyed by question text.
 */

export interface NativeQuestion {
  question?: unknown;
  header?: unknown;
  options?: unknown;
  multiSelect?: unknown;
}

export function nativeQuestions(input: Record<string, unknown>): NativeQuestion[] {
  const questions = input.questions;
  return Array.isArray(questions) ? (questions as NativeQuestion[]) : [];
}

export function toAgentQuestions(questions: NativeQuestion[]): AgentQuestion[] {
  return questions.map((question, index) => {
    const options: AgentQuestionOption[] = Array.isArray(question.options)
      ? (question.options as Array<{ label?: unknown; description?: unknown }>).map((option) => {
          const label = typeof option.label === "string" ? option.label : String(option.label ?? "");
          return {
            id: label,
            label,
            description: typeof option.description === "string" ? option.description : null,
          };
        })
      : [];
    return {
      id: `q${index}`,
      header: typeof question.header === "string" ? question.header : null,
      question: typeof question.question === "string" ? question.question : `Question ${index + 1}`,
      kind: question.multiSelect === true ? "multi_select" : options.length > 0 ? "single_select" : "text",
      options,
      allowFreeform: true,
    };
  });
}

export function buildQuestionUpdatedInput(
  originalInput: Record<string, unknown>,
  questions: NativeQuestion[],
  answers: AgentQuestionAnswerItem[],
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const item of answers) {
    const index = Number.parseInt(item.questionId.replace(/^q/, ""), 10);
    const question = Number.isFinite(index) ? questions[index] : undefined;
    const key = typeof question?.question === "string" ? question.question : item.questionId;
    const value =
      item.selectedOptionIds && item.selectedOptionIds.length > 0
        ? item.selectedOptionIds.join(", ")
        : (item.text ?? (item.confirmed === true ? "Yes" : item.confirmed === false ? "No" : ""));
    if (typeof value === "string" && value.length > 0) mapped[key] = value;
  }
  return { ...originalInput, questions, answers: mapped };
}
