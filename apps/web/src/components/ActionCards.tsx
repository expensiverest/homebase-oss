import { Check, ChevronLeft, MessageCircleQuestion, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  AgentApprovalOption,
  AgentApprovalRequest,
  AgentQuestion,
  AgentQuestionRequest,
} from "@homebase/protocol";

import { ApprovalShell, ChoiceRow, RollingDigits } from "./beautiful/ApprovalCard.js";
import { RecommendationCard } from "./beautiful/RecommendationCard.js";
import { Button } from "./ui.js";

/*
 * Homebase adapters for pending actions. The Beautiful UI shells provide the
 * look; AgentApprovalRequest / AgentQuestionRequest provide every word and
 * every option. Nothing here is hard-coded per provider.
 */

// --- approvals ---------------------------------------------------------------

const ACTION_LABEL: Record<AgentApprovalRequest["kind"], string> = {
  command: "Run command",
  file: "Change a file",
  tool: "Use a tool",
  plan: "Approve the plan",
  other: "Allow this action",
};

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
  // The subject is what will actually happen (the detail); the title adds context when it says more.
  const subject = request.detail ?? request.title;
  const context = request.detail && request.title.trim() !== request.detail.trim() ? request.title : null;
  const described = request.options.filter((option) => option.description);

  return (
    <ApprovalShell
      label="Approval needed"
      tone="warn"
      eyebrow="Needs your approval"
      icon={<ShieldAlert size={14} className="shrink-0" aria-hidden />}
    >
      <h3 className="text-row font-semibold text-text">{ACTION_LABEL[request.kind]}</h3>
      {context ? <p className="mt-0.5 break-words text-callout text-muted">{context}</p> : null}
      <pre className="mt-2.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[12px] border border-border bg-inset px-3 py-2.5 font-mono text-[0.8125rem] leading-relaxed text-text">
        {subject}
      </pre>

      <div className="mt-3.5 flex flex-col gap-2">
        {request.options.map((option) => (
          <Button
            key={option.id}
            variant={OPTION_STYLES[option.kind] ?? "secondary"}
            className="w-full"
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
      {described.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          {described.map((option) => (
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
      {error ? (
        <p role="alert" className="mt-2 text-callout text-bad">
          {error}
        </p>
      ) : null}
    </ApprovalShell>
  );
}

// --- questions ---------------------------------------------------------------

interface QuestionState {
  selected: string[];
  text: string;
  confirmed: boolean | null;
}

type Answer = {
  questionId: string;
  selectedOptionIds?: string[];
  text?: string | null;
  confirmed?: boolean | null;
};

function emptyState(): QuestionState {
  return { selected: [], text: "", confirmed: null };
}

function missingAnswer(question: AgentQuestion, state: QuestionState): string | null {
  if (question.required === false) return null;
  const name = question.header ?? question.question;
  if (question.kind === "single_select" && state.selected.length === 0 && state.text.trim().length === 0)
    return `Please answer “${name}”.`;
  if (question.kind === "multi_select" && state.selected.length === 0 && state.text.trim().length === 0)
    return `Please choose at least one option for “${name}”.`;
  if (question.kind === "text" && state.text.trim().length === 0) return `Please answer “${name}”.`;
  if (question.kind === "confirm" && state.confirmed === null) return `Please answer “${name}”.`;
  return null;
}

function toAnswer(question: AgentQuestion, state: QuestionState): Answer {
  return {
    questionId: question.id,
    ...(state.selected.length > 0 ? { selectedOptionIds: state.selected } : {}),
    ...(state.text.trim().length > 0 ? { text: state.text.trim() } : {}),
    ...(state.confirmed !== null ? { confirmed: state.confirmed } : {}),
  };
}

/**
 * The recommendation presentation is used only when a request is a single
 * yes/no confirmation: the agent proposes one thing and waits. Everything else
 * uses the stepped question card.
 */
export function isRecommendation(request: AgentQuestionRequest): boolean {
  return request.questions.length === 1 && request.questions[0]?.kind === "confirm";
}

function ConfirmRecommendation({
  request,
  busy,
  error,
  onSubmit,
}: {
  request: AgentQuestionRequest;
  busy: boolean;
  error: string | null;
  onSubmit: (answers: Answer[]) => void;
}) {
  const question = request.questions[0] as AgentQuestion;
  const [text, setText] = useState("");
  const answer = (confirmed: boolean) =>
    onSubmit([{ questionId: question.id, confirmed, ...(text.trim() ? { text: text.trim() } : {}) }]);
  const custom = request.title && request.title !== "Questions" ? request.title : null;
  return (
    <RecommendationCard
      label="Question from the agent"
      title={question.question}
      detail={question.header ?? custom}
      acceptLabel="Yes, go ahead"
      declineLabel="No"
      busy={busy}
      onAccept={() => answer(true)}
      onDecline={() => answer(false)}
    >
      {question.allowFreeform ? (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          aria-label="Add a note"
          placeholder="Add a note (optional)…"
          className="mt-3 w-full rounded-[var(--radius-md)] bg-fill px-3.5 py-2.5 text-body text-text placeholder:text-muted focus:outline-2 focus:outline-accent"
        />
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-callout text-bad">
          {error}
        </p>
      ) : null}
    </RecommendationCard>
  );
}

const ADVANCE_MS = 480;

export function QuestionCard({
  request,
  busy,
  error,
  onSubmit,
}: {
  request: AgentQuestionRequest;
  busy: boolean;
  error: string | null;
  onSubmit: (answers: Answer[]) => void;
}) {
  if (isRecommendation(request)) {
    return <ConfirmRecommendation request={request} busy={busy} error={error} onSubmit={onSubmit} />;
  }
  return <SteppedQuestions request={request} busy={busy} error={error} onSubmit={onSubmit} />;
}

/** One question at a time, with the odometer step counter; a single choice advances on its own. */
function SteppedQuestions({
  request,
  busy,
  error,
  onSubmit,
}: {
  request: AgentQuestionRequest;
  busy: boolean;
  error: string | null;
  onSubmit: (answers: Answer[]) => void;
}) {
  const questions = request.questions;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuestionState>>({});
  const [validation, setValidation] = useState<string | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const multi = questions.length > 1;
  const last = index === questions.length - 1;
  const question = questions[index] as AgentQuestion;
  const state = answers[question.id] ?? emptyState();

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  const update = (questionId: string, patch: Partial<QuestionState>) => {
    setValidation(null);
    setAnswers((current) => ({ ...current, [questionId]: { ...(current[questionId] ?? emptyState()), ...patch } }));
  };

  const goTo = (next: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setValidation(null);
    setIndex(Math.min(Math.max(next, 0), questions.length - 1));
  };

  const submit = () => {
    for (const [position, entry] of questions.entries()) {
      const problem = missingAnswer(entry, answers[entry.id] ?? emptyState());
      if (problem) {
        setIndex(position);
        setValidation(problem);
        return;
      }
    }
    setValidation(null);
    onSubmit(questions.map((entry) => toAnswer(entry, answers[entry.id] ?? emptyState())));
  };

  const next = () => {
    const problem = missingAnswer(question, state);
    if (problem) {
      setValidation(problem);
      return;
    }
    if (last) submit();
    else goTo(index + 1);
  };

  const pick = (optionId: string) => {
    if (question.kind === "single_select") {
      update(question.id, { selected: [optionId], text: "" });
      // A single choice moves on by itself (never submits by itself).
      if (!last) {
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
        advanceTimer.current = setTimeout(
          () => setIndex((current) => Math.min(current + 1, questions.length - 1)),
          ADVANCE_MS,
        );
      }
      return;
    }
    const selected = state.selected.includes(optionId)
      ? state.selected.filter((id) => id !== optionId)
      : [...state.selected, optionId];
    update(question.id, { selected });
  };

  const title = request.title && request.title !== "Questions" ? request.title : "The agent has a question";

  return (
    <ApprovalShell
      label="Question from the agent"
      tone="accent"
      eyebrow={title}
      icon={<MessageCircleQuestion size={14} className="shrink-0" aria-hidden />}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {multi ? (
            <div className="flex items-center text-muted">
              <button
                type="button"
                aria-label="Previous question"
                disabled={index === 0}
                onClick={() => goTo(index - 1)}
                className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors enabled:hover:text-text disabled:opacity-30"
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
              <span className="readout inline-flex items-center text-caption font-medium" aria-live="polite">
                <span className="sr-only">Question </span>
                <RollingDigits value={`${index + 1} / ${questions.length}`} />
              </span>
            </div>
          ) : (
            <span />
          )}
          <div className="ml-auto flex items-center gap-2">
            {!last ? (
              <Button variant="primary" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={submit}>
                Submit answer
              </Button>
            )}
          </div>
        </div>
      }
    >
      <fieldset
        key={question.id}
        className="min-w-0"
        style={{ animation: "bui-fade-up 320ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <legend className="mb-2.5 flex w-full flex-col gap-1">
          {question.header ? <span className="text-caption font-semibold text-muted">{question.header}</span> : null}
          <span className="text-row font-semibold leading-snug text-text">{question.question}</span>
        </legend>
        {question.kind === "single_select" || question.kind === "multi_select" ? (
          <div
            className="-mx-2 flex flex-col gap-0.5"
            role={question.kind === "single_select" ? "radiogroup" : "group"}
          >
            {(question.options ?? []).map((option) => (
              <ChoiceRow
                key={option.id}
                type={question.kind === "single_select" ? "radio" : "check"}
                checked={state.selected.includes(option.id)}
                label={option.label}
                description={option.description}
                onClick={() => pick(option.id)}
              />
            ))}
          </div>
        ) : null}
        {question.kind === "confirm" ? (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant={state.confirmed === true ? "primary" : "secondary"}
              aria-pressed={state.confirmed === true}
              onClick={() => update(question.id, { confirmed: true })}
            >
              Yes
            </Button>
            <Button
              className="flex-1"
              variant={state.confirmed === false ? "danger" : "secondary"}
              aria-pressed={state.confirmed === false}
              onClick={() => update(question.id, { confirmed: false })}
            >
              No
            </Button>
          </div>
        ) : null}
        {question.kind === "text" || question.allowFreeform ? (
          <textarea
            value={state.text}
            onChange={(event) =>
              update(question.id, {
                text: event.target.value,
                ...(question.kind === "single_select" && event.target.value ? { selected: [] } : {}),
              })
            }
            rows={2}
            aria-label={question.header ?? question.question}
            className="mt-2 w-full rounded-[var(--radius-md)] bg-fill px-3.5 py-2.5 text-body text-text placeholder:text-muted focus:outline-2 focus:outline-accent"
            placeholder={question.kind === "text" ? "Type your answer…" : "Something else…"}
          />
        ) : null}
      </fieldset>
      {validation ? (
        <p role="alert" className="mt-3 text-callout text-warn">
          {validation}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-callout text-bad">
          {error}
        </p>
      ) : null}
    </ApprovalShell>
  );
}
