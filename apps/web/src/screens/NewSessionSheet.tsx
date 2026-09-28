import { useState } from "react";

import type { AgentProject, AgentProvider, AgentSession } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { readLastSelection, rememberSelection } from "../lib/prefs.js";
import { useModels, useModes } from "../lib/queries.js";
import { providerStatus, resolveThinkingLevel, validThinkingLevels } from "../lib/viewmodel.js";
import { Button, Segmented, Sheet, Spinner } from "../components/ui.js";

interface NewSessionSheetProps {
  open: boolean;
  onClose: () => void;
  project: AgentProject;
  providers: AgentProvider[];
  onCreated: (session: AgentSession) => void;
}

export function NewSessionSheet({ open, onClose, project, providers, onCreated }: NewSessionSheetProps) {
  const previous = readLastSelection(project.id);
  const usable = providers.filter((provider) => provider.installed && provider.compatible);
  const [providerId, setProviderId] = useState<string | null>(
    usable.find((provider) => provider.id === previous.provider)?.id ?? usable[0]?.id ?? null,
  );
  const [modelId, setModelId] = useState<string | null>(previous.modelId ?? null);
  const [mode, setMode] = useState<string | null>(previous.mode ?? null);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(previous.thinkingLevel ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = usable.find((candidate) => candidate.id === providerId);
  const models = useModels(project.id, providerId ?? undefined, provider?.capabilities.models === true);
  const modes = useModes(project.id, providerId ?? undefined, provider?.capabilities.modes === true);

  const modelList = models.data ?? [];
  const modeList = modes.data ?? [];
  const selectedModel = modelList.find((model) => model.id === modelId) ?? modelList[0];
  const levels = provider?.capabilities.thinkingLevels ? validThinkingLevels(selectedModel) : [];
  const effectiveThinking = levels.length > 0 ? resolveThinkingLevel(selectedModel, thinkingLevel) : null;

  const status = provider ? providerStatus(provider) : null;
  const canStart = Boolean(provider) && status?.tone === "ok" && provider?.authenticated !== false;

  const start = async () => {
    if (!providerId) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.createSession({
        provider: providerId,
        projectId: project.id,
        model:
          selectedModel && provider?.capabilities.models
            ? { provider: providerId, modelId: selectedModel.id, thinkingLevel: effectiveThinking }
            : null,
        mode: modeList.length > 0 ? (mode ?? modeList[0]?.id ?? null) : null,
        thinkingLevel: levels.length > 0 ? effectiveThinking : null,
      });
      rememberSelection(project.id, {
        provider: providerId,
        modelId: selectedModel?.id,
        mode: modeList.length > 0 ? (mode ?? modeList[0]?.id) : undefined,
        thinkingLevel: effectiveThinking,
      });
      onCreated(session);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The session could not be created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New session"
      footer={
        <Button variant="primary" className="w-full" loading={busy} disabled={!canStart} onClick={() => void start()}>
          Start session
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <section>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Provider</h3>
          <Segmented
            ariaLabel="Provider"
            options={usable.map((entry) => ({ id: entry.id, label: entry.name }))}
            value={providerId}
            onChange={(id) => {
              setProviderId(id);
              setModelId(null);
              setMode(null);
              setThinkingLevel(null);
            }}
          />
          {status && status.tone !== "ok" ? (
            <p className="mt-2 text-[12px] text-warn">{status.detail ?? status.label}</p>
          ) : null}
        </section>

        {provider?.capabilities.models ? (
          <section>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Model</h3>
            {models.isLoading ? (
              <Spinner label="Loading models" />
            ) : modelList.length === 0 ? (
              <p className="text-[13px] text-muted">No models reported.</p>
            ) : (
              <select
                aria-label="Model"
                value={selectedModel?.id ?? ""}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setThinkingLevel(null);
                }}
                className="min-h-11 w-full rounded-[12px] border border-border bg-surface px-3 text-[14px] text-text focus:border-accent focus:outline-none"
              >
                {modelList.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            )}
            {modelList.length > 100 ? (
              <p className="mt-1.5 text-[11px] text-faint">Large catalog: refine the model later from the session.</p>
            ) : null}
          </section>
        ) : null}

        {levels.length > 0 ? (
          <section>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Thinking level</h3>
            <Segmented
              ariaLabel="Thinking level"
              options={levels.map((level) => ({
                id: level,
                label: selectedModel?.thinkingLevels?.find((entry) => entry.id === level)?.name ?? level,
              }))}
              value={effectiveThinking}
              onChange={(level) => setThinkingLevel(level)}
            />
          </section>
        ) : null}

        {provider?.capabilities.modes ? (
          <section>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-faint">Mode</h3>
            {modes.isLoading ? (
              <Spinner label="Loading modes" />
            ) : (
              <Segmented
                ariaLabel="Mode"
                options={modeList.map((entry) => ({ id: entry.id, label: entry.name }))}
                value={mode ?? modeList[0]?.id ?? null}
                onChange={(id) => setMode(id)}
              />
            )}
          </section>
        ) : null}

        {!canStart && provider ? (
          <p className="text-[12px] text-bad">{status?.detail ?? "This provider is not ready."}</p>
        ) : null}
        {error ? <p className="text-[12px] text-bad">{error}</p> : null}
      </div>
    </Sheet>
  );
}
