import { Check, Copy, FileCode2 } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { parsePatch } from "../../lib/diff.js";
import { normalizeLanguage, tokensLater, tokensNow, type TokenLines } from "../../lib/highlight.js";

/*
 * Adapted from Beautiful UI "Code Block" (MIT, © 2026 Shane Levine; source
 * pinned at slev12397/beautiful-ui@44a274e; see THIRD_PARTY_NOTICES.md).
 * Kept: the editor panel — a header with a code glyph and mono file/language
 * name, Copy/Copied on the right (a +/− stat instead in Diff); a body with one
 * narrow line-number gutter behind a hairline rule; wrapped lines; and the
 * unified Diff layout (removals keep the old number, additions/context show the
 * new one, green bar + tint for adds, red hatched bar + tint for removals).
 * Changed: Homebase tokens; a 44px copy target; syntax colors come from Shiki
 * tokens (both themes) instead of the upstream regex highlighter; diff rows are
 * parsed from a real unified patch (hunk headers become quiet separators).
 * Removed: the demo FILE/CODE_LINES/DIFF content, the Code⇄Diff variant switch
 * (diff mode is only used for real AgentDiff data), and word-level highlights
 * (a unified patch does not carry them).
 *
 * Safety: every line is rendered as React text nodes; nothing is injected as
 * HTML. Stability: plain and highlighted renders share one layout, so colors
 * arrive without a shift.
 */

const HATCH = "repeating-linear-gradient(45deg, var(--bad) 0, var(--bad) 1.5px, transparent 1.5px, transparent 3px)";

/** Tokens for a block; `settled` is true once highlighting succeeded or gave up (plain text stays). */
function useTokens(code: string, language: string | null): { tokens: TokenLines | null; settled: boolean } {
  const [state, setState] = useState<{ key: string; tokens: TokenLines | null; settled: boolean }>(() => {
    const ready = tokensNow(code, language);
    return { key: `${language}:${code}`, tokens: ready, settled: Boolean(ready) || !language };
  });
  const key = `${language}:${code}`;
  useEffect(() => {
    if (!language) {
      setState({ key, tokens: null, settled: true });
      return;
    }
    const ready = tokensNow(code, language);
    if (ready) {
      setState({ key, tokens: ready, settled: true });
      return;
    }
    let cancelled = false;
    setState((current) => (current.key === key ? current : { key, tokens: null, settled: false }));
    void tokensLater(code, language).then((result) => {
      if (!cancelled) setState({ key, tokens: result, settled: true });
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, key]);
  return state.key === key ? state : { tokens: null, settled: false };
}

function Line({
  number,
  gutter,
  children,
  className = "",
  bar,
}: {
  number: ReactNode;
  gutter: boolean;
  children: ReactNode;
  className?: string;
  bar?: string;
}) {
  return (
    <div
      className={`relative grid items-start ${gutter ? "grid-cols-[2.5rem_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"} ${className}`}
    >
      {bar ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: bar }} /> : null}
      {gutter ? (
        <span aria-hidden className="select-none pr-1 text-center text-[0.6875rem] text-faint">
          {number}
        </span>
      ) : null}
      <code className={`whitespace-pre-wrap break-words pr-3.5 ${gutter ? "pl-2" : "pl-3.5"}`}>{children}</code>
    </div>
  );
}

export function CodeBlock({
  code,
  language,
  diff = false,
  lineNumbers,
  title,
  compact = false,
}: {
  code: string;
  language?: string | null;
  /** Render as a unified diff (only for real diff data). */
  diff?: boolean;
  /** Defaults to on for multi-line blocks. */
  lineNumbers?: boolean;
  /** Header label: a file name, or defaults to the language. */
  title?: string | null;
  /** Tighter variant for tool output inside traces. */
  compact?: boolean;
}) {
  const text = code.replace(/\n$/, "");
  const lines = text.split("\n");
  // Large previews stay plain rather than synchronously tokenizing megabytes.
  const normalized = diff || text.length > 40_000 ? null : normalizeLanguage(language);
  const { tokens, settled } = useTokens(text, normalized);
  const rows = diff ? parsePatch(text) : null;
  const [copied, setCopied] = useState(false);
  const gutter = diff || (lineNumbers ?? lines.length > 1);
  const label = title ?? (diff ? "diff" : (language ?? "text"));
  const highlightState = diff || !normalized ? "plain" : tokens ? "done" : settled ? "plain" : "pending";
  const added = rows?.filter((row) => row.kind === "add").length ?? 0;
  const removed = rows?.filter((row) => row.kind === "del").length ?? 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <figure
      className="bui-code my-1 min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-inset"
      data-code-block
      data-highlight={highlightState}
    >
      <figcaption className="flex min-h-11 items-center gap-2 border-b border-border pl-3.5 pr-1">
        <span className="inline-flex min-w-0 items-center gap-[7px]">
          <FileCode2 size={15} strokeWidth={1.8} className="shrink-0 text-muted" aria-hidden />
          <span className="readout truncate text-caption text-text">{label}</span>
        </span>
        {diff ? (
          <span className="readout ml-auto inline-flex items-center gap-2 pr-2.5 text-caption">
            <span className="text-ok">+{added}</span>
            <span className="text-bad">−{removed}</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? "Copied" : "Copy code"}
            className={`ml-auto inline-flex h-11 items-center gap-1 rounded-full px-2.5 text-caption font-medium transition-colors active:bg-fill ${
              copied ? "text-ok" : "text-muted hover:text-text"
            }`}
          >
            {copied ? <Check size={13} strokeWidth={3} aria-hidden /> : <Copy size={13} aria-hidden />}
            <span aria-hidden>{copied ? "Copied" : "Copy"}</span>
          </button>
        )}
      </figcaption>
      <div
        className={`relative font-mono leading-[1.65] text-text/90 ${compact ? "py-2 text-[0.75rem]" : "py-3 text-[0.8125rem]"}`}
        role="region"
        aria-label={`${label} code`}
      >
        {gutter ? <span aria-hidden className="pointer-events-none absolute inset-y-0 left-10 w-px bg-border" /> : null}
        {rows
          ? rows.map((row, index) =>
              row.kind === "hunk" ? (
                <Line key={index} number="" gutter className="my-0.5 text-muted">
                  {row.text}
                </Line>
              ) : (
                <Line
                  key={index}
                  number={row.number ?? ""}
                  gutter
                  bar={row.kind === "add" ? "var(--ok)" : row.kind === "del" ? HATCH : undefined}
                  className={
                    row.kind === "add"
                      ? "bg-[color-mix(in_srgb,var(--ok)_12%,transparent)]"
                      : row.kind === "del"
                        ? "bg-[color-mix(in_srgb,var(--bad)_12%,transparent)]"
                        : ""
                  }
                >
                  {row.text || " "}
                </Line>
              ),
            )
          : lines.map((line, index) => {
              const lineTokens = tokens?.[index];
              return (
                <Line key={index} number={index + 1} gutter={gutter}>
                  {lineTokens && lineTokens.length > 0
                    ? lineTokens.map((token, tokenIndex) => (
                        <span key={tokenIndex} style={token.htmlStyle as CSSProperties | undefined}>
                          {token.content}
                        </span>
                      ))
                    : line || " "}
                </Line>
              );
            })}
      </div>
    </figure>
  );
}
