import { ChevronRight } from "lucide-react";
import type { ProjectSummary } from "@homebase/protocol";
import { relativeTime } from "../lib/format.js";
import { ProjectMark } from "./marks.js";
import { BranchChip, Pill } from "./ui.js";

/** List rows consume a single Host overview; no per-project session queries. */
export function ProjectRow({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open project ${project.name}`}
      className="hairline-top flex min-h-[80px] w-full items-center gap-4 px-4 py-4 text-left first:shadow-none active:bg-surface-2"
    >
      <ProjectMark name={project.name} working={project.workingCount > 0} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-row font-semibold">{project.name}</span>
          {project.waitingCount ? (
            <Pill tone="waiting">Needs you</Pill>
          ) : project.lastActivityAt ? (
            <span className="readout shrink-0 text-caption text-muted">{relativeTime(project.lastActivityAt)}</span>
          ) : null}
        </span>
        <span className="mt-1.5 flex min-w-0 items-center gap-2 text-callout text-muted">
          {project.branch ? <BranchChip branch={project.branch} className="max-w-[55%] shrink" /> : null}
          <span className="min-w-0 truncate">
            {project.workingCount
              ? `${project.workingCount} working`
              : project.knownSessionCount
                ? `${project.knownSessionCount} known ${project.knownSessionCount === 1 ? "session" : "sessions"}`
                : "Open project"}
          </span>
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden />
    </button>
  );
}
