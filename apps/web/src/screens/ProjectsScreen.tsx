import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, FolderOpen, RefreshCw } from "lucide-react";

import type { AgentProject, AgentProvider } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { plural, relativeTime } from "../lib/format.js";
import { qk, useProviders, useProjects, useSessions } from "../lib/queries.js";
import { providerStatus, summarizeSessions } from "../lib/viewmodel.js";
import { ConnectionPill, ScreenHeader, ThemeToggle } from "../components/chrome.js";
import { Button, EmptyState, ErrorState, Group, Pill, Row, Skeleton, StatusDot } from "../components/ui.js";

function providerInitial(provider: AgentProvider | undefined, providerId: string): string {
  const name = provider?.name ?? providerId;
  return name.slice(0, 1).toUpperCase();
}

function ProjectRow({
  project,
  providers,
  onOpen,
}: {
  project: AgentProject;
  providers: AgentProvider[];
  onOpen: () => void;
}) {
  const sessions = useSessions(project.id);
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = summarizeSessions(items);
  const latest = items[0]?.updatedAt;
  const parts = [
    project.branch ?? null,
    summary.total > 0 ? plural(summary.total, "session") : null,
    summary.working > 0 ? `${summary.working} working` : null,
    summary.waiting > 0 ? `${summary.waiting} needs you` : null,
  ].filter((entry): entry is string => Boolean(entry));

  return (
    <Row
      onClick={onOpen}
      ariaLabel={`Open project ${project.name}`}
      leading={
        <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-surface-2 text-muted">
          <FolderOpen size={18} aria-hidden />
        </span>
      }
      title={project.name}
      subtitle={
        <>
          <span className="min-w-0 truncate">
            {sessions.isLoading ? "Loading sessions…" : parts.length > 0 ? parts.join(" · ") : "No sessions yet"}
          </span>
          {latest ? <span className="shrink-0 text-faint">· {relativeTime(latest)}</span> : null}
          {sessions.isError ? <span className="shrink-0 text-warn">· sessions unavailable</span> : null}
        </>
      }
      trailing={
        <span className="flex items-center gap-1.5">
          {summary.waiting > 0 ? (
            <Pill tone="waiting">Needs you</Pill>
          ) : summary.working > 0 ? (
            <Pill tone="working">Working</Pill>
          ) : null}
          {project.providersAvailable.map((providerId) => {
            const provider = providers.find((candidate) => candidate.id === providerId);
            const status = provider ? providerStatus(provider) : null;
            return (
              <span
                key={providerId}
                title={provider ? `${provider.name}: ${status?.label}` : providerId}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface font-mono text-[10px] text-muted"
              >
                {providerInitial(provider, providerId)}
              </span>
            );
          })}
          <ChevronRight size={16} className="text-faint" aria-hidden />
        </span>
      }
    />
  );
}

export function ProjectsScreen() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const providers = useProviders();
  const projects = useProjects();
  const refresh = useMutation({
    mutationFn: () => api.refreshProviders(),
    onSuccess: (list) => client.setQueryData(qk.providers, list),
  });

  const providerList = providers.data ?? [];
  const unavailable = providerList.filter((provider) => providerStatus(provider).tone !== "ok");
  const warning = unavailable
    .map((provider) => `${provider.name}: ${providerStatus(provider).detail ?? providerStatus(provider).label}`)
    .join(" ");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader large title="Homebase" subtitle={<ConnectionPill />} trailing={<ThemeToggle />} />
      <main className="min-h-0 flex-1 overflow-y-auto px-safe pb-10">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {providers.isLoading ? (
            <>
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-28" />
            </>
          ) : (
            providerList.map((provider) => {
              const status = providerStatus(provider);
              return (
                <span
                  key={provider.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px]"
                >
                  <StatusDot tone={status.tone} />
                  <span className="font-medium text-text">{provider.name}</span>
                  <span className="text-muted">{status.label}</span>
                </span>
              );
            })
          )}
          {unavailable.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => refresh.mutate()} loading={refresh.isPending}>
              <RefreshCw size={13} aria-hidden />
              Retry
            </Button>
          ) : null}
        </div>
        {warning ? <p className="mb-4 text-[12px] text-muted">{warning}</p> : null}

        {projects.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : projects.isError ? (
          <ErrorState
            title="Homebase cannot reach the Host"
            detail="Make sure the Host is running on your computer, then try again."
            onRetry={() => void projects.refetch()}
          />
        ) : (projects.data ?? []).length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={22} aria-hidden />}
            title="No projects yet"
            detail="Add a repository to your Homebase config on your computer; it will show up here."
          />
        ) : (
          <Group title="Projects">
            {(projects.data ?? []).map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                providers={providerList}
                onOpen={() => void navigate({ to: "/p/$projectId", params: { projectId: project.id } })}
              />
            ))}
          </Group>
        )}
      </main>
    </div>
  );
}
