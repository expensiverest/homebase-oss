import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { api } from "../lib/api.js";
import { qk, useProviders, useOverview } from "../lib/queries.js";
import { ConnectionPill, ProviderHealth, ThemeToggle, TopBar } from "../components/chrome.js";
import { Folder } from "lucide-react";
import { ProjectRow } from "../components/ProjectRow.js";
import { ProviderUsageSheet } from "../components/Usage.js";
import { EmptyState, ErrorState, Group, Skeleton } from "../components/ui.js";

export function ProjectsScreen() {
  const [installHint, setInstallHint] = useState(() => {
    try {
      return (
        sessionStorage.getItem("hb.justPaired") === "1" &&
        localStorage.getItem("hb.installHintDismissed") !== "1" &&
        !window.matchMedia("(display-mode: standalone)").matches
      );
    } catch {
      return false;
    }
  });
  const navigate = useNavigate();
  const client = useQueryClient();
  const providers = useProviders();
  const projects = useOverview();
  const [usageOpen, setUsageOpen] = useState(false);
  const refresh = useMutation({
    mutationFn: () => api.refreshProviders(),
    onSuccess: (list) => client.setQueryData(qk.providers, list),
  });

  const list = projects.data?.roots ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto px-safe pb-safe-scroll">
        <header className="pt-safe">
          <TopBar
            leading={
              <span className="inline-flex items-center gap-2.5">
                <span className="eyebrow">Homebase</span>
                <ConnectionPill />
              </span>
            }
            trailing={
              <span className="flex items-center gap-2">
                <button
                  className="min-h-11 px-2 text-callout text-muted"
                  onClick={() => void navigate({ to: "/devices" })}
                >
                  Devices
                </button>
                <ThemeToggle />
              </span>
            }
          />
          <div className="mt-4 flex items-center justify-between gap-4">
            <h1 className="font-serif text-display text-text">Projects</h1>
            <button
              type="button"
              onClick={() => setUsageOpen(true)}
              className="min-h-11 px-3 text-callout font-medium text-accent"
            >
              Usage
            </button>
          </div>
          <p className="mt-2 text-row text-muted">Your coding agents, on your computer.</p>
          {installHint && (
            <div className="mt-4 rounded-xl bg-surface px-4 py-3 text-callout text-muted">
              <p>For quick access on iPhone or iPad, use Share → Add to Home Screen.</p>
              <button
                className="mt-2 min-h-11 text-accent"
                onClick={() => {
                  setInstallHint(false);
                  try {
                    localStorage.setItem("hb.installHintDismissed", "1");
                    sessionStorage.removeItem("hb.justPaired");
                  } catch {
                    /* optional hint */
                  }
                }}
              >
                Got it
              </button>
            </div>
          )}
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
            <div className="space-y-7">
              {projects.data?.recent.length ? (
                <Group title="Recent" trailing={projects.data.recent.length}>
                  {projects.data.recent.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      onOpen={() => void navigate({ to: "/p/$projectId", params: { projectId: project.id } })}
                    />
                  ))}
                </Group>
              ) : null}
              <Group title="Folders" trailing={list.length}>
                {list.map((root) => (
                  <button
                    key={root.id}
                    type="button"
                    aria-label={`Open folder ${root.name}`}
                    onClick={() => void navigate({ to: "/r/$rootId", params: { rootId: root.id } })}
                    className="hairline-top flex min-h-[80px] w-full items-center gap-4 px-4 py-4 text-left first:shadow-none active:bg-surface-2"
                  >
                    <Folder size={30} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-row font-semibold">{root.name}</span>
                      <span className="mt-1 block truncate text-callout text-muted">
                        {root.available
                          ? `${root.projectCount} ${root.projectCount === 1 ? "project" : "projects"}`
                          : "Folder unavailable"}
                      </span>
                      {list.filter((r) => r.name === root.name).length > 1 ? (
                        <span className="readout block truncate text-caption text-muted">{root.path}</span>
                      ) : null}
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden />
                  </button>
                ))}
              </Group>
            </div>
          )}
        </div>
      </main>
      <ProviderUsageSheet open={usageOpen} onClose={() => setUsageOpen(false)} providers={providers.data ?? []} />
    </div>
  );
}
