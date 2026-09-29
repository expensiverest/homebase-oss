import { Check, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import type { AgentDiff, AgentMode, AgentModel } from "@homebase/protocol";

import { levelLabel, resolveThinkingLevel, validThinkingLevels } from "../lib/viewmodel.js";
import { CodeBlock } from "./beautiful/CodeBlock.js";
import { Button, Segmented, Sheet, Spinner } from "./ui.js";

const DISPLAY_LIMIT = 80;

/** One selectable row in a sheet's grouped list. */
function ChoiceRow({
  active,
  onClick,
  title,
  meta,
  description,
}: {
  active: boolean;
  onClick: () => void;
  title: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <li className="hairline-top first:shadow-none">
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={onClick}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-row font-medium ${active ? "text-accent" : "text-text"}`}>{title}</span>
          {meta ? <span className="readout mt-0.5 block truncate text-caption text-muted">{meta}</span> : null}
          {description ? <span className="mt-0.5 block text-callout text-muted">{description}</span> : null}
        </span>
        {active ? <Check size={20} strokeWidth={2.5} className="shrink-0 text-accent" aria-hidden /> : null}
      </button>
    </li>
  );
}

export function ModelSheet({
  open,
  onClose,
  models,
  loading,
  error,
  currentModelId,
  currentThinkingLevel,
  showThinking,
  busy,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  models: AgentModel[];
  loading: boolean;
  error: string | null;
  currentModelId: string | null;
  currentThinkingLevel: string | null;
  showThinking: boolean;
  busy: boolean;
  onApply: (modelId: string, thinkingLevel: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(currentModelId);
  const [thinking, setThinking] = useState<string | null>(currentThinkingLevel);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length === 0) return models;
    return models.filter((model) =>
      `${model.name} ${model.id} ${model.description ?? ""}`.toLowerCase().includes(term),
    );
  }, [models, search]);

  const visible = filtered.slice(0, DISPLAY_LIMIT);
  const selectedModel = models.find((model) => model.id === selectedId);
  const levels = showThinking ? validThinkingLevels(selectedModel) : [];
  const effectiveThinking = resolveThinkingLevel(selectedModel, thinking);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Model"
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={busy}
          disabled={!selectedId}
          onClick={() => selectedId && onApply(selectedId, levels.length > 0 ? effectiveThinking : null)}
        >
          Use this model
        </Button>
      }
    >
      <div className="relative mb-4">
        <Search
          size={17}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          className="min-h-12 w-full rounded-[var(--radius-md)] bg-fill pl-10 pr-3 text-body text-text placeholder:text-muted focus:outline-2 focus:outline-accent"
        />
      </div>

      {levels.length > 0 ? (
        <div className="mb-5">
          <p className="eyebrow mb-2 px-1">Thinking level</p>
          <Segmented
            ariaLabel="Thinking level"
            options={levels.map((level) => ({ id: level, label: levelLabel(selectedModel, level) }))}
            value={effectiveThinking}
            onChange={(level) => setThinking(level)}
          />
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading models" />
        </div>
      ) : error ? (
        <p className="py-6 text-center text-callout text-bad">{error}</p>
      ) : (
        <>
          <ul role="radiogroup" aria-label="Models" className="surface overflow-hidden">
            {visible.map((model) => (
              <ChoiceRow
                key={model.id}
                active={model.id === selectedId}
                onClick={() => {
                  setSelectedId(model.id);
                  setThinking(resolveThinkingLevel(model, null));
                }}
                title={model.name}
                meta={model.id}
                description={model.description}
              />
            ))}
          </ul>
          {filtered.length > visible.length ? (
            <p className="mt-3 text-center text-caption text-muted">
              Showing {visible.length} of {filtered.length} models — keep typing to narrow the list.
            </p>
          ) : null}
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-callout text-muted">No models match “{search}”.</p>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

export function ModeSheet({
  open,
  onClose,
  modes,
  loading,
  currentMode,
  busy,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  modes: AgentMode[];
  loading: boolean;
  currentMode: string | null;
  busy: boolean;
  onApply: (mode: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(currentMode);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Mode"
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={busy}
          disabled={!selected}
          onClick={() => selected && onApply(selected)}
        >
          Use this mode
        </Button>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading modes" />
        </div>
      ) : (
        <ul role="radiogroup" aria-label="Modes" className="surface overflow-hidden">
          {modes.map((mode) => (
            <ChoiceRow
              key={mode.id}
              active={mode.id === selected}
              onClick={() => setSelected(mode.id)}
              title={mode.name}
              description={mode.description}
            />
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** A short list where a tap chooses and closes (no confirm step). */
export function OptionSheet({
  title,
  options,
  value,
  onClose,
  onPick,
}: {
  title: string;
  options: Array<{ id: string; label: string; description?: string | null }>;
  value: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <Sheet open onClose={onClose} title={title}>
      <ul role="radiogroup" aria-label={title} className="surface mb-2 overflow-hidden">
        {options.map((option) => (
          <ChoiceRow
            key={option.id}
            active={option.id === value}
            onClick={() => onPick(option.id)}
            title={option.label}
            description={option.description}
          />
        ))}
      </ul>
    </Sheet>
  );
}

export function DiffSheet({
  open,
  onClose,
  diff,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  diff: AgentDiff | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Changes">
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading diff" />
        </div>
      ) : error ? (
        <p className="py-6 text-center text-callout text-bad">{error}</p>
      ) : !diff || diff.files.length === 0 ? (
        <p className="py-6 text-center text-callout text-muted">No file changes in this session yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {diff.files.map((file) => (
            <li key={file.path} className="surface overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3">
                <span className="readout min-w-0 flex-1 truncate text-callout text-text">{file.path}</span>
                <span className="readout shrink-0 text-caption">
                  <span className="text-ok">+{file.additions ?? 0}</span>{" "}
                  <span className="text-bad">−{file.deletions ?? 0}</span>
                </span>
              </div>
              {file.patch ? (
                <div className="hairline-top px-2 pb-2 pt-2">
                  {/* A real normalized diff from the provider: the only place Code Block uses diff mode. */}
                  <CodeBlock code={file.patch} diff title="patch" compact />
                </div>
              ) : null}
            </li>
          ))}
          {diff.truncated ? <p className="text-caption text-muted">The diff was truncated by the provider.</p> : null}
        </ul>
      )}
    </Sheet>
  );
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  detail,
  confirmLabel,
  destructive = true,
  busy,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  detail: string;
  confirmLabel: string;
  destructive?: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            variant={destructive ? "danger" : "primary"}
            size="lg"
            className="w-full"
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <p className="pb-2 text-body text-muted">{detail}</p>
    </Sheet>
  );
}
