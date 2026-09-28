import { FileText, ImageIcon, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { AgentAttachmentRef, AgentContentPart } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { authHeaders, getTransport } from "../lib/transport.js";
import { bytesLabel } from "../lib/format.js";
import { shorten } from "../lib/viewmodel.js";
import { IconButton } from "./ui.js";

/**
 * Attachment bytes are fetched with the same credentials as every API call and
 * turned into object URLs that are revoked on unmount.
 */
export function useAttachmentObjectUrl(attachmentId: string | undefined, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!attachmentId || !enabled) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    getTransport()
      .fetch(api.attachmentUrl(attachmentId), { headers: { ...authHeaders() } })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("attachment"))))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [attachmentId, enabled]);

  return url;
}

export function ImagePart({ part }: { part: Extract<AgentContentPart, { type: "image" }> }) {
  const url = useAttachmentObjectUrl(part.attachmentId, true);
  return (
    <figure className="my-1.5 max-w-[240px]">
      {url ? (
        <img
          src={url}
          alt={part.alt ?? part.name ?? "Attached image"}
          className="max-h-[240px] rounded-[var(--radius-md)] border border-border"
        />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-[var(--radius-md)] border border-border bg-surface-2 text-faint">
          <ImageIcon size={20} aria-hidden />
        </div>
      )}
      {part.name ? (
        <figcaption className="mt-1 truncate font-mono text-[11px] text-faint">{part.name}</figcaption>
      ) : null}
    </figure>
  );
}

export function FileChip({ name, mimeType, sizeBytes }: { name: string; mimeType: string; sizeBytes?: number | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-[12px] border border-border bg-surface px-2.5 py-1.5">
      <FileText size={14} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium text-text">{shorten(name, 42)}</span>
        <span className="block truncate font-mono text-[10px] text-faint">
          {mimeType}
          {sizeBytes ? ` · ${bytesLabel(sizeBytes)}` : ""}
        </span>
      </span>
    </span>
  );
}

export function FilePart({ part }: { part: Extract<AgentContentPart, { type: "file" }> }) {
  return (
    <div className="my-1.5">
      {part.attachmentId ? (
        <FileChipLink part={part} />
      ) : (
        <FileChip name={part.name} mimeType={part.mimeType} sizeBytes={part.sizeBytes} />
      )}
    </div>
  );
}

function FileChipLink({ part }: { part: Extract<AgentContentPart, { type: "file" }> }) {
  return (
    <a
      href={api.attachmentUrl(part.attachmentId as string)}
      className="inline-block"
      onClick={(event) => event.preventDefault()}
      aria-label={`Attachment ${part.name}`}
    >
      <FileChip name={part.name} mimeType={part.mimeType} sizeBytes={part.sizeBytes} />
    </a>
  );
}

/** Editable chip used by the composer before sending. */
export function PendingAttachmentChip({
  attachment,
  onRemove,
  uploading,
}: {
  attachment: AgentAttachmentRef;
  onRemove: () => void;
  uploading?: boolean;
}) {
  const previewUrl = useAttachmentObjectUrl(attachment.id, attachment.kind === "image" && !uploading);
  return (
    <span className="relative inline-flex items-center gap-2 rounded-[12px] border border-border bg-surface p-1.5 pr-2.5">
      {attachment.kind === "image" ? (
        previewUrl ? (
          <img src={previewUrl} alt="" className="h-9 w-9 rounded-[8px] object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-surface-2 text-faint">
            <ImageIcon size={14} aria-hidden />
          </span>
        )
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-surface-2 text-muted">
          <FileText size={14} aria-hidden />
        </span>
      )}
      <span className="max-w-[120px]">
        <span className="block truncate text-[12px] font-medium text-text">{shorten(attachment.name, 26)}</span>
        <span className="block font-mono text-[10px] text-faint">
          {uploading ? "uploading…" : (bytesLabel(attachment.sizeBytes) ?? attachment.mimeType)}
        </span>
      </span>
      <IconButton label={`Remove ${attachment.name}`} onClick={onRemove} className="h-11 w-11">
        <X size={14} aria-hidden />
      </IconButton>
    </span>
  );
}
