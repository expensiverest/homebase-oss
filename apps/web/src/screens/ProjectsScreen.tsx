import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import type { AgentProject } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { relativeTime } from "../lib/format.js";
import { qk, useProviders, useProjects, useSessions } from "../lib/queries.js";
import { summarizeSessions } from "../lib/viewmodel.js";
import { ConnectionPill, ProviderHealth, ThemeToggle, TopBar } from "../components/chrome.js";
import { ProjectMark } from "../components/marks.js";
import { BranchChip, EmptyState, ErrorState, Group, Pill, Skeleton } from "../components/ui.js";

function ProjectRow({ project, onOpen }: { project: AgentProject; onOpen: () => void }) {
  const sessions = useSessions(project.id);
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? [];
  const summary = summarizeSessions(items);
  const latest = items[0]?.updatedAt;
  const more = sessions.hasNextPage ? "+" : "";

  const activity = sessions.isLoading ? (
    <span className="text-muted">Loading…</span>
  ) : sessions.isError ? (
    <span className="text-warn">Sessions unavailable</span>
  ) : summary.working > 0 ? (
    <span className="inline-flex items-center gap-1.5 text-accent">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
      {summary.working} working
    </span>
  ) : summary.total > 0 ? (
    <span>
      {summary.total}
      {more} {summary.total === 1 && !more ? "session" : "sessions"}
    </span>
  ) : (
    <span>No sessions yet</span>
  );

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open project ${project.name}`}
      className="hairline-top flex min-h-[80px] w-full items-center gap-4 px-4 py-4 text-left transition-colors first:shadow-none active:bg-surface-2"
    >
      <ProjectMark name={project.name} working={summary.working > 0} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-row font-semibold text-text">{project.name}</span>
          {summary.waiting > 0 ? (
            <span className="self-center">
              <Pill tone="waiting">Needs you</Pill>
            </span>
          ) : latest ? (
            <span className="readout shrink-0 text-caption text-muted">{relativeTime(latest)}</span>
          ) : null}
        </span>
        <span className="mt-1.5 flex min-w-0 items-center gap-2 text-callout text-muted">
          {project.branch ? <BranchChip branch={project.branch} className="max-w-[55%] shrink" /> : null}
          <span className="min-w-0 shrink-0 truncate">{activity}</span>
        </span>
      </span>
      <ChevronRight size={18} className="-mr-1 shrink-0 text-faint" aria-hidden />
    </button>
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

  const list = projects.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto px-safe pb-12">
        <header className="pt-safe">
          <TopBar
            leading={
              <span className="inline-flex items-center gap-2.5">
                <span className="eyebrow">Homebase</span>
                <ConnectionPill />
              </span>
            }
            trailing={<ThemeToggle />}
          />
          <h1 className="mt-4 font-serif text-display text-text">Projects</h1>
          <p className="mt-2 text-row text-muted">Your coding agents, on your computer.</p>
          <div className="mt-4">
            <ProviderHealth
              providers={providers.data ?? []}
              loading={providers.isLoading}
              onRetry={() => refresh.mutate()}
              retrying={refresh.isPending}
            />
          </div>
        </header>

        <div className="mt-9">
          {projects.isLoading ? (
            <div className="surface overflow-hidden">
              {[0, 1, 2].map((index) => (
                <div key={index} className="hairline-top flex min-h-[80px] items-center gap-4 px-4 first:shadow-none">
                  <Skeleton className="h-11 w-11 rounded-[30%]" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3.5 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : projects.isError ? (
            <ErrorState
              title="Homebase cannot reach the Host"
              detail="Make sure the Host is running on your computer, then try again."
              onRetry={() => void projects.refetch()}
            />
          ) : list.length === 0 ? (
            <EmptyState
              title="No projects yet"
              detail="Add a repository to your Homebase config on your computer; it will show up here."
            />
          ) : (
            <Group title="Projects" trailing={list.length}>
              {list.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  onOpen={() => void navigate({ to: "/p/$projectId", params: { projectId: project.id } })}
                />
              ))}
            </Group>
          )}
        </div>
      </main>
    </div>
  );
}
