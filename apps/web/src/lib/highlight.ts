import type { Highlighter, ThemedToken } from "shiki";

/**
 * Syntax highlighting with Shiki's web bundle, loaded lazily and cached.
 *
 * Code is tokenised (never turned into HTML), so model output can only ever
 * become text nodes with a color. Results are cached per language + source so
 * re-renders during streaming and navigation do not re-tokenise.
 */

const LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "bash",
  "python",
  "css",
  "html",
  "markdown",
  "diff",
  "yaml",
] as const;

const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
};

const THEMES = { light: "github-light", dark: "github-dark-dimmed" } as const;

let highlighterPromise: Promise<Highlighter> | null = null;
let highlighter: Highlighter | null = null;

export function loadHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki/bundle/web")
      .then(
        (shiki) =>
          shiki.createHighlighter({
            themes: [THEMES.light, THEMES.dark],
            langs: [...LANGS],
          }) as unknown as Promise<Highlighter>,
      )
      .then((instance) => {
        highlighter = instance;
        return instance;
      });
  }
  return highlighterPromise;
}

/** Starts loading early (e.g. when a conversation opens) so the first block rarely waits. */
export function preloadHighlighter(): void {
  void loadHighlighter().catch(() => undefined);
}

/** Canonical Shiki language, or null when the block should stay plain text. */
export function normalizeLanguage(language: string | null | undefined): string | null {
  if (!language) return null;
  const lower = language.toLowerCase();
  const name = ALIASES[lower] ?? lower;
  return (LANGS as readonly string[]).includes(name) ? name : null;
}

export type TokenLines = ThemedToken[][];

const cache = new Map<string, TokenLines>();
const MAX_CACHE = 200;

function cacheKey(code: string, language: string): string {
  return `${language}\u0000${code}`;
}

function tokenize(instance: Highlighter, code: string, language: string): TokenLines {
  const result = instance.codeToTokens(code, { lang: language as never, themes: THEMES, defaultColor: false });
  return result.tokens;
}

/** Synchronous path: tokens when the highlighter is already ready, else null. */
export function tokensNow(code: string, language: string | null): TokenLines | null {
  if (!language || !highlighter) return null;
  const key = cacheKey(code, language);
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const tokens = tokenize(highlighter, code, language);
    remember(key, tokens);
    return tokens;
  } catch {
    return null;
  }
}

export async function tokensLater(code: string, language: string): Promise<TokenLines | null> {
  try {
    const instance = await loadHighlighter();
    return tokensNow(code, language) ?? tokenize(instance, code, language);
  } catch {
    return null;
  }
}

function remember(key: string, tokens: TokenLines): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, tokens);
}
