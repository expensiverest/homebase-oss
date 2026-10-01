import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";

import type { AgentProvider, AgentSession } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { relativeTime, shortenPath } from "../lib/format.js";
import { qk, useProject, useProviders, useSessions } from "../lib/queries.js";
import { modelDisplayName, providerStatus, sessionStatus } from "../lib/viewmodel.js";
import { BackButton, ProviderHealth, TopBar } from "../components/chrome.js";
import { ProjectMark, ProviderMark } from "../components/marks.js";
import { SessionLauncher } from "../components/SessionLauncher.js";
import { BranchChip, Button, EmptyState, ErrorState, Group, Pill, Skeleton } from "../components/ui.js";

function SessionState({ session }: { session: AgentSession }) {
  const status = sessionStatus(session.state);
  if (status.tone === "waiting") return <Pill tone="waiting">Needs you</Pill>;
  if (status.tone === "working")
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-accent">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        Working
      </span>
    );
  if (status.tone === "failed") return <span className="shrink-0 font-medium text-bad">Failed</span>;
  return null;
}

function SessionRow({
  session,
  provider,
  onOpen,
}: {
  session: AgentSession;
  provider: AgentProvider | undefined;
  onOpen: () => void;
}) {
  const title = session.title?.trim() || "Untitled session";
  const model = modelDisplayName(session.model?.modelId);
  const working = session.state === "working";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open session ${title}`}
      className="hairline-top flex min-h-[80px] w-full items-center gap-4 px-4 py-4 text-left transition-colors first:shadow-none active:bg-surface-2"
    >
      <ProviderMark providerId={session.provider} provider={provider} working={working} size={38} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-start gap-2">
          <span
            className={`line-clamp-2 min-w-0 flex-1 break-words text-row font-medium ${session.title ? "text-text" : "italic text-muted"}`}
          >
            {title}
          </span>
          <span className="readout mt-[3px] shrink-0 text-caption text-muted">{relativeTime(session.updatedAt)}</span>
        </span>
        <span className="mt-1.5 flex min-w-0 items-center gap-2 text-callout text-muted">
          <SessionState session={session} />
          <span className="min-w-0 truncate">
            {provider?.name ?? session.provider}
            {model ? ` · ${model}` : ""}
          </span>
        </span>
      </span>
    </button>
  );
}

export function ProjectScreen() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const navigate = useNavigate();
  const { rootId } = useSearch({ strict: false }) as { rootId?: string };
  const client = useQueryClient();
  const project = useProject(projectId);
  const providers = useProviders();
  const sessions = useSessions(projectId);
  const refresh = useMutation({
    mutationFn: () => api.refreshProviders(),
    onSuccess: (list) => client.setQueryData(qk.providers, list),
  });

  const providerList = providers.data ?? [];
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? [];
  const projectValue = project.data;
  const projectProviders = providerList.filter((provider) =>
    (projectValue?.providersAvailable ?? []).includes(provider.id),
  );
  const name = projectValue?.name ?? "";

  const openSession = (session: AgentSession) => {
    void navigate({ to: "/s/$sessionId", params: { sessionId: session.id } });
  };

  const created = (session: AgentSession) => {
    void client.invalidateQueries({ queryKey: qk.sessions(session.projectId) });
    void navigate({ to: "/s/$sessionId", params: { sessionId: session.id } });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto px-safe pb-safe-scroll">
        <header className="pt-safe">
          <TopBar
            leading={
              <BackButton
                label={rootId ? "Folder" : "Projects"}
                onClick={() =>
                  rootId ? void navigate({ to: "/r/$rootId", params: { rootId } }) : void navigate({ to: "/" })
                }
              />
            }
            trailing={
              projectId ? (
                <button
                  type="button"
                  className="min-h-11 px-3 text-callout font-medium text-accent"
                  onClick={() =>
                    void navigate({
                      to: "/p/$projectId/files",
                      params: { projectId },
                      search: { path: "", file: false, rootId },
                    })
                  }
                >
                  Files
                </button>
              ) : null
            }
          />
          {project.isLoading ? (
            <div className="mt-4 flex items-center gap-4">
              <Skeleton className="h-14 w-14 rounded-[30%]" />
              <Skeleton className="h-9 w-48" />
            </div>
          ) : project.isError || !projectValue ? (
            <ErrorState
              title="Project unavailable"
              detail="The Host could not find this project."
              onRetry={() => void project.refetch()}
            />
          ) : (
            <div className="mt-4 flex items-center gap-4">
              <ProjectMark name={name} size={56} working={items.some((session) => session.state === "working")} />
              <div className="min-w-0 flex-1">
                <h1
                  className={`line-clamp-2 break-words font-serif text-text ${name.length > 20 ? "text-[1.875rem] leading-[1.08]" : "text-title"}`}
                >
                  {name}
                </h1>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {projectValue.branch ? <BranchChip branch={projectValue.branch} className="max-w-full" /> : null}
                  <span className="readout min-w-0 max-w-full truncate text-caption text-muted">
                    {shortenPath(projectValue.path)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </header>

        {projectValue ? (
          <>
            {projectProviders.some((provider) => providerStatus(provider).tone !== "ok") ? (
              <div className="mt-6">
                <ProviderHealth
                  providers={projectProviders}
                  context="project"
                  onRetry={() => refresh.mutate()}
                  retrying={refresh.isPending}
                />
              </div>
            ) : null}

            <div className="mt-7">
              <SessionLauncher project={projectValue} providers={providerList} onCreated={created} />
            </div>

            <div className="mt-9">
              {sessions.isLoading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-[76px] w-full rounded-[var(--radius-lg)]" />
                  <Skeleton className="h-[76px] w-full rounded-[var(--radius-lg)]" />
                </div>
              ) : sessions.isError ? (
                <ErrorState
                  title="Could not load sessions"
                  detail="Sessions from this project are unavailable right now."
                  onRetry={() => void sessions.refetch()}
                />
              ) : items.length === 0 ? (
                <EmptyState title="A clean slate" detail={`No sessions in ${name} yet. Start one above.`} />
              ) : (
                <>
                  <Group title="Sessions" trailing={`${items.length}${sessions.hasNextPage ? "+" : ""}`}>
                    {items.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        provider={providerList.find((candidate) => candidate.id === session.provider)}
                        onOpen={() => openSession(session)}
                      />
                    ))}
                  </Group>
                  {sessions.hasNextPage ? (
                    <Button
                      className="mt-3 w-full"
                      onClick={() => void sessions.fetchNextPage()}
                      loading={sessions.isFetchingNextPage}
                    >
                      Load older sessions
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
