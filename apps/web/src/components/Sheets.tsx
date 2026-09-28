import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { AgentDiff, AgentMode, AgentModel } from "@homebase/protocol";

import { resolveThinkingLevel, validThinkingLevels } from "../lib/viewmodel.js";
import { Markdown } from "./Markdown.js";
import { Button, Sheet, Spinner } from "./ui.js";

const DISPLAY_LIMIT = 80;

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
          className="w-full"
          loading={busy}
          disabled={!selectedId}
          onClick={() => selectedId && onApply(selectedId, levels.length > 0 ? effectiveThinking : null)}
        >
          Use this model
        </Button>
      }
    >
      <div className="relative mb-3">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          data-autofocus
          className="min-h-11 w-full rounded-[12px] border border-border bg-surface pl-9 pr-3 text-[15px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading models" />
        </div>
      ) : error ? (
        <p className="py-6 text-center text-[13px] text-bad">{error}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {visible.map((model) => {
              const active = model.id === selectedId;
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setSelectedId(model.id);
                      setThinking(resolveThinkingLevel(model, null));
                    }}
                    className={`flex min-h-[52px] w-full items-center gap-3 rounded-[12px] border px-3 py-2 text-left transition-colors ${
                      active ? "border-accent bg-accent-soft" : "border-border bg-surface"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[14px] font-medium ${active ? "text-accent" : "text-text"}`}
                      >
                        {model.name}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-faint">{model.id}</span>
                      {model.description ? (
                        <span className="mt-0.5 block truncate text-[12px] text-muted">{model.description}</span>
                      ) : null}
                    </span>
                    {active ? <Check size={16} className="shrink-0 text-accent" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {filtered.length > visible.length ? (
            <p className="mt-2 text-center text-[12px] text-faint">
              Showing {visible.length} of {filtered.length} models — keep typing to narrow the list.
            </p>
          ) : null}
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted">No models match “{search}”.</p>
          ) : null}
        </>
      )}

      {levels.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Thinking level</h3>
          <div role="radiogroup" aria-label="Thinking level" className="flex flex-wrap gap-2">
            {levels.map((level) => {
              const levelMeta = selectedModel?.thinkingLevels?.find((entry) => entry.id === level);
              const active = effectiveThinking === level;
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setThinking(level)}
                  className={`min-h-11 rounded-full border px-3.5 text-[13px] font-medium ${
                    active ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted"
                  }`}
                >
                  {levelMeta?.name ?? level}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
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
        <ul className="flex flex-col gap-1">
          {modes.map((mode) => {
            const active = mode.id === selected;
            return (
              <li key={mode.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(mode.id)}
                  className={`flex min-h-[52px] w-full items-center gap-3 rounded-[12px] border px-3 py-2 text-left ${
                    active ? "border-accent bg-accent-soft" : "border-border bg-surface"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[14px] font-medium ${active ? "text-accent" : "text-text"}`}>
                      {mode.name}
                    </span>
                    {mode.description ? (
                      <span className="mt-0.5 block text-[12px] text-muted">{mode.description}</span>
                    ) : null}
                  </span>
                  {active ? <Check size={16} className="shrink-0 text-accent" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
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
        <p className="py-6 text-center text-[13px] text-bad">{error}</p>
      ) : !diff || diff.files.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">No file changes in this session yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {diff.files.map((file) => (
            <li key={file.path} className="rounded-[var(--radius-md)] border border-border bg-surface">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">{file.path}</span>
                <span className="shrink-0 text-[11px] text-faint">
                  <span className="text-ok">+{file.additions ?? 0}</span>{" "}
                  <span className="text-bad">−{file.deletions ?? 0}</span>
                </span>
              </div>
              {file.patch ? (
                <div className="border-t border-border px-2 py-1">
                  <Markdown text={`\`\`\`diff\n${file.patch}\n\`\`\``} />
                </div>
              ) : null}
            </li>
          ))}
          {diff.truncated ? <p className="text-[12px] text-faint">The diff was truncated by the provider.</p> : null}
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
        <div className="flex gap-2">
          <Button className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} className="flex-1" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="pb-2 text-[14px] text-muted">{detail}</p>
    </Sheet>
  );
}
