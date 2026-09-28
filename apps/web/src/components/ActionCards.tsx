import { Check, MessageCircleQuestion, ShieldAlert, X } from "lucide-react";
import { useState } from "react";

import type { AgentApprovalOption, AgentApprovalRequest, AgentQuestionRequest } from "@homebase/protocol";

import { Button } from "./ui.js";

const OPTION_STYLES: Record<AgentApprovalOption["kind"], "primary" | "secondary" | "danger"> = {
  allow_once: "primary",
  allow_always: "secondary",
  deny: "danger",
  custom: "secondary",
};

export function ApprovalCard({
  request,
  busy,
  error,
  onResolve,
}: {
  request: AgentApprovalRequest;
  busy: boolean;
  error: string | null;
  onResolve: (optionId: string, note: string | null) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  return (
    <section
      aria-label="Approval needed"
      className="hb-rise surface border-[color-mix(in_srgb,var(--warn)_30%,var(--border))] p-4"
    >
      <p className="eyebrow mb-2 flex items-center gap-1.5 text-warn">
        <ShieldAlert size={14} className="shrink-0" aria-hidden />
        Needs your approval
      </p>
      <h3 className="mb-2 break-words text-row font-semibold text-text">{request.title}</h3>
      {request.detail ? (
        <pre className="mb-3.5 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-[12px] bg-fill px-3 py-2.5 font-mono text-caption text-text">
          {request.detail}
        </pre>
      ) : (
        <p className="mb-3.5 text-callout text-muted">The agent is waiting for your decision.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {request.options.map((option) => (
          <Button
            key={option.id}
            variant={OPTION_STYLES[option.kind] ?? "secondary"}
            className="flex-1 basis-[8rem]"
            disabled={busy}
            onClick={() => onResolve(option.id, note.trim().length > 0 ? note.trim() : null)}
          >
            {option.kind === "deny" ? (
              <X size={16} aria-hidden />
            ) : option.kind === "allow_once" || option.kind === "allow_always" ? (
              <Check size={16} aria-hidden />
            ) : null}
            {option.label}
          </Button>
        ))}
      </div>
      {request.options.some((option) => option.description) ? (
        <ul className="mt-3 flex flex-col gap-1">
          {request.options
            .filter((option) => option.description)
            .map((option) => (
              <li key={option.id} className="text-caption text-muted">
                <span className="font-medium text-text">{option.label}:</span> {option.description}
              </li>
            ))}
        </ul>
      ) : null}

      {noteOpen ? (
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label="Note to the agent"
          rows={2}
          maxLength={2000}
          className="mt-3 w-full rounded-[var(--radius-md)] bg-fill px-3.5 py-2.5 text-body text-text placeholder:text-muted focus:outline-2 focus:outline-accent"
          placeholder="Add an optional note…"
        />
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="-ml-1 mt-1.5 min-h-11 rounded-[10px] px-1 text-callout font-medium text-muted hover:text-text"
        >
          Add a note
        </button>
      )}
      {error ? <p className="mt-2 text-callout text-bad">{error}</p> : null}
    </section>
  );
}

interface QuestionState {
  selected: string[];
  text: string;
  confirmed: boolean | null;
}

function initialState(): QuestionState {
  return { selected: [], text: "", confirmed: null };
}

export function QuestionCard({
  request,
  busy,
  error,
  onSubmit,
}: {
  request: AgentQuestionRequest;
  busy: boolean;
  error: string | null;
  onSubmit: (
    answers: Array<{
      questionId: string;
      selectedOptionIds?: string[];
      text?: string | null;
      confirmed?: boolean | null;
    }>,
  ) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, QuestionState>>(() => {
    const initial: Record<string, QuestionState> = {};
    for (const question of request.questions) initial[question.id] = initialState();
    return initial;
  });
  const [validation, setValidation] = useState<string | null>(null);

  const update = (questionId: string, patch: Partial<QuestionState>) => {
    setAnswers((current) => ({
      ...current,
      [questionId]: { ...(current[questionId] ?? { selected: [], text: "", confirmed: null }), ...patch },
    }));
  };

  const submit = () => {
    for (const question of request.questions) {
      const state = answers[question.id] ?? initialState();
      const required = question.required !== false;
      if (!required) continue;
      if (question.kind === "single_select" && state.selected.length === 0 && state.text.trim().length === 0) {
        setValidation(`Please answer “${question.header ?? question.question}”.`);
        return;
      }
      if (question.kind === "multi_select" && state.selected.length === 0) {
        setValidation(`Please choose at least one option for “${question.header ?? question.question}”.`);
        return;
      }
      if (question.kind === "text" && state.text.trim().length === 0) {
        setValidation(`Please answer “${question.header ?? question.question}”.`);
        return;
      }
      if (question.kind === "confirm" && state.confirmed === null) {
        setValidation(`Please answer “${question.header ?? question.question}”.`);
        return;
      }
    }
    setValidation(null);
    onSubmit(
      request.questions.map((question) => {
        const state = answers[question.id] ?? initialState();
        return {
          questionId: question.id,
          ...(state.selected.length > 0 ? { selectedOptionIds: state.selected } : {}),
          ...(state.text.trim().length > 0 ? { text: state.text.trim() } : {}),
          ...(state.confirmed !== null ? { confirmed: state.confirmed } : {}),
        };
      }),
    );
  };

  return (
    <section
      aria-label="Question from the agent"
      className="hb-rise surface border-[color-mix(in_srgb,var(--accent)_30%,var(--border))] p-4"
    >
      <p className="eyebrow mb-3 flex items-center gap-1.5 text-accent">
        <MessageCircleQuestion size={14} className="shrink-0" aria-hidden />
        {request.title && request.title !== "Questions" ? request.title : "The agent has a question"}
      </p>
      <div className="flex flex-col gap-5">
        {request.questions.map((question) => {
          const state = answers[question.id] ?? initialState();
          return (
            <fieldset key={question.id} className="min-w-0">
              <legend className="mb-2.5 flex w-full flex-col gap-1">
                {question.header ? (
                  <span className="text-caption font-semibold text-muted">{question.header}</span>
                ) : null}
                <span className="text-row font-medium text-text">{question.question}</span>
              </legend>
              {question.kind === "single_select" || question.kind === "multi_select" ? (
                <div className="flex flex-wrap gap-2">
                  {(question.options ?? []).map((option) => {
                    const active = state.selected.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role={question.kind === "single_select" ? "radio" : "checkbox"}
                        aria-checked={active}
                        onClick={() =>
                          update(question.id, {
                            selected:
                              question.kind === "single_select"
                                ? [option.id]
                                : active
                                  ? state.selected.filter((id) => id !== option.id)
                                  : [...state.selected, option.id],
                          })
                        }
                        className={`inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] border px-4 text-callout font-medium transition-colors ${
                          active
                            ? "border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-accent-soft text-accent"
                            : "border-transparent bg-fill text-text hover:bg-fill-strong"
                        }`}
                      >
                        {active ? <Check size={15} strokeWidth={2.5} aria-hidden /> : null}
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {question.kind === "confirm" ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={state.confirmed === true ? "primary" : "secondary"}
                    onClick={() => update(question.id, { confirmed: true })}
                  >
                    Yes
                  </Button>
                  <Button
                    size="sm"
                    variant={state.confirmed === false ? "danger" : "secondary"}
                    onClick={() => update(question.id, { confirmed: false })}
                  >
                    No
                  </Button>
                </div>
              ) : null}
              {question.kind === "text" || question.allowFreeform ? (
                <textarea
                  value={state.text}
                  onChange={(event) => update(question.id, { text: event.target.value })}
                  rows={2}
                  aria-label={question.header ?? question.question}
                  className="mt-2.5 w-full rounded-[var(--radius-md)] bg-fill px-3.5 py-2.5 text-body text-text placeholder:text-muted focus:outline-2 focus:outline-accent"
                  placeholder={question.kind === "text" ? "Type your answer…" : "Or type your own answer…"}
                />
              ) : null}
            </fieldset>
          );
        })}
      </div>
      {validation ? <p className="mt-3 text-callout text-warn">{validation}</p> : null}
      {error ? <p className="mt-3 text-callout text-bad">{error}</p> : null}
      <div className="mt-4">
        <Button variant="primary" className="w-full" loading={busy} onClick={submit}>
          Submit answer
        </Button>
      </div>
    </section>
  );
}
