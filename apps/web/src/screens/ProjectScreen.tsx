import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ChevronRight, Inbox, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { AgentProvider, AgentProject, AgentSession } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { relativeTime } from "../lib/format.js";
import { qk, useProject, useProviders, useSessions } from "../lib/queries.js";
import { providerStatus, sessionStatus } from "../lib/viewmodel.js";
import { ScreenHeader } from "../components/chrome.js";
import { NewSessionSheet } from "./NewSessionSheet.js";
import { Button, EmptyState, ErrorState, Group, IconButton, Pill, Row, Skeleton, Spinner } from "../components/ui.js";

function providerInitial(provider: AgentProvider | undefined, providerId: string): string {
  return (provider?.name ?? providerId).slice(0, 1).toUpperCase();
}

function sessionModelLabel(session: AgentSession): string | null {
  const modelId = session.model?.modelId;
  if (!modelId) return null;
  const tail = modelId.includes("/") ? modelId.split("/").pop() : modelId;
  return tail ?? null;
}

function trailingFor(session: AgentSession) {
  const status = sessionStatus(session.state);
  if (status.tone === "waiting") return <Pill tone="waiting">Needs you</Pill>;
  if (status.tone === "working") return <Pill tone="working">Working</Pill>;
  if (status.tone === "failed") return <Pill tone="failed">Failed</Pill>;
  return <ChevronRight size={16} className="text-faint" aria-hidden />;
}

export function ProjectScreen() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const navigate = useNavigate();
  const client = useQueryClient();
  const project = useProject(projectId);
  const providers = useProviders();
  const sessions = useSessions(projectId);
  const [newOpen, setNewOpen] = useState(false);

  const providerList = providers.data ?? [];
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? [];
  const projectProviders = (project.data?.providersAvailable ?? []).map((providerId) => ({
    providerId,
    provider: providerList.find((candidate) => candidate.id === providerId),
  }));
  const outage = projectProviders.filter(({ provider }) => (provider ? providerStatus(provider).tone !== "ok" : false));

  const openSession = (session: AgentSession) => {
    void navigate({ to: "/s/$sessionId", params: { sessionId: session.id } });
  };

  const created = (session: AgentSession) => {
    setNewOpen(false);
    void client.invalidateQueries({ queryKey: qk.sessions(session.projectId) });
    void navigate({ to: "/s/$sessionId", params: { sessionId: session.id } });
  };

  const goBack = () => {
    void navigate({ to: "/" });
  };

  const projectValue: AgentProject | undefined = project.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={projectValue?.name ?? "Project"}
        subtitle={
          <>
            {projectValue?.branch ? <span className="truncate font-mono">{projectValue.branch}</span> : null}
            <span className="shrink-0">
              {sessions.data ? `${items.length}${sessions.hasNextPage ? "+" : ""} sessions` : ""}
            </span>
          </>
        }
        onBack={goBack}
        trailing={
          <IconButton label="New session" onClick={() => setNewOpen(true)} disabled={projectProviders.length === 0}>
            <Plus size={20} aria-hidden />
          </IconButton>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-safe pb-10">
        {outage.length > 0 ? (
          <div className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-text">
                {outage.map(({ provider, providerId }) => provider?.name ?? providerId).join(", ")} unavailable
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                Sessions from other providers still work. Start the provider or retry once it is ready.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void api.refreshProviders().then((list) => {
                  client.setQueryData(qk.providers, list);
                })
              }
            >
              <RefreshCw size={13} aria-hidden />
              Retry
            </Button>
          </div>
        ) : null}

        {sessions.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : sessions.isError ? (
          <ErrorState
            title="Could not load sessions"
            detail="Sessions from this project are unavailable right now."
            onRetry={() => void sessions.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} aria-hidden />}
            title="No sessions yet"
            detail="Start a session with OpenCode or Claude Code in this project."
            action={
              <Button variant="primary" onClick={() => setNewOpen(true)} disabled={projectProviders.length === 0}>
                <Plus size={16} aria-hidden />
                New session
              </Button>
            }
          />
        ) : (
          <>
            <Group title="Sessions">
              {items.map((session) => {
                const provider = providerList.find((candidate) => candidate.id === session.provider);
                const model = sessionModelLabel(session);
                return (
                  <Row
                    key={session.id}
                    onClick={() => openSession(session)}
                    ariaLabel={`Open session ${session.title ?? "Untitled session"}`}
                    leading={
                      <span
                        title={provider?.name ?? session.provider}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 font-mono text-[12px] text-muted"
                      >
                        {providerInitial(provider, session.provider)}
                      </span>
                    }
                    title={session.title ?? "Untitled session"}
                    subtitle={
                      <>
                        <span className="shrink-0 text-faint">{relativeTime(session.updatedAt)}</span>
                        {model ? <span className="min-w-0 truncate font-mono text-faint">· {model}</span> : null}
                      </>
                    }
                    trailing={trailingFor(session)}
                  />
                );
              })}
            </Group>
            {sessions.hasNextPage ? (
              <div className="flex justify-center py-2">
                <Button size="sm" onClick={() => void sessions.fetchNextPage()} loading={sessions.isFetchingNextPage}>
                  {sessions.isFetchingNextPage ? <Spinner label="Loading older sessions" /> : null}
                  Load older sessions
                </Button>
              </div>
            ) : null}
          </>
        )}
      </main>

      {projectValue ? (
        <NewSessionSheet
          open={newOpen}
          onClose={() => setNewOpen(false)}
          project={projectValue}
          providers={providerList}
          onCreated={created}
        />
      ) : null}
    </div>
  );
}
