import { useEffect } from "react";

/*
 * iOS paints a soft fade under the status bar in the page's top colour (our `theme-color` and
 * background, #f5f3ee in light mode). Over a dark overlay (a sheet's scrim, the image preview) that
 * fade shows as a pale wash fading into the dark, a "gradient at the top". While an overlay is open
 * the fade is retinted to the overlay's own dimmed colour, then restored on close.
 */

export type Rgba = [number, number, number, number];

/** Parses `#rgb`, `#rrggbb`, `rgb(...)` and `rgba(...)`. */
export function parseColor(input: string): Rgba | null {
  const value = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
    return [0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16)).concat(1) as Rgba;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  return null;
}

/** `overlay` composited over an opaque `base`, as `#rrggbb`. */
export function compositeOver(base: Rgba, overlay: Rgba): string {
  const alpha = overlay[3];
  const channel = (index: 0 | 1 | 2) => Math.round(base[index] * (1 - alpha) + overlay[index] * alpha);
  return `#${[channel(0), channel(1), channel(2)].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

export type TintKind = "scrim" | "lightbox";

/** The colour the page looks under the given overlay, in the current theme. */
export function overlayColor(kind: TintKind, style: CSSStyleDeclaration): string | null {
  const base = parseColor(style.getPropertyValue("--bg"));
  if (!base) return null;
  const overlay: Rgba | null = kind === "lightbox" ? [0, 0, 0, 0.9] : parseColor(style.getPropertyValue("--scrim"));
  return overlay ? compositeOver(base, overlay) : null;
}

interface Saved {
  metas: Array<[HTMLMetaElement, string]>;
  htmlBackground: string;
}

let saved: Saved | null = null;
const stack: string[] = [];

function paint(color: string): void {
  if (!saved) {
    saved = {
      metas: [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => [
        meta,
        meta.content,
      ]),
      htmlBackground: document.documentElement.style.backgroundColor,
    };
  }
  for (const [meta] of saved.metas) meta.content = color;
  document.documentElement.style.backgroundColor = color;
}

function restore(): void {
  if (!saved) return;
  for (const [meta, content] of saved.metas) meta.content = content;
  document.documentElement.style.backgroundColor = saved.htmlBackground;
  saved = null;
}

/** While `active`, retints the status-bar fade to match an overlay; nests (the innermost wins). */
export function useStatusBarTint(kind: TintKind, active = true): void {
  useEffect(() => {
    if (!active) return;
    const color = overlayColor(kind, getComputedStyle(document.documentElement));
    if (!color) return;
    stack.push(color);
    paint(color);
    return () => {
      stack.splice(stack.lastIndexOf(color), 1);
      const next = stack[stack.length - 1];
      if (next) paint(next);
      else restore();
    };
  }, [kind, active]);
}
