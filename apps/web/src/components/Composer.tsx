import { ImagePlus, Paperclip } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { AgentAttachmentRef, AgentModel, AgentProvider, AgentSession } from "@homebase/protocol";

import { api } from "../lib/api.js";
import { useSoftKeyboard } from "../lib/chatScroll.js";
import { readDraft, writeDraft } from "../lib/prefs.js";
import { attachmentRules } from "../lib/viewmodel.js";
import { PendingAttachmentChip } from "./attachments.js";
import { PromptBar } from "./beautiful/PromptBar.js";
import { RunButton, type RunButtonMode, type RunMenuItem } from "./RunButton.js";
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
  /** A status strip (e.g. sub-agents) shown directly above the prompt bar. */
  status?: ReactNode;
  disabled?: boolean;
}

/**
 * The composer is built around the text: the input owns the full width, and
 * every action lives on a toolbar beneath it, so nothing can squeeze the
 * draft. There is exactly one action button (RunButton): Send when idle; while
 * a run is going, Stop for an empty input and Queue once there is text, with
 * Steer, Queue and Stop also in the button's hold/chevron menu.
 */
export function Composer({
  session,
  provider,
  model,
  running,
  onSend,
  onInterrupt,
  controls,
  status,
  disabled = false,
}: ComposerProps) {
  const [draft, setDraft] = useState(() => readDraft(session.id));
  const [attachments, setAttachments] = useState<AgentAttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // While typing on a phone everything above the input (pickers, agents) steps aside,
  // so the conversation gets the room and can be scrolled and referenced.
  const keyboardOpen = useSoftKeyboard();

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
  const blocked = disabled || busy || uploading;

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

  // The one button: Stop while running with nothing typed; otherwise the best
  // way to deliver the text (Queue, else Steer when that is all there is).
  const followUp: ComposerAction | null = !running ? "send" : canQueue ? "queue" : canSteer ? "steer" : null;
  // Text is what a follow-up needs, so attachments alone still leave Stop as the action.
  const noText = draft.trim().length === 0;
  const mode: RunButtonMode = running && noText && canInterrupt ? "stop" : (followUp ?? "send");
  const pressDisabled = mode === "stop" ? disabled : blocked || empty || followUp === null;
  const press = () => {
    if (mode === "stop") onInterrupt();
    else if (followUp) void submit(followUp);
  };
  const menu: RunMenuItem[] = running
    ? [
        ...(canSteer
          ? [
              {
                key: "steer" as const,
                label: "Steer now",
                disabled: blocked || empty,
                onSelect: () => void submit("steer"),
              },
            ]
          : []),
        ...(canQueue
          ? [
              {
                key: "queue" as const,
                label: "Queue after this run",
                disabled: blocked || empty,
                onSelect: () => void submit("queue"),
              },
            ]
          : []),
        ...(canInterrupt ? [{ key: "stop" as const, label: "Stop the run", disabled, onSelect: onInterrupt }] : []),
      ]
    : [];

  const placeholder = running
    ? canQueue
      ? "Queue a follow-up…"
      : "The agent is working…"
    : `Message ${provider?.name ?? "your agent"}…`;

  return (
    <div
      data-keyboard-open={keyboardOpen}
      className="relative z-10 border-t border-[var(--chrome-border)] bg-chrome px-safe pt-2.5 pb-safe-composer backdrop-blur-xl backdrop-saturate-150"
    >
      {status && !keyboardOpen ? <div className="mx-auto mb-2 max-w-[680px]">{status}</div> : null}
      <PromptBar
        busy={running}
        controls={keyboardOpen ? null : controls}
        attachments={
          attachments.length > 0 || uploading ? (
            <>
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
            </>
          ) : null
        }
        textareaRef={textareaRef}
        textarea={{
          value: draft,
          onChange: (event) => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter" && !event.shiftKey && !coarsePointer) {
              event.preventDefault();
              void submit(requestAction);
            }
          },
          "aria-label": "Message",
          enterKeyHint: "enter",
          placeholder,
        }}
        leading={
          <>
            {canAttach ? (
              <IconButton label="Add attachment" onClick={pickFiles} disabled={disabled || uploading}>
                {rules.images && !rules.files ? (
                  <ImagePlus size={20} aria-hidden />
                ) : (
                  <Paperclip size={20} aria-hidden />
                )}
              </IconButton>
            ) : null}
          </>
        }
        trailing={<RunButton mode={mode} disabled={pressDisabled} onPress={press} menu={menu} />}
        message={
          error ? (
            <p role="alert" className="px-2 text-caption text-bad">
              {error}
            </p>
          ) : null
        }
      />
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
