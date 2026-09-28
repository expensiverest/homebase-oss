import type { ReactNode, Ref, TextareaHTMLAttributes } from "react";

/*
 * Prompt Bar. Upstream source for Beautiful UI's "Prompt Bar" was not
 * available to this project (see THIRD_PARTY_NOTICES.md); this is a Homebase
 * presentational shell in the same idiom as the vendored primitives: a lit
 * input surface with a focus glow, attachments inside the surface, pickers
 * above it and a tool/action row below it. It only lays things out; the
 * Homebase Composer owns drafts, uploads, queue/steer/stop and capabilities.
 *
 * Structural rule (Phase 4.1): the textarea always owns the full width.
 * Actions live on a toolbar beneath it and wrap as a group, never beside it.
 * There are no @-source, slash-command or dictation affordances: Homebase does
 * not support them, so the bar does not pretend to.
 */

export interface PromptBarProps {
  /** Pickers above the input (model · effort, mode). */
  controls?: ReactNode;
  /** Pending attachments, shown inside the surface above the text. */
  attachments?: ReactNode;
  /** Left of the toolbar: attach, stop. */
  leading?: ReactNode;
  /** Right of the toolbar: steer, queue/send. */
  trailing?: ReactNode;
  /** Error or hint under the bar. */
  message?: ReactNode;
  textareaRef?: Ref<HTMLTextAreaElement>;
  textarea: TextareaHTMLAttributes<HTMLTextAreaElement>;
  /** A run is going: the surface takes a faint iris edge. */
  busy?: boolean;
}

export function PromptBar({
  controls,
  attachments,
  leading,
  trailing,
  message,
  textareaRef,
  textarea,
  busy = false,
}: PromptBarProps) {
  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-2" data-prompt-bar data-busy={busy}>
      {controls ? <div className="flex min-w-0 items-center gap-2">{controls}</div> : null}

      <div
        className={`rounded-[24px] border bg-surface shadow-[var(--shadow-surface)] transition-[border-color,box-shadow] duration-200 focus-within:border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_14%,transparent)] ${
          busy ? "border-[color-mix(in_srgb,var(--accent)_28%,var(--border))]" : "border-border"
        }`}
      >
        {attachments ? (
          <div className="flex flex-wrap gap-2 px-2.5 pt-2.5" aria-label="Attached files">
            {attachments}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          rows={1}
          {...textarea}
          className="block min-h-[3rem] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-body text-text outline-none placeholder:text-muted focus-visible:outline-none"
        />

        {/* Leading tools and trailing actions; actions wrap below as a group at very large text sizes. */}
        <div className="flex flex-wrap items-center gap-1.5 px-1.5 pb-1.5">
          <div className="flex items-center gap-1.5">{leading}</div>
          <div className="ml-auto flex items-center gap-1.5">{trailing}</div>
        </div>
      </div>

      {message}
    </div>
  );
}
