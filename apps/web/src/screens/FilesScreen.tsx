import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { File, Folder, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectFilePreview } from "@homebase/protocol";
import { api } from "../lib/api.js";
import { useProject } from "../lib/queries.js";
import { BackButton, TopBar } from "../components/chrome.js";
import { EmptyState, ErrorState, Segmented, Spinner } from "../components/ui.js";
import { Markdown } from "../components/Markdown.js";
import { CodeBlock } from "../components/beautiful/CodeBlock.js";

export const fileSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function ImagePreview({ projectId, path, name }: { projectId: string; path: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null);
    setError(false);
    void api
      .fileImage(projectId, path, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, path]);
  return error ? (
    <p role="alert" className="text-callout text-bad">
      Image preview is unavailable.
    </p>
  ) : url ? (
    <img src={url} alt={name} className="mx-auto max-h-[70vh] max-w-full rounded-[var(--radius-md)] object-contain" />
  ) : (
    <Spinner label="Loading image" />
  );
}

export function FileContent({ preview }: { preview: ProjectFilePreview }) {
  const [mode, setMode] = useState("rendered");
  const fullText = preview.text ?? "";
  // Preview bounds also protect the phone: avoid huge DOM/highlighter work.
  const text = fullText.slice(0, 200_000).split("\n").slice(0, 2000).join("\n");
  if (preview.kind === "too-large" || preview.kind === "unsupported")
    return (
      <EmptyState
        title={
          preview.kind === "too-large"
            ? "This file is too large to preview"
            : "This file can't be previewed in Homebase yet."
        }
        detail={`${preview.name} · ${fileSize(preview.sizeBytes)}`}
      />
    );
  return (
    <div className="min-w-0">
      {preview.language === "markdown" ? (
        <div className="mb-4">
          <Segmented
            ariaLabel="Markdown view"
            options={[
              { id: "rendered", label: "Rendered" },
              { id: "source", label: "Source" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      ) : null}
      {text.length < fullText.length ? (
        <p className="mb-4 text-caption text-muted">
          Showing the first 2,000 lines or 200,000 characters to keep this preview responsive.
        </p>
      ) : null}
      {preview.language === "markdown" && mode === "rendered" ? (
        <Markdown text={text} />
      ) : (
        <CodeBlock code={text} language={preview.language} title={preview.name} />
      )}
    </div>
  );
}

export function FilesScreen() {
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string };
  const {
    path = "",
    file = false,
    rootId,
  } = useSearch({ strict: false }) as { path?: string; file?: boolean; rootId?: string };
  const project = useProject(projectId),
    navigate = useNavigate();
  const [filter, setFilter] = useState("");
  useEffect(() => setFilter(""), [path]);
  const listing = useQuery({
    queryKey: ["project-files", projectId, path],
    queryFn: ({ signal }) => api.files(projectId, path, signal),
    enabled: !!projectId && !file,
    staleTime: 0,
    gcTime: 0,
  });
  const preview = useQuery({
    queryKey: ["project-file", projectId, path],
    queryFn: ({ signal }) => api.file(projectId, path, signal),
    enabled: !!projectId && file,
    staleTime: 0,
    gcTime: 0,
  });
  const go = (target: string, isFile = false) =>
    void navigate({ to: "/p/$projectId/files", params: { projectId }, search: { path: target, file: isFile, rootId } });
  const parent = path.split("/").slice(0, -1).join("/");
  const segments = path.split("/").filter(Boolean);
  const current = file ? preview : listing;
  const visible =
    listing.data?.entries.filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase())) ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border bg-bg px-safe pb-3 pt-safe">
        <TopBar
          leading={
            <BackButton
              label={path ? "Folder" : "Project"}
              onClick={() =>
                path ? go(parent) : void navigate({ to: "/p/$projectId", params: { projectId }, search: { rootId } })
              }
            />
          }
          trailing={<span className="eyebrow">Read only</span>}
        />
        <h1 className="mt-3 truncate font-serif text-title">{file ? segments.at(-1) : "Files"}</h1>
        <nav
          aria-label="File breadcrumbs"
          className="mt-2 flex min-w-0 items-center gap-1 overflow-x-auto text-callout text-muted"
        >
          <button className="min-h-11 min-w-11 shrink-0 px-1 text-accent" onClick={() => go("")}>
            {project.data?.name ?? "Project"}
          </button>
          {segments.map((segment, index) => (
            <span key={`${index}:${segment}`} className="flex shrink-0 items-center gap-1">
              <ChevronRight size={14} aria-hidden />
              {file && index === segments.length - 1 ? (
                <span className="max-w-[200px] truncate" aria-current="page">
                  {segment}
                </span>
              ) : (
                <button
                  className="min-h-11 min-w-11 max-w-[200px] truncate px-1"
                  onClick={() => go(segments.slice(0, index + 1).join("/"))}
                >
                  {segment}
                </button>
              )}
            </span>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-safe pb-safe-scroll pt-5">
        {current.isLoading ? (
          <Spinner label={file ? "Loading file" : "Loading folder"} />
        ) : current.isError ? (
          <ErrorState
            title="Entry unavailable"
            detail="It may have moved, or it points outside this project."
            onRetry={() => void current.refetch()}
          />
        ) : file && preview.data ? (
          <>
            <p className="readout mb-4 text-caption text-muted">
              {fileSize(preview.data.sizeBytes)}
              {preview.data.language ? ` · ${preview.data.language}` : ""}
            </p>
            {preview.data.kind === "image" ? (
              <ImagePreview projectId={projectId} path={path} name={preview.data.name} />
            ) : (
              <FileContent key={path} preview={preview.data} />
            )}
          </>
        ) : listing.data ? (
          <>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter this folder"
              placeholder="Filter this folder"
              className="mb-4 min-h-11 w-full rounded-[var(--radius-md)] bg-fill px-3 text-body focus:outline-accent"
            />
            {!visible.length ? (
              <EmptyState
                title={filter ? "No files match" : "This folder is empty."}
                detail={filter ? "Try another filename." : "Folders and files appear here."}
              />
            ) : (
              <ul aria-label="Project files" className="surface overflow-hidden">
                {visible.map((entry) => (
                  <li key={entry.relativePath} className="hairline-top first:shadow-none">
                    <button
                      type="button"
                      disabled={!entry.accessible}
                      aria-label={`Open ${entry.kind === "directory" ? "folder" : "file"} ${entry.name}`}
                      onClick={() => go(entry.relativePath, entry.kind !== "directory")}
                      className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2 disabled:opacity-60"
                    >
                      {entry.kind === "directory" ? (
                        <Folder size={22} strokeWidth={1.5} className="shrink-0 text-accent" aria-hidden />
                      ) : (
                        <File size={22} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-row">{entry.name}</span>
                        <span className="readout block text-caption text-muted">
                          {!entry.accessible
                            ? "Unavailable"
                            : entry.kind === "directory"
                              ? "Folder"
                              : entry.sizeBytes != null
                                ? fileSize(entry.sizeBytes)
                                : "Folder"}
                        </span>
                      </span>
                      {entry.accessible ? <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {listing.data.truncated ? (
              <p className="mt-4 text-callout text-muted">
                Showing up to 500 entries. This folder contains more files.
              </p>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
