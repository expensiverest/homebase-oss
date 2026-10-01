import { useNavigate, useParams } from "@tanstack/react-router";
import { useOverview, useRootProjects } from "../lib/queries.js";
import { BackButton, TopBar } from "../components/chrome.js";
import { EmptyState, ErrorState, Group, Spinner } from "../components/ui.js";
import { ProjectRow } from "../components/ProjectRow.js";
export function RootScreen() {
  const { rootId = "" } = useParams({ strict: false }) as { rootId?: string };
  const navigate = useNavigate(),
    overview = useOverview(),
    projects = useRootProjects(rootId);
  const root = overview.data?.roots.find((r) => r.id === rootId);
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-safe pb-safe-scroll">
      <header className="pt-safe">
        <TopBar leading={<BackButton label="Projects" onClick={() => void navigate({ to: "/" })} />} />
        <h1 className="mt-4 break-words font-serif text-title">{root?.name ?? "Folder"}</h1>
        {root ? <p className="readout mt-2 truncate text-caption text-muted">{root.path}</p> : null}
      </header>
      <div className="mt-9">
        {projects.isLoading ? (
          <Spinner label="Loading projects" />
        ) : projects.isError ? (
          <ErrorState
            title="Folder unavailable"
            detail="Check the configured folder on the Host."
            onRetry={() => void projects.refetch()}
          />
        ) : !projects.data?.length ? (
          <EmptyState
            title="No projects discovered in this folder"
            detail={
              root?.available === false
                ? "The configured folder is currently unavailable."
                : "Repositories in this folder will appear here."
            }
          />
        ) : (
          <Group title="Projects" trailing={projects.data.length}>
            {projects.data.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onOpen={() =>
                  void navigate({ to: "/p/$projectId", params: { projectId: project.id }, search: { rootId } })
                }
              />
            ))}
          </Group>
        )}
      </div>
    </main>
  );
}
