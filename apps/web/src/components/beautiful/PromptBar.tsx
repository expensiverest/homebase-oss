import type { ReactNode, Ref, TextareaHTMLAttributes } from "react";

/*
 * Adapted from Beautiful UI "Prompt Bar" (MIT, © 2026 Shane Levine; source
 * pinned at slev12397/beautiful-ui@44a274e; see THIRD_PARTY_NOTICES.md).
 * Kept: the "tall" composer — one lit surface holding attachment chips, a
 * multi-line input that owns the width, and controls on their own row below
 * it; the quiet focus treatment (the border steps up, no glow ring); chips
 * that pop in; a send control that changes fill with readiness and presses
 * down. Changed: Homebase tokens and 44px targets; the pickers (model · effort,
 * mode) sit above the surface; slots take real Homebase controls. Removed:
 * the self-running AUTO_STEPS walkthrough, the glimm rainbow shader, @ data
 * sources, / commands, dictation, branded source icons, the in-bar model menu
 * and the Pill variant — Homebase supports none of those, so the bar does not
 * pretend to.
 *
 * Structural rule (Phase 4.1): the textarea always owns the full width.
 * Actions live on a toolbar beneath it and wrap as a group, never beside it.
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
        className={`flex flex-col gap-1.5 rounded-[22px] border bg-surface p-1.5 shadow-[var(--shadow-surface)] transition-[border-color] duration-150 focus-within:border-[color-mix(in_srgb,var(--accent)_45%,var(--border-strong))] ${
          busy ? "border-[color-mix(in_srgb,var(--accent)_24%,var(--border))]" : "border-border"
        }`}
      >
        {attachments ? (
          <div
            className="flex flex-wrap gap-2 pl-1 pr-3 pt-3 [&>*]:animate-[bui-pop-in_200ms_cubic-bezier(0.23,1,0.32,1)_both]"
            aria-label="Attached files"
          >
            {attachments}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          rows={1}
          {...textarea}
          className="block min-h-[3rem] w-full resize-none bg-transparent px-2.5 pb-0.5 pt-2 text-body text-text outline-none [overflow-wrap:anywhere] placeholder:text-muted focus-visible:outline-none"
        />

        {/* Leading tools and trailing actions; actions wrap below as a group at very large text sizes. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1.5">{leading}</div>
          <div className="ml-auto flex items-center gap-1.5">{trailing}</div>
        </div>
      </div>

      {message}
    </div>
  );
}
