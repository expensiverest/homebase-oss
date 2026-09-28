import { Plus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import type { AgentProject, AgentProvider, AgentSession } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { readLastSelection, rememberSelection } from "../lib/prefs.js";
import { useModels, useModes } from "../lib/queries.js";
import {
  levelLabel,
  providerStatus,
  resolveThinkingLevel,
  usableProviders,
  validThinkingLevels,
} from "../lib/viewmodel.js";
import { ProviderGlyph } from "./marks.js";
import { ModelSheet, OptionSheet } from "./Sheets.js";
import { Button, PickerButton, Segmented, Skeleton } from "./ui.js";

interface SessionLauncherProps {
  project: AgentProject;
  providers: AgentProvider[];
  onCreated: (session: AgentSession) => void;
}

/**
 * The project's primary action, designed into the screen: provider, mode,
 * model and thinking level, then New session. Every option comes from the
 * provider's capabilities and catalogs; long catalogs open in a sheet.
 */
export function SessionLauncher({ project, providers, onCreated }: SessionLauncherProps) {
  const previous = readLastSelection(project.id);
  const usable = usableProviders(providers, project.providersAvailable);
  const [providerId, setProviderId] = useState<string | null>(
    usable.find((provider) => provider.id === previous.provider)?.id ?? usable[0]?.id ?? null,
  );
  const [modelId, setModelId] = useState<string | null>(previous.modelId ?? null);
  const [mode, setMode] = useState<string | null>(previous.mode ?? null);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(previous.thinkingLevel ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);

  const provider = usable.find((candidate) => candidate.id === providerId) ?? usable[0];
  const activeId = provider?.id;
  const models = useModels(project.id, activeId, provider?.capabilities.models === true);
  const modes = useModes(project.id, activeId, provider?.capabilities.modes === true);

  const modelList = models.data ?? [];
  const modeList = modes.data ?? [];
  const selectedModel = modelList.find((model) => model.id === modelId) ?? modelList[0];
  const levels = provider?.capabilities.thinkingLevels ? validThinkingLevels(selectedModel) : [];
  const effectiveThinking = levels.length > 0 ? resolveThinkingLevel(selectedModel, thinkingLevel) : null;
  const effectiveMode = modeList.find((entry) => entry.id === mode)?.id ?? modeList[0]?.id ?? null;
  const modeName = modeList.find((entry) => entry.id === effectiveMode)?.name ?? "Mode";

  const status = provider ? providerStatus(provider) : null;
  const canStart = Boolean(provider) && status?.tone === "ok" && provider?.authenticated !== false;

  const chooseProvider = (id: string) => {
    if (id === activeId) return;
    setProviderId(id);
    setModelId(null);
    setMode(null);
    setThinkingLevel(null);
    setError(null);
  };

  const start = async () => {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.createSession({
        provider: activeId,
        projectId: project.id,
        model:
          selectedModel && provider?.capabilities.models
            ? { provider: activeId, modelId: selectedModel.id, thinkingLevel: effectiveThinking }
            : null,
        mode: modeList.length > 0 ? effectiveMode : null,
        thinkingLevel: levels.length > 0 ? effectiveThinking : null,
      });
      rememberSelection(project.id, {
        provider: activeId,
        modelId: selectedModel?.id,
        mode: effectiveMode ?? undefined,
        thinkingLevel: effectiveThinking,
      });
      onCreated(session);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The session could not be created.");
    } finally {
      setBusy(false);
    }
  };

  if (usable.length === 0) {
    return (
      <section aria-label="Start a session" className="surface px-4 py-4">
        <p className="text-callout text-muted">No agent can work in this project right now.</p>
      </section>
    );
  }

  const showModes = provider?.capabilities.modes === true;
  const showModels = provider?.capabilities.models === true;

  return (
    <section aria-label="Start a session" className="surface flex flex-col gap-3 p-3">
      {usable.length > 1 ? (
        <Segmented
          ariaLabel="Provider"
          options={usable.map((entry) => ({
            id: entry.id,
            label: (
              <>
                <ProviderGlyph providerId={entry.id} size={15} />
                <span className="truncate">{entry.name}</span>
              </>
            ),
          }))}
          value={activeId ?? null}
          onChange={chooseProvider}
        />
      ) : provider ? (
        <p className="flex min-h-8 items-center gap-2 px-1 text-callout font-medium text-muted">
          <ProviderGlyph providerId={provider.id} size={15} />
          {provider.name}
        </p>
      ) : null}

      {showModes || showModels ? (
        <div className="flex flex-wrap gap-2">
          {showModes ? (
            modes.isLoading ? (
              <Skeleton className="h-11 min-w-[7rem] flex-1 rounded-[var(--radius-md)]" />
            ) : modeList.length === 2 ? (
              <Segmented
                ariaLabel="Mode"
                className="min-w-[10rem] flex-1"
                options={modeList.map((entry) => ({ id: entry.id, label: entry.name }))}
                value={effectiveMode}
                onChange={(id) => setMode(id)}
              />
            ) : modeList.length > 0 ? (
              <PickerButton
                label="Mode"
                value={modeName}
                icon={<SlidersHorizontal size={16} aria-hidden />}
                ariaLabel={`Mode: ${modeName}. Change mode`}
                onClick={() => setModeOpen(true)}
                className="min-w-[7.5rem] flex-[2]"
              />
            ) : null
          ) : null}
          {showModels ? (
            models.isLoading ? (
              <Skeleton className="h-11 min-w-[10rem] flex-[3] rounded-[var(--radius-md)]" />
            ) : modelList.length === 0 ? (
              <p className="flex min-h-11 items-center px-1 text-callout text-muted">No models reported.</p>
            ) : (
              <PickerButton
                label="Model"
                value={selectedModel?.name ?? "Model"}
                icon={<span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-accent" />}
                ariaLabel={`Model: ${selectedModel?.name ?? "default"}. Change model`}
                onClick={() => setModelOpen(true)}
                className="min-w-[10rem] flex-[3]"
              />
            )
          ) : null}
        </div>
      ) : null}

      {levels.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="px-1 text-caption text-muted">Thinking</span>
          <Segmented
            ariaLabel="Thinking level"
            options={levels.map((level) => ({ id: level, label: levelLabel(selectedModel, level) }))}
            value={effectiveThinking}
            onChange={(level) => setThinkingLevel(level)}
          />
        </div>
      ) : null}

      {status && status.tone !== "ok" ? (
        <p role="alert" className="px-1 text-callout text-warn">
          {provider?.name}: {status.detail ?? status.label}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-1 text-callout text-bad">
          {error}
        </p>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={busy}
        disabled={!canStart}
        onClick={() => void start()}
      >
        {busy ? null : <Plus size={18} strokeWidth={2.5} aria-hidden />}
        New session
      </Button>

      {modelOpen ? (
        <ModelSheet
          open
          onClose={() => setModelOpen(false)}
          models={modelList}
          loading={models.isLoading}
          error={models.isError ? "Models are unavailable right now." : null}
          currentModelId={selectedModel?.id ?? null}
          currentThinkingLevel={effectiveThinking}
          showThinking={provider?.capabilities.thinkingLevels === true}
          busy={false}
          onApply={(nextModel, nextThinking) => {
            setModelId(nextModel);
            setThinkingLevel(nextThinking);
            setModelOpen(false);
          }}
        />
      ) : null}
      {modeOpen ? (
        <OptionSheet
          title="Mode"
          options={modeList.map((entry) => ({ id: entry.id, label: entry.name, description: entry.description }))}
          value={effectiveMode}
          onClose={() => setModeOpen(false)}
          onPick={(id) => {
            setMode(id);
            setModeOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
