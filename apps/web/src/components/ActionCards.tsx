import { Check, ShieldQuestion, X } from "lucide-react";
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
      className="hb-rise rounded-[var(--radius-lg)] border border-border bg-surface p-3.5 halo"
    >
      <header className="mb-1 flex items-center gap-2">
        <ShieldQuestion size={15} className="shrink-0 text-warn" aria-hidden />
        <h3 className="text-[13px] font-semibold text-text">{request.title}</h3>
      </header>
      {request.detail ? (
        <pre className="mb-2.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-surface-inset px-2.5 py-2 font-mono text-[12px] text-muted">
          {request.detail}
        </pre>
      ) : null}
      {!request.detail ? (
        <p className="mb-2.5 text-[13px] text-muted">The agent is waiting for your decision.</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {request.options.map((option) => (
          <Button
            key={option.id}
            variant={OPTION_STYLES[option.kind] ?? "secondary"}
            size="sm"
            disabled={busy}
            onClick={() => onResolve(option.id, note.trim().length > 0 ? note.trim() : null)}
          >
            {option.kind === "deny" ? (
              <X size={14} aria-hidden />
            ) : option.kind === "allow_once" || option.kind === "allow_always" ? (
              <Check size={14} aria-hidden />
            ) : null}
            {option.label}
          </Button>
        ))}
      </div>
      {request.options.some((option) => option.description) ? (
        <ul className="mt-2 flex flex-col gap-0.5">
          {request.options
            .filter((option) => option.description)
            .map((option) => (
              <li key={option.id} className="text-[12px] text-faint">
                <span className="font-medium text-muted">{option.label}:</span> {option.description}
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
          className="mt-2.5 w-full rounded-[12px] border border-border bg-surface px-3 py-2 text-[14px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
          placeholder="Add an optional note…"
        />
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="mt-2 min-h-11 text-[12px] font-medium text-muted hover:text-text"
        >
          Add a note
        </button>
      )}
      {error ? <p className="mt-2 text-[12px] text-bad">{error}</p> : null}
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
      className="hb-rise rounded-[var(--radius-lg)] border border-border bg-surface p-3.5 halo"
    >
      <header className="mb-2 flex items-center gap-2">
        <ShieldQuestion size={15} className="shrink-0 text-accent" aria-hidden />
        <h3 className="text-[13px] font-semibold text-text">{request.title ?? "The agent has a question"}</h3>
      </header>
      <div className="flex flex-col gap-3">
        {request.questions.map((question) => {
          const state = answers[question.id] ?? initialState();
          return (
            <fieldset key={question.id} className="min-w-0">
              <legend className="mb-1.5 flex w-full flex-col gap-0.5">
                {question.header ? (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                    {question.header}
                  </span>
                ) : null}
                <span className="text-[14px] text-text">{question.question}</span>
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
                        className={`min-h-11 rounded-[12px] border px-3.5 text-[14px] transition-colors ${
                          active
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-border bg-surface text-muted hover:text-text"
                        }`}
                      >
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
                  className="mt-2 w-full rounded-[12px] border border-border bg-surface px-3 py-2 text-[14px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
                  placeholder={question.kind === "text" ? "Type your answer…" : "Or type your own answer…"}
                />
              ) : null}
            </fieldset>
          );
        })}
      </div>
      {validation ? <p className="mt-2 text-[12px] text-warn">{validation}</p> : null}
      {error ? <p className="mt-2 text-[12px] text-bad">{error}</p> : null}
      <div className="mt-3">
        <Button variant="primary" size="sm" loading={busy} onClick={submit}>
          Submit answer
        </Button>
      </div>
    </section>
  );
}
