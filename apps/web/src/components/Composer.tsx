import { ArrowUp, ImagePlus, Paperclip, SendHorizontal, Square, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AgentAttachmentRef, AgentModel, AgentProvider, AgentSession } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { readDraft, writeDraft } from "../lib/prefs.js";
import { attachmentRules } from "../lib/viewmodel.js";
import { PendingAttachmentChip } from "./attachments.js";
import { Button, IconButton } from "./ui.js";

export type ComposerAction = "send" | "queue" | "steer";

interface ComposerProps {
  session: AgentSession;
  provider: AgentProvider | undefined;
  model: AgentModel | undefined;
  running: boolean;
  onSend: (text: string, attachments: AgentAttachmentRef[], action: ComposerAction) => Promise<void> | void;
  onInterrupt: () => void;
  disabled?: boolean;
}

export function Composer({ session, provider, model, running, onSend, onInterrupt, disabled = false }: ComposerProps) {
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

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
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
  const primaryDisabled = disabled || busy || uploading || (running && !canQueue);

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

  return (
    <div className="hairline-top bg-bg/95 px-3 pt-2 pb-safe-composer backdrop-blur">
      {attachments.length > 0 || uploading ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <PendingAttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={() => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))}
            />
          ))}
          {uploading ? (
            <span className="inline-flex items-center gap-2 rounded-[12px] border border-border bg-surface px-3 py-2 text-[12px] text-muted">
              Uploading…
            </span>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mb-1.5 px-1 text-[12px] text-bad">{error}</p> : null}

      <div className="flex items-end gap-1.5">
        {canAttach ? (
          <IconButton label="Add attachment" onClick={pickFiles} disabled={disabled || uploading}>
            {rules.images && !rules.files ? <ImagePlus size={19} aria-hidden /> : <Paperclip size={19} aria-hidden />}
          </IconButton>
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
          placeholder={running ? (canQueue ? "Queue a follow-up…" : "The agent is working…") : "Message your agent…"}
          className="min-h-11 max-h-[140px] min-w-0 flex-1 resize-none rounded-[16px] border border-border bg-surface px-3 py-2.5 text-[15px] text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
        {running && canInterrupt ? (
          <IconButton label="Stop the run" onClick={onInterrupt} className="bg-bad-soft text-bad" disabled={disabled}>
            <Square size={16} aria-hidden />
          </IconButton>
        ) : null}
        {running && canSteer ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void submit("steer")}
            disabled={disabled || busy}
            aria-label="Steer the agent now"
            className="mb-0.5"
          >
            <Zap size={14} aria-hidden />
            Steer
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => void submit(requestAction)}
          disabled={primaryDisabled || busy || (draft.trim().length === 0 && attachments.length === 0)}
          aria-label={running ? "Queue message" : "Send message"}
          className="mb-0.5 inline-flex h-11 items-center gap-1.5 rounded-[14px] bg-accent px-3.5 text-[14px] font-medium text-on-accent transition-colors disabled:opacity-40"
        >
          {running ? <ArrowUp size={17} aria-hidden /> : <SendHorizontal size={17} aria-hidden />}
          <span>{running ? "Queue" : "Send"}</span>
        </button>
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
