import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowDown, ArrowUpLeft, FileDiff, SlidersHorizontal, Trash2, Users } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AgentApprovalRequest, AgentAttachmentRef, AgentMessage, AgentQuestionRequest } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { useChatScroll } from "../lib/chatScroll.js";
import { useLive } from "../lib/live.js";
import {
  qk,
  useActions,
  useDiff,
  useMessages,
  useModels,
  useModes,
  useProject,
  useProviders,
  useSession,
} from "../lib/queries.js";
import { currentSubagents, foldTimeline, levelLabel, modelDisplayName, sessionStatus } from "../lib/viewmodel.js";
import { ApprovalCard, QuestionCard } from "../components/ActionCards.js";
import { Timeline } from "../components/ChatTimeline.js";
import { Composer, type ComposerAction } from "../components/Composer.js";
import { BackButton, ConnectionPill, TopBar } from "../components/chrome.js";
import { ProviderGlyph } from "../components/marks.js";
import { AgentsSheet, AgentsStrip, useAgentsStripVisible } from "../components/AgentsStatus.js";
import { ConfirmSheet, DiffSheet, ModelSheet, ModeSheet } from "../components/Sheets.js";
import { EmptyState, ErrorState, IconButton, Pill, PickerButton, Skeleton } from "../components/ui.js";

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
  // A sub-agent's thread is an ordinary session with a parent: it reads like one,
  // is clearly labelled, and always leads back to the session that spawned it.
  const parentId = sessionRow?.parentSessionId ?? null;
  const isSubagent = parentId !== null;
  const parentSession = useSession(parentId ?? undefined);
  const parentTitle = parentSession.data?.title ?? "the parent session";
  const provider = providers.data?.find((candidate) => candidate.id === sessionRow?.provider);
  const project = useProject(sessionRow?.projectId);
  const backLabel = project.data?.name ?? "Project";

  const canApprove = provider?.capabilities.approvals === true;
  const canQuestion = provider?.capabilities.questions === true;
  const actions = useActions(id || undefined, canApprove || canQuestion);
  const models = useModels(sessionRow?.projectId, sessionRow?.provider, provider?.capabilities.models === true);
  const modes = useModes(sessionRow?.projectId, sessionRow?.provider, provider?.capabilities.modes === true);

  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
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
  const agents = useMemo(() => currentSubagents(timeline), [timeline]);
  const agentsStripVisible = useAgentsStripVisible(agents, id);
  const running = overlay?.running ?? sessionRow?.state === "working";

  const { scrollRef, contentRef, atBottom, scrolled, scrollToBottom, captureHeight, restoreHeight } = useChatScroll();
  const initialScrollDone = useRef(false);
  // Height before older messages were prepended; consumed before paint so the reader stays put.
  const prependAnchor = useRef<number | null>(null);

  useEffect(() => {
    initialScrollDone.current = false;
    // Opening a thread from the Agents sheet reuses this screen with a new id.
    setAgentsOpen(false);
  }, [id]);

  // Open at the newest message. `scrollToBottom` only succeeds once the thread element exists (the
  // screen shows a skeleton first), so "done" is recorded only when it really pinned; a new session
  // id re-arms it.
  const hasMessages = fetched.length > 0;
  useEffect(() => {
    if (!hasMessages || initialScrollDone.current) return;
    if (scrollToBottom()) initialScrollDone.current = true;
  }, [id, hasMessages, scrollToBottom]);

  // Older messages arrive above the reader: shift the scroll by exactly what was added, before
  // paint, so the message they were looking at does not move and nothing jumps to the bottom.
  useLayoutEffect(() => {
    if (prependAnchor.current === null) return;
    restoreHeight(prependAnchor.current);
    prependAnchor.current = null;
  }, [fetched.length, restoreHeight]);

  // Fetched history is authoritative: prune overlay copies that history
  // already contains (running state is considered inside `prune`).
  useEffect(() => {
    if (fetched.length === 0) return;
    useLive.getState().prune(id, fetched);
  }, [fetched, id]);

  const loadOlder = () => {
    prependAnchor.current = captureHeight();
    void messages.fetchNextPage().finally(() => {
      // Whatever happened, a stale anchor must never shift an unrelated later update.
      requestAnimationFrame(() => {
        prependAnchor.current = null;
      });
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
      <div className="flex min-h-0 flex-1 flex-col px-safe pt-safe">
        <TopBar leading={<BackButton label="Projects" onClick={() => void navigate({ to: "/" })} />} />
        <div className="mt-3 flex flex-col gap-3">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-6 h-12 w-3/5 self-end rounded-[20px]" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (session.isError || !sessionRow) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-safe pt-safe">
        <TopBar leading={<BackButton label="Projects" onClick={() => void navigate({ to: "/" })} />} />
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
  const modelLabel = selectedModel?.name ?? modelDisplayName(sessionRow.model?.modelId) ?? "Model";
  const modeLabel = modes.data?.find((mode) => mode.id === sessionRow.mode)?.name ?? sessionRow.mode ?? "Mode";
  const thinking = sessionRow.model?.thinkingLevel ?? sessionRow.thinkingLevel;
  const approvals = actions.data?.approvals ?? [];
  const questions = actions.data?.questions ?? [];

  // The top bar is its own row above the thread, so Back is always one tap away, however far the
  // thread has scrolled.
  const topBar = (
    <TopBar
      leading={
        <BackButton
          label={isSubagent ? (parentSession.data?.title ?? "Parent session") : backLabel}
          onClick={() =>
            isSubagent
              ? void navigate({ to: "/s/$sessionId", params: { sessionId: parentId } })
              : void navigate({ to: "/p/$projectId", params: { projectId: sessionRow.projectId } })
          }
        />
      }
      trailing={
        <>
          {provider?.capabilities.diffs ? (
            <IconButton label="Show changes" onClick={() => setDiffOpen(true)}>
              <FileDiff size={20} aria-hidden />
            </IconButton>
          ) : null}
          {provider?.capabilities.deleteSession && !isSubagent ? (
            <IconButton label="Delete session" onClick={() => setConfirmOpen(true)}>
              <Trash2 size={20} aria-hidden />
            </IconButton>
          ) : null}
        </>
      }
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-thread-topbar
        className={`relative z-20 shrink-0 border-b bg-bg px-safe pb-1 pt-safe transition-colors duration-200 ${
          scrolled ? "border-[var(--chrome-border)]" : "border-transparent"
        }`}
      >
        {topBar}
      </div>
      <div
        ref={scrollRef}
        data-chat-scroll
        className="min-h-0 flex-1 overflow-y-auto px-safe pb-6 [overflow-anchor:none]"
      >
        <div ref={contentRef}>
          <header className="pb-5 pt-2">
            {isSubagent ? (
              <div className="mt-2 flex flex-col items-start gap-0.5" data-subagent-header>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-caption font-semibold text-accent">
                  <Users size={13} strokeWidth={2.4} aria-hidden />
                  Sub-agent
                </span>
                <button
                  type="button"
                  onClick={() => void navigate({ to: "/s/$sessionId", params: { sessionId: parentId } })}
                  className="-ml-2 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-[12px] px-2 text-callout text-muted active:bg-fill"
                >
                  <ArrowUpLeft size={15} strokeWidth={2.25} className="shrink-0" aria-hidden />
                  <span className="truncate">
                    Spawned by <span className="font-medium text-text">{parentTitle}</span>
                  </span>
                </button>
              </div>
            ) : null}
            <h1
              className={`mt-2 line-clamp-3 break-words text-heading font-semibold ${sessionRow.title ? "text-text" : "italic text-muted"}`}
            >
              {sessionRow.title ?? "Untitled session"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-callout text-muted">
              <span className="inline-flex items-center gap-1.5">
                <ProviderGlyph providerId={sessionRow.provider} size={15} />
                {provider?.name ?? sessionRow.provider}
              </span>
              {status.tone === "working" || running ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                  <span aria-hidden className="hb-pulse h-1.5 w-1.5 rounded-full bg-accent" />
                  Working
                </span>
              ) : status.tone === "waiting" ? (
                <Pill tone="waiting">Needs you</Pill>
              ) : status.tone === "failed" ? (
                <span className="font-medium text-bad">Failed</span>
              ) : null}
              <ConnectionPill hideWhenConnected />
            </div>
          </header>

          {bannerError ? (
            <p role="alert" className="mb-4 rounded-[var(--radius-md)] bg-bad-soft px-4 py-3 text-callout text-bad">
              {bannerError}
            </p>
          ) : null}

          {messages.hasNextPage ? (
            <div className="flex justify-center pb-3 pt-1">
              <button
                type="button"
                onClick={loadOlder}
                className="min-h-11 rounded-full bg-fill px-4 text-callout font-medium text-muted hover:text-text"
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
            <div>
              <Timeline items={timeline} running={running} runStartedAt={overlay?.runStartedAt ?? null} />
            </div>
          )}

          {messages.isError && merged.length > 0 ? (
            <p role="alert" className="mb-3 rounded-[var(--radius-md)] bg-warn-soft px-4 py-3 text-callout text-warn">
              Showing live updates only — history could not be refreshed.
            </p>
          ) : null}

          {approvals.length > 0 || questions.length > 0 ? (
            <div className="mt-2 flex flex-col gap-3">
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

        {/* Zero-height sticky rail: the button rides the bottom of the visible thread, above the composer. */}
        <div className="pointer-events-none sticky bottom-3 z-10 h-0" aria-hidden={atBottom || undefined}>
          <div className="absolute inset-x-0 bottom-0 flex justify-center">
            <button
              type="button"
              data-jump-to-bottom
              tabIndex={atBottom ? -1 : 0}
              // Do not take focus from the composer: on iOS that closes the keyboard, the view resizes
              // under the finger, and the tap is lost (it took two presses). The click still fires.
              onMouseDown={(event) => event.preventDefault()}
              onClick={scrollToBottom}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-callout font-semibold text-text shadow-[var(--shadow-surface)] transition-[opacity,transform] duration-200 active:scale-[0.96] ${
                atBottom ? "pointer-events-none translate-y-2 opacity-0" : "pointer-events-auto opacity-100"
              }`}
            >
              <ArrowDown size={16} strokeWidth={2.4} aria-hidden />
              Jump to bottom
            </button>
          </div>
        </div>
      </div>

      {isSubagent ? (
        <div
          className="relative z-10 border-t border-[var(--chrome-border)] bg-chrome px-safe pb-safe-composer pt-3 backdrop-blur-xl backdrop-saturate-150"
          data-subagent-footer
        >
          <div className="mx-auto flex max-w-[680px] items-center gap-3">
            <p className="min-w-0 flex-1 text-callout text-muted">
              Sub-agent thread. Read only — reply from the parent session.
            </p>
            <button
              type="button"
              onClick={() => void navigate({ to: "/s/$sessionId", params: { sessionId: parentId } })}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-callout font-semibold text-on-accent shadow-[var(--shadow-accent)] transition-transform active:scale-[0.96]"
            >
              <ArrowUpLeft size={16} strokeWidth={2.4} aria-hidden />
              Parent
            </button>
          </div>
        </div>
      ) : (
        <Composer
          session={sessionRow}
          provider={provider}
          model={selectedModel ?? models.data?.find((model) => model.id === sessionRow.model?.modelId)}
          running={running}
          onSend={send}
          onInterrupt={interrupt}
          status={agentsStripVisible ? <AgentsStrip agents={agents} onOpen={() => setAgentsOpen(true)} /> : null}
          controls={
            provider?.capabilities.models || provider?.capabilities.modes ? (
              <>
                {provider?.capabilities.models ? (
                  <PickerButton
                    value={modelLabel}
                    detail={thinking ? `· ${levelLabel(selectedModel, thinking)}` : undefined}
                    icon={<span aria-hidden className="block h-1.5 w-1.5 rounded-full bg-accent" />}
                    ariaLabel={`Model: ${modelLabel}. Change model`}
                    onClick={() => setModelOpen(true)}
                    className="min-w-0 flex-1"
                  />
                ) : null}
                {provider?.capabilities.modes ? (
                  <PickerButton
                    value={modeLabel}
                    icon={<SlidersHorizontal size={16} aria-hidden />}
                    ariaLabel={`Mode: ${modeLabel}. Change mode`}
                    onClick={() => setModeOpen(true)}
                    className="max-w-[46%] shrink-0"
                  />
                ) : null}
              </>
            ) : null
          }
        />
      )}

      <AgentsSheet open={agentsOpen && agents.length > 0} onClose={() => setAgentsOpen(false)} agents={agents} />
      {modelOpen ? (
        <ModelSheet
          open
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
      ) : null}
      {modeOpen ? (
        <ModeSheet
          open
          onClose={() => setModeOpen(false)}
          modes={modes.data ?? []}
          loading={modes.isLoading}
          currentMode={sessionRow.mode ?? null}
          busy={sheetBusy}
          onApply={(mode) => void applyMode(mode)}
        />
      ) : null}
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
