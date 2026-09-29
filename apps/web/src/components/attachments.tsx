import { FileText, ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { AgentAttachmentRef, AgentContentPart } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { useStatusBarTint } from "../lib/statusBarTint.js";
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

/**
 * A small square preview of an image: what messages and the composer show instead of the full
 * picture. Tapping it opens the large preview.
 */
export function ImageThumb({
  url,
  alt,
  label,
  size = "message",
  onOpen,
}: {
  url: string | null;
  alt: string;
  label: string;
  size?: "message" | "composer";
  onOpen: () => void;
}) {
  const box = size === "composer" ? "size-16" : "size-[5.5rem]";
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!url}
      aria-label={label}
      data-image-thumb
      className={`relative block shrink-0 overflow-hidden rounded-[14px] border border-border bg-surface-2 transition-transform active:scale-[0.97] ${box}`}
    >
      {url ? (
        <img src={url} alt={alt} draggable={false} className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-faint">
          <ImageIcon size={20} aria-hidden />
        </span>
      )}
    </button>
  );
}

/** The large preview: the whole image on a dark backdrop, closed by the button, Escape or a tap outside it. */
export function ImageLightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useStatusBarTint("lightbox");
  // A fresh `onClose` arrives every render; keep it out of the effect's deps so re-renders never re-run
  // the focus handling (which would also restore focus to the opener and steal it straight back).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.();
    };
  }, []);
  // The picture stays inside the safe areas and below the close button's row, so a tall phone screenshot
  // never runs under the status bar or the button. Portalled into the app shell: an ancestor with a backdrop blur (the composer) would otherwise become the
  // containing block for `fixed` and trap the preview inside its own box.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      data-image-lightbox
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 px-3 pb-[max(0.75rem,var(--safe-bottom))] pt-[calc(max(0.75rem,var(--safe-top))+3.25rem)]"
      onClick={onClose}
    >
      <img
        src={url}
        alt={alt}
        draggable={false}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-[12px] object-contain"
      />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-3 top-[max(0.75rem,var(--safe-top))] inline-flex size-11 items-center justify-center rounded-full bg-black/70 text-white ring-1 ring-white/35 active:bg-black"
      >
        <X size={20} strokeWidth={2.4} aria-hidden />
      </button>
    </div>,
    document.querySelector("[data-app-shell]") ?? document.body,
  );
}

/** An image in the conversation (yours or the model's): a small square that opens large on tap. */
export function ImagePart({ part }: { part: Extract<AgentContentPart, { type: "image" }> }) {
  const url = useAttachmentObjectUrl(part.attachmentId, true);
  const [open, setOpen] = useState(false);
  const name = part.alt ?? part.name ?? "image";
  return (
    <span className="mr-2 mt-1.5 inline-block align-top">
      <ImageThumb url={url} alt={name} label={`Open image: ${name}`} onOpen={() => setOpen(true)} />
      {open && url ? <ImageLightbox url={url} alt={name} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

export function FileChip({ name, mimeType, sizeBytes }: { name: string; mimeType: string; sizeBytes?: number | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-[14px] bg-fill px-3 py-2">
      <FileText size={14} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-callout font-medium text-text">{shorten(name, 42)}</span>
        <span className="block truncate readout text-caption text-muted">
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

/**
 * What the composer shows for a pending attachment. An image is only its small square preview
 * (tap to enlarge) with a clear remove button; other files keep a name-and-size chip.
 */
export function PendingAttachmentChip({
  attachment,
  onRemove,
  uploading,
}: {
  attachment: AgentAttachmentRef;
  onRemove: () => void;
  uploading?: boolean;
}) {
  const isImage = attachment.kind === "image";
  const previewUrl = useAttachmentObjectUrl(attachment.id, isImage && !uploading);
  const [open, setOpen] = useState(false);

  if (isImage) {
    return (
      <span className="relative inline-block" data-pending-image>
        <ImageThumb
          url={previewUrl}
          alt=""
          label={`Preview ${attachment.name}`}
          size="composer"
          onOpen={() => setOpen(true)}
        />
        {/* The 44px target straddles the corner; only the small round badge is drawn. */}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
          className="absolute -right-3 -top-3 inline-flex size-11 items-center justify-center rounded-full"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-text text-bg shadow-[var(--shadow-surface)]">
            <X size={13} strokeWidth={3} aria-hidden />
          </span>
        </button>
        {open && previewUrl ? (
          <ImageLightbox url={previewUrl} alt={attachment.name} onClose={() => setOpen(false)} />
        ) : null}
      </span>
    );
  }

  return (
    <span className="relative inline-flex items-center gap-2 rounded-[14px] bg-fill p-1.5 pr-1">
      <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-surface-2 text-muted">
        <FileText size={14} aria-hidden />
      </span>
      <span className="min-w-0 max-w-[9rem]">
        <span className="block truncate text-callout font-medium text-text">{shorten(attachment.name, 26)}</span>
        <span className="block readout text-caption text-muted">
          {uploading ? "uploading…" : (bytesLabel(attachment.sizeBytes) ?? attachment.mimeType)}
        </span>
      </span>
      <IconButton label={`Remove ${attachment.name}`} onClick={onRemove} className="h-11 w-11 -ml-1">
        <X size={14} aria-hidden />
      </IconButton>
    </span>
  );
}
