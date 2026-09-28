import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Cpu, FileDiff, Gauge, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentApprovalRequest, AgentAttachmentRef, AgentMessage, AgentQuestionRequest } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { useChatScroll } from "../lib/chatScroll.js";
import { useLive } from "../lib/live.js";
import { qk, useActions, useDiff, useMessages, useModels, useModes, useProviders, useSession } from "../lib/queries.js";
import { foldTimeline, sessionStatus } from "../lib/viewmodel.js";
import { ApprovalCard, QuestionCard } from "../components/ActionCards.js";
import { Timeline } from "../components/ChatTimeline.js";
import { Composer, type ComposerAction } from "../components/Composer.js";
import { ScreenHeader, ConnectionPill } from "../components/chrome.js";
import { ConfirmSheet, DiffSheet, ModelSheet, ModeSheet } from "../components/Sheets.js";
import { EmptyState, ErrorState, IconButton, Pill, Skeleton } from "../components/ui.js";

export function ChatScreen() {
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
  const id = sessionId ?? "";
  const navigate = useNavigate();
  const client = useQueryClient();

  const session = useSession(id || undefined);
  const providers = useProviders();
  const messages = useMessages(id || undefined);
  const overlay = useLive((state) => state.sessions[id]);
  const sessionRow = session.data;
  const provider = providers.data?.find((candidate) => candidate.id === sessionRow?.provider);

  const canApprove = provider?.capabilities.approvals === true;
  const canQuestion = provider?.capabilities.questions === true;
  const actions = useActions(id || undefined, canApprove || canQuestion);
  const models = useModels(sessionRow?.projectId, sessionRow?.provider, provider?.capabilities.models === true);
  const modes = useModes(sessionRow?.projectId, sessionRow?.provider, provider?.capabilities.modes === true);

  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  const diff = useDiff(id || undefined, diffOpen && provider?.capabilities.diffs === true);

  const fetched = useMemo(
    () => (messages.data ? messages.data.pages.flatMap((page) => page.items) : []),
    [messages.data],
  );

  const merged = useMemo(() => {
    const map = new Map<string, AgentMessage>();
    const order: string[] = [];
    for (const message of [...fetched].reverse()) {
      if (!map.has(message.id)) order.push(message.id);
      map.set(message.id, message);
    }
    for (const message of overlay?.messages ?? []) {
      if (!map.has(message.id)) order.push(message.id);
      map.set(message.id, message);
    }
    return order.map((key) => map.get(key)).filter((message): message is AgentMessage => Boolean(message));
  }, [fetched, overlay?.messages]);

  const timeline = useMemo(() => foldTimeline(merged), [merged]);
  const running = overlay?.running ?? sessionRow?.state === "working";

  const scrollRef = useRef<HTMLDivElement>(null);
  const { atBottom, scrollToBottom, captureHeight, restoreHeight } = useChatScroll(scrollRef);
  const initialScrollDone = useRef(false);

  useEffect(() => {
    initialScrollDone.current = false;
  }, [id]);

  useEffect(() => {
    if (fetched.length === 0 || initialScrollDone.current) return;
    scrollToBottom(false);
    initialScrollDone.current = true;
  }, [fetched.length, scrollToBottom]);

  useEffect(() => {
    if (initialScrollDone.current && atBottom) scrollToBottom(false);
  }, [merged.length, running, atBottom, scrollToBottom]);

  // Fetched history is authoritative: prune overlay copies that history
  // already contains (running state is considered inside `prune`).
  useEffect(() => {
    if (fetched.length === 0) return;
    useLive.getState().prune(id, fetched);
  }, [fetched, id]);

  const loadOlder = () => {
    const previousHeight = captureHeight();
    void messages.fetchNextPage().then(() => {
      requestAnimationFrame(() => restoreHeight(previousHeight));
    });
  };

  const send = async (text: string, attachments: AgentAttachmentRef[], action: ComposerAction) => {
    useLive.getState().addOptimisticUserMessage(id, text, attachments);
    const input = { text, ...(attachments.length > 0 ? { attachments } : {}) };
    try {
      if (action === "queue") await api.queueMessage(id, input);
      else if (action === "steer") await api.steerMessage(id, input);
      else await api.sendMessage(id, input);
      void client.invalidateQueries({ queryKey: qk.messages(id) });
    } catch (error) {
      useLive.getState().markStale(id);
      void client.invalidateQueries({ queryKey: qk.messages(id) });
      throw error;
    }
  };

  const resolveApproval = async (request: AgentApprovalRequest, optionId: string, note: string | null) => {
    setCardBusy(request.id);
    setCardError(null);
    const key = qk.actions(id);
    const previous = client.getQueryData(key);
    client.setQueryData(
      key,
      (current: { approvals: AgentApprovalRequest[]; questions: AgentQuestionRequest[] } | undefined) =>
        current ? { ...current, approvals: current.approvals.filter((entry) => entry.id !== request.id) } : current,
    );
    try {
      await api.resolveApproval(request.id, { optionId, note });
    } catch (error) {
      if (previous) client.setQueryData(key, previous);
      setCardError(error instanceof Error ? error.message : "The decision could not be delivered.");
      void client.invalidateQueries({ queryKey: key });
    } finally {
      setCardBusy(null);
    }
  };

  const answerQuestion = async (
    request: AgentQuestionRequest,
    answers: Array<{
      questionId: string;
      selectedOptionIds?: string[];
      text?: string | null;
      confirmed?: boolean | null;
    }>,
  ) => {
    setCardBusy(request.id);
    setCardError(null);
    const key = qk.actions(id);
    const previous = client.getQueryData(key);
    client.setQueryData(
      key,
      (current: { approvals: AgentApprovalRequest[]; questions: AgentQuestionRequest[] } | undefined) =>
        current ? { ...current, questions: current.questions.filter((entry) => entry.id !== request.id) } : current,
    );
    try {
      await api.answerQuestion(request.id, { answers });
    } catch (error) {
      if (previous) client.setQueryData(key, previous);
      setCardError(error instanceof Error ? error.message : "The answer could not be delivered.");
      void client.invalidateQueries({ queryKey: key });
    } finally {
      setCardBusy(null);
    }
  };

  const applyModel = async (modelId: string, thinkingLevel: string | null) => {
    setSheetBusy(true);
    setBannerError(null);
    try {
      await api.setModel(id, { modelId, thinkingLevel });
      await client.invalidateQueries({ queryKey: qk.session(id) });
      setModelOpen(false);
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "The model could not be switched.");
    } finally {
      setSheetBusy(false);
    }
  };

  const applyMode = async (mode: string) => {
    setSheetBusy(true);
    setBannerError(null);
    try {
      await api.setMode(id, { mode });
      await client.invalidateQueries({ queryKey: qk.session(id) });
      setModeOpen(false);
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "The mode could not be switched.");
    } finally {
      setSheetBusy(false);
    }
  };

  const interrupt = () => {
    void api.interrupt(id).catch((error: unknown) => {
      setBannerError(error instanceof Error ? error.message : "The run could not be stopped.");
    });
  };

  const deleteSession = async () => {
    if (!sessionRow) return;
    setDeleting(true);
    try {
      await api.deleteSession(id);
      await client.invalidateQueries({ queryKey: qk.sessions(sessionRow.projectId) });
      void navigate({ to: "/p/$projectId", params: { projectId: sessionRow.projectId } });
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : "The session could not be deleted.");
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  if (!sessionId) return null;

  if (session.isLoading && !sessionRow) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ScreenHeader title="Session" onBack={() => void navigate({ to: "/" })} />
        <div className="flex flex-col gap-2 px-safe pt-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (session.isError || !sessionRow) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ScreenHeader title="Session" onBack={() => void navigate({ to: "/" })} />
        <ErrorState
          title="Session unavailable"
          detail="It may have been deleted, or the Host cannot reach the provider."
          onRetry={() => void session.refetch()}
        />
      </div>
    );
  }

  const status = sessionStatus(sessionRow.state);
  const selectedModel = models.data?.find((model) => model.id === sessionRow.model?.modelId);
  const modelLabel =
    selectedModel?.name ??
    (sessionRow.model?.modelId ? (sessionRow.model.modelId.split("/").pop() ?? "Model") : "Model");
  const modeLabel = modes.data?.find((mode) => mode.id === sessionRow.mode)?.name ?? sessionRow.mode ?? "Mode";
  const thinking = sessionRow.model?.thinkingLevel ?? sessionRow.thinkingLevel;
  const approvals = actions.data?.approvals ?? [];
  const questions = actions.data?.questions ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={sessionRow.title ?? "Session"}
        subtitle={
          <>
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
              {provider?.name ?? sessionRow.provider}
            </span>
            <Pill tone={status.tone}>{status.label}</Pill>
            <ConnectionPill />
          </>
        }
        onBack={() => void navigate({ to: "/p/$projectId", params: { projectId: sessionRow.projectId } })}
        trailing={
          <>
            {provider?.capabilities.diffs ? (
              <IconButton label="Show changes" onClick={() => setDiffOpen(true)}>
                <FileDiff size={18} aria-hidden />
              </IconButton>
            ) : null}
            {provider?.capabilities.deleteSession ? (
              <IconButton label="Delete session" onClick={() => setConfirmOpen(true)}>
                <Trash2 size={18} aria-hidden />
              </IconButton>
            ) : null}
          </>
        }
      />

      <div className="flex items-center gap-2 overflow-x-auto px-safe pb-2">
        {provider?.capabilities.models ? (
          <button
            type="button"
            onClick={() => setModelOpen(true)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12px] text-text"
            aria-label={`Model: ${modelLabel}. Change model`}
          >
            <Cpu size={13} className="text-muted" aria-hidden />
            <span className="max-w-[160px] truncate font-medium">{modelLabel}</span>
            {thinking ? <span className="text-faint">· {thinking}</span> : null}
          </button>
        ) : null}
        {provider?.capabilities.modes ? (
          <button
            type="button"
            onClick={() => setModeOpen(true)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12px] text-text"
            aria-label={`Mode: ${modeLabel}. Change mode`}
          >
            <Gauge size={13} className="text-muted" aria-hidden />
            <span className="font-medium">{modeLabel}</span>
          </button>
        ) : null}
      </div>

      {bannerError ? (
        <p role="alert" className="mx-3 mb-2 rounded-[10px] bg-bad-soft px-3 py-2 text-[12px] text-bad">
          {bannerError}
        </p>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-safe pb-3">
        {messages.hasNextPage ? (
          <div className="flex justify-center pb-3 pt-1">
            <button
              type="button"
              onClick={loadOlder}
              className="min-h-11 rounded-full px-4 text-[12px] font-medium text-muted hover:text-text"
              disabled={messages.isFetchingNextPage}
            >
              {messages.isFetchingNextPage ? "Loading earlier messages…" : "Load earlier messages"}
            </button>
          </div>
        ) : null}

        {messages.isLoading && merged.length === 0 ? (
          <div className="flex flex-col gap-3 pt-4">
            <Skeleton className="h-10 w-2/3 self-end" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-1/2" />
          </div>
        ) : messages.isError && merged.length === 0 ? (
          <ErrorState
            title="Could not load this conversation"
            detail="The provider history is unavailable right now."
            onRetry={() => void messages.refetch()}
          />
        ) : merged.length === 0 ? (
          <EmptyState title="No messages yet" detail="Send the first prompt to start working in this session." />
        ) : (
          <div className="pt-2">
            <Timeline items={timeline} running={running} hasMessages={merged.length > 0} />
          </div>
        )}

        {messages.isError && merged.length > 0 ? (
          <p role="alert" className="mb-2 rounded-[10px] bg-warn-soft px-3 py-2 text-[12px] text-warn">
            Showing live updates only — history could not be refreshed.
          </p>
        ) : null}

        {approvals.length > 0 || questions.length > 0 ? (
          <div className="mt-3 flex flex-col gap-3">
            {approvals.map((request) => (
              <ApprovalCard
                key={request.id}
                request={request}
                busy={cardBusy === request.id}
                error={cardError}
                onResolve={(optionId, note) => void resolveApproval(request, optionId, note)}
              />
            ))}
            {questions.map((request) => (
              <QuestionCard
                key={request.id}
                request={request}
                busy={cardBusy === request.id}
                error={cardError}
                onSubmit={(answers) => void answerQuestion(request, answers)}
              />
            ))}
          </div>
        ) : null}
      </div>

      <Composer
        session={sessionRow}
        provider={provider}
        model={selectedModel ?? models.data?.find((model) => model.id === sessionRow.model?.modelId)}
        running={running}
        onSend={send}
        onInterrupt={interrupt}
      />

      <ModelSheet
        open={modelOpen}
        onClose={() => setModelOpen(false)}
        models={models.data ?? []}
        loading={models.isLoading}
        error={models.isError ? "Models are unavailable right now." : null}
        currentModelId={sessionRow.model?.modelId ?? null}
        currentThinkingLevel={thinking ?? null}
        showThinking={provider?.capabilities.thinkingLevels === true}
        busy={sheetBusy}
        onApply={(modelId, thinkingLevel) => void applyModel(modelId, thinkingLevel)}
      />
      <ModeSheet
        open={modeOpen}
        onClose={() => setModeOpen(false)}
        modes={modes.data ?? []}
        loading={modes.isLoading}
        currentMode={sessionRow.mode ?? null}
        busy={sheetBusy}
        onApply={(mode) => void applyMode(mode)}
      />
      <DiffSheet
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        diff={diff.data ?? null}
        loading={diff.isLoading}
        error={diff.isError ? "The diff is unavailable right now." : null}
      />
      <ConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete session?"
        detail={`“${sessionRow.title ?? "Untitled session"}” will be removed from ${provider?.name ?? sessionRow.provider}. This cannot be undone.`}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={() => void deleteSession()}
      />
    </div>
  );
}
