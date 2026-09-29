import { Asterisk, Bot, Braces, Sparkles, type LucideIcon } from "lucide-react";

import type { AgentProvider } from "@homebase/protocol";

/**
 * Six quiet, warm hues for project monograms. A project always gets the same
 * one (hashed from its name), so its mark is recognisable at a glance without
 * the list turning into a paint chart. Tints are mixed into the surface and
 * the glyph stays close to the text color, so contrast never depends on hue.
 */
const MARK_HUES = ["#c07a4f", "#7f9a62", "#6f8fb0", "#b8954a", "#a37096", "#8d8a7e"];

function hashName(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

export function projectInitial(name: string): string {
  return (
    name
      .replace(/[^\p{L}\p{N}]/gu, "")
      .charAt(0)
      .toLowerCase() || "?"
  );
}

/**
 * Mark dimension that follows the text size (rem) but is capped, so a larger
 * Dynamic Type or browser text setting grows the mark a little (up to 15%)
 * without letting it dominate the row. `base` is the size at a 16px root.
 */
export function markDimension(base: number): string {
  return `clamp(${base}px, ${base / 16}rem, ${Math.round(base * 1.15)}px)`;
}

/** Serif monogram tile; an iris ring radiates from it while a session works. */
export function ProjectMark({ name, working = false, size = 44 }: { name: string; working?: boolean; size?: number }) {
  const hue = MARK_HUES[hashName(name) % MARK_HUES.length] ?? MARK_HUES[0];
  return (
    <span
      aria-hidden
      data-mark="project"
      className="relative inline-flex shrink-0"
      style={{ width: markDimension(size), height: markDimension(size) }}
    >
      {working ? <span className="hb-ping absolute inset-0 rounded-[30%] border border-accent" /> : null}
      <span
        className="relative flex h-full w-full items-center justify-center rounded-[30%] border font-serif italic leading-none"
        style={{
          fontSize: `calc(${markDimension(size)} * 0.56)`,
          background: `color-mix(in srgb, ${hue} 16%, var(--surface-2))`,
          borderColor: working
            ? "color-mix(in srgb, var(--accent) 55%, transparent)"
            : `color-mix(in srgb, ${hue} 22%, var(--border))`,
          color: working ? "var(--accent)" : `color-mix(in srgb, ${hue} 45%, var(--text))`,
        }}
      >
        <span className="-mt-[0.08em]">{projectInitial(name)}</span>
      </span>
    </span>
  );
}

/**
 * Provider glyphs are visual identity only (never behavior). Unknown providers
 * get a neutral agent glyph.
 */
const PROVIDER_GLYPHS: Record<string, LucideIcon> = {
  opencode: Braces,
  claude: Asterisk,
  grok: Sparkles,
};

export function providerGlyph(providerId: string): LucideIcon {
  return PROVIDER_GLYPHS[providerId] ?? Bot;
}

/** A small round provider mark: subtle, recognisable, secondary to content. */
export function ProviderMark({
  providerId,
  provider,
  size = 36,
  working = false,
  title,
}: {
  providerId: string;
  provider?: AgentProvider;
  size?: number;
  working?: boolean;
  title?: string;
}) {
  const Glyph = providerGlyph(providerId);
  return (
    <span
      className="relative inline-flex shrink-0"
      data-mark="provider"
      style={{ width: markDimension(size), height: markDimension(size) }}
      title={title ?? provider?.name ?? providerId}
      aria-hidden
    >
      {working ? <span className="hb-ping absolute inset-0 rounded-full border border-accent" /> : null}
      <span
        className={`relative flex h-full w-full items-center justify-center rounded-full [&>svg]:size-[46%] ${
          working ? "bg-accent-soft text-accent" : "bg-fill text-muted"
        }`}
      >
        <Glyph size={Math.round(size * 0.46)} strokeWidth={2} />
      </span>
    </span>
  );
}

/** Inline glyph for use inside text (headers, chips). */
export function ProviderGlyph({ providerId, size = 14 }: { providerId: string; size?: number }) {
  const Glyph = providerGlyph(providerId);
  return <Glyph size={size} strokeWidth={2.25} aria-hidden className="shrink-0" />;
}
