import { ArrowUp, ImagePlus, ListEnd, Paperclip, Square, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { AgentAttachmentRef, AgentModel, AgentProvider, AgentSession } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { readDraft, writeDraft } from "../lib/prefs.js";
import { attachmentRules } from "../lib/viewmodel.js";
import { PendingAttachmentChip } from "./attachments.js";
import { IconButton } from "./ui.js";

export type ComposerAction = "send" | "queue" | "steer";

/** The textarea grows with the draft up to about a third of the screen. */
const MAX_HEIGHT_FRACTION = 0.35;

interface ComposerProps {
  session: AgentSession;
  provider: AgentProvider | undefined;
  model: AgentModel | undefined;
  running: boolean;
  onSend: (text: string, attachments: AgentAttachmentRef[], action: ComposerAction) => Promise<void> | void;
  onInterrupt: () => void;
  /** Model / mode / effort controls, shown above the input. */
  controls?: ReactNode;
  disabled?: boolean;
}

/**
 * The composer is built around the text: the input owns the full width, and
 * every action lives on a toolbar beneath it, so nothing can squeeze the
 * draft. Idle, the only action is Send. While a run is going, Queue is the
 * primary follow-up, Steer is secondary, and Stop sits apart on the left.
 */
export function Composer({
  session,
  provider,
  model,
  running,
  onSend,
  onInterrupt,
  controls,
  disabled = false,
}: ComposerProps) {
  const [draft, setDraft] = useState(() => readDraft(session.id));
  const [attachments, setAttachments] = useState<AgentAttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rules = attachmentRules(provider, model);
  const canAttach = rules.images || rules.files;
  const canQueue = provider?.capabilities.queue === true;
  const canSteer = provider?.capabilities.steer === true;
  const canInterrupt = provider?.capabilities.interrupt === true;
  const coarsePointer = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  useEffect(() => {
    setDraft(readDraft(session.id));
    setAttachments([]);
    setError(null);
  }, [session.id]);

  useEffect(() => {
    writeDraft(session.id, draft);
  }, [session.id, draft]);

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    const max = Math.round(window.innerHeight * MAX_HEIGHT_FRACTION);
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
  }, [draft]);

  const pickFiles = () => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept =
      rules.images && rules.files
        ? "image/*,.pdf,.txt,.md,.json,.csv,.log"
        : rules.images
          ? "image/*"
          : ".pdf,.txt,.md,.json,.csv,.log";
    input.click();
  };

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    const imagesUsed = attachments.filter((attachment) => attachment.kind === "image").length;
    const filesUsed = attachments.length - imagesUsed;
    const tooManyImages = rules.images ? 0 : files.filter((file) => file.type.startsWith("image/")).length;
    if (tooManyImages > 0) {
      setError("This provider does not accept images here.");
      return;
    }
    const maxImages = 10 - imagesUsed;
    const maxFiles = 10 - filesUsed;
    let imageCount = 0;
    let fileCount = 0;
    const selected = files.filter((file) => {
      if (file.type.startsWith("image/")) {
        imageCount += 1;
        return imageCount <= maxImages;
      }
      fileCount += 1;
      return fileCount <= maxFiles;
    });
    if (selected.length < files.length) setError("Only 10 attachments per message are kept.");
    setUploading(true);
    try {
      const uploaded = await api.uploadAttachments(selected);
      setAttachments((current) => [...current, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const requestAction: ComposerAction = !running ? "send" : canQueue ? "queue" : "send";
  const empty = draft.trim().length === 0 && attachments.length === 0;
  const primaryDisabled = disabled || busy || uploading || (running && !canQueue) || empty;

  const submit = async (action: ComposerAction) => {
    const text = draft.trim();
    if (text.length === 0 && attachments.length === 0) return;
    if (text.length === 0) {
      setError("Add a few words to send attachments.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSend(text, attachments, action);
      setDraft("");
      setAttachments([]);
      writeDraft(session.id, "");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "The message could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const placeholder = running
    ? canQueue
      ? "Queue a follow-up…"
      : "The agent is working…"
    : `Message ${provider?.name ?? "your agent"}…`;

  return (
    <div className="relative z-10 border-t border-[var(--chrome-border)] bg-chrome px-safe pt-2.5 pb-safe-composer backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-[680px] flex-col gap-2">
        {controls ? <div className="flex min-w-0 items-center gap-2">{controls}</div> : null}

        <div className="surface rounded-[24px] transition-[border-color] focus-within:border-[color-mix(in_srgb,var(--accent)_55%,var(--border))]">
          {attachments.length > 0 || uploading ? (
            <div className="flex flex-wrap gap-2 px-2.5 pt-2.5" aria-label="Attached files">
              {attachments.map((attachment) => (
                <PendingAttachmentChip
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={() => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))}
                />
              ))}
              {uploading ? (
                <span className="inline-flex min-h-11 items-center rounded-[14px] bg-fill px-3 text-caption text-muted">
                  Uploading…
                </span>
              ) : null}
            </div>
          ) : null}

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !coarsePointer) {
                event.preventDefault();
                void submit(requestAction);
              }
            }}
            rows={1}
            aria-label="Message"
            enterKeyHint="enter"
            placeholder={placeholder}
            className="block min-h-[3rem] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-body text-text outline-none placeholder:text-muted focus-visible:outline-none"
          />

          {/* Leading tools and trailing actions; the actions wrap below as a group when text is very large. */}
          <div className="flex flex-wrap items-center gap-1.5 px-1.5 pb-1.5">
            <div className="flex items-center gap-1.5">
              {canAttach ? (
                <IconButton label="Add attachment" onClick={pickFiles} disabled={disabled || uploading}>
                  {rules.images && !rules.files ? (
                    <ImagePlus size={20} aria-hidden />
                  ) : (
                    <Paperclip size={20} aria-hidden />
                  )}
                </IconButton>
              ) : null}
              {running && canInterrupt ? (
                <button
                  type="button"
                  aria-label="Stop the run"
                  title="Stop the run"
                  onClick={onInterrupt}
                  disabled={disabled}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-bad-soft text-bad transition-transform active:scale-95 disabled:opacity-40"
                >
                  <Square size={13} fill="currentColor" strokeWidth={0} aria-hidden />
                </button>
              ) : null}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {running && canSteer ? (
                <button
                  type="button"
                  onClick={() => void submit("steer")}
                  disabled={disabled || busy || empty}
                  aria-label="Steer the agent now"
                  title="Send into the current run"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-fill px-3.5 text-callout font-semibold text-text transition-[transform,opacity] active:scale-95 disabled:opacity-40"
                >
                  <Zap size={16} strokeWidth={2.25} className="text-accent" aria-hidden />
                  Steer
                </button>
              ) : null}
              {running ? (
                <button
                  type="button"
                  onClick={() => void submit(requestAction)}
                  disabled={primaryDisabled}
                  aria-label="Queue message"
                  title="Send after this run"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-callout font-semibold text-on-accent shadow-[var(--shadow-accent)] transition-[transform,opacity] active:scale-95 disabled:opacity-40 disabled:shadow-none"
                >
                  <ListEnd size={17} strokeWidth={2.25} aria-hidden />
                  Queue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void submit(requestAction)}
                  disabled={primaryDisabled}
                  aria-label="Send message"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent shadow-[var(--shadow-accent)] transition-[transform,opacity] active:scale-95 disabled:opacity-35 disabled:shadow-none"
                >
                  <ArrowUp size={20} strokeWidth={2.5} aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>

        {error ? (
          <p role="alert" className="px-2 text-caption text-bad">
            {error}
          </p>
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = event.target.files ? [...event.target.files] : [];
          event.target.value = "";
          void upload(files);
        }}
      />
    </div>
  );
}
