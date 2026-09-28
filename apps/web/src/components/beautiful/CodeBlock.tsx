import { Check, Copy } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { normalizeLanguage, tokensLater, tokensNow, type TokenLines } from "../../lib/highlight.js";

/*
 * Code Block. Upstream source for Beautiful UI's "Code Block" was not
 * available to this project (see THIRD_PARTY_NOTICES.md); this is a Homebase
 * component written in the same idiom as the vendored Beautiful UI primitives
 * (quiet header with a language label, copy action, mono body, diff mode).
 *
 * Safety: code is rendered from Shiki *tokens* as React text nodes; nothing is
 * ever injected as HTML. Stability: the plain and highlighted renders share one
 * layout (same lines, gutter and metrics), so colors arrive without a shift.
 * Diff mode is only used for real normalized diffs (the Changes sheet), never
 * inferred from a snippet.
 */

type DiffTone = "add" | "del" | "hunk" | "ctx";

function diffTone(line: string): DiffTone {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  return "ctx";
}

const DIFF_ROW: Record<DiffTone, string> = {
  add: "bg-[color-mix(in_srgb,var(--ok)_12%,transparent)] text-ok",
  del: "bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] text-bad",
  hunk: "text-accent",
  ctx: "text-text/85",
};

function useTokens(code: string, language: string | null, enabled: boolean): TokenLines | null {
  const [tokens, setTokens] = useState<TokenLines | null>(() => (enabled ? tokensNow(code, language) : null));
  useEffect(() => {
    if (!enabled || !language) {
      setTokens(null);
      return;
    }
    const ready = tokensNow(code, language);
    if (ready) {
      setTokens(ready);
      return;
    }
    let cancelled = false;
    void tokensLater(code, language).then((result) => {
      if (!cancelled) setTokens(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, enabled]);
  return tokens;
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
  /** Defaults to on for blocks longer than three lines (never for diffs). */
  lineNumbers?: boolean;
  /** Header label; defaults to the language. */
  title?: string | null;
  /** Tighter variant for tool output inside traces. */
  compact?: boolean;
}) {
  const text = code.replace(/\n$/, "");
  const lines = text.split("\n");
  const normalized = diff ? null : normalizeLanguage(language);
  const tokens = useTokens(text, normalized, !diff);
  const [copied, setCopied] = useState(false);
  const showNumbers = !diff && (lineNumbers ?? lines.length > 3);
  const label = title ?? (diff ? "diff" : (language ?? "text"));
  const highlightState = diff || !normalized ? "plain" : tokens ? "done" : "pending";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const gutterWidth = `${String(lines.length).length + 1}ch`;

  return (
    <figure
      className="bui-code not-prose my-1 min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-inset"
      data-code-block
      data-highlight={highlightState}
    >
      <figcaption className="flex min-h-9 items-center justify-between gap-2 border-b border-border pl-3.5 pr-1">
        <span className="readout min-w-0 truncate text-caption text-muted">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : "Copy code"}
          title="Copy code"
          className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2 text-caption font-medium text-muted transition-colors hover:text-text active:bg-fill"
        >
          {copied ? <Check size={15} className="text-ok" aria-hidden /> : <Copy size={15} aria-hidden />}
          <span aria-hidden>{copied ? "Copied" : null}</span>
        </button>
      </figcaption>
      <pre
        className={`overflow-x-auto font-mono leading-[1.65] ${compact ? "py-2 text-[0.75rem]" : "py-3 text-[0.8125rem]"}`}
        tabIndex={0}
        aria-label={`${label} code`}
      >
        <code className="grid min-w-max">
          {lines.map((line, index) => {
            const tone = diff ? diffTone(line) : null;
            const lineTokens = tokens?.[index];
            return (
              <span
                key={index}
                className={`flex pr-4 ${tone ? DIFF_ROW[tone] : ""} ${showNumbers || diff ? "" : "pl-3.5"}`}
              >
                {showNumbers ? (
                  <span
                    aria-hidden
                    className="sticky left-0 shrink-0 select-none bg-inset pl-3.5 pr-3 text-right text-faint"
                    style={{ minWidth: `calc(${gutterWidth} + 1.625rem)` }}
                  >
                    {index + 1}
                  </span>
                ) : null}
                {diff ? (
                  <span className="whitespace-pre pl-3.5">{line || " "}</span>
                ) : lineTokens ? (
                  <span className="whitespace-pre">
                    {lineTokens.length === 0
                      ? " "
                      : lineTokens.map((token, tokenIndex) => (
                          <span key={tokenIndex} style={token.htmlStyle as CSSProperties | undefined}>
                            {token.content}
                          </span>
                        ))}
                  </span>
                ) : (
                  <span className="whitespace-pre">{line || " "}</span>
                )}
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}
