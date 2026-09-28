import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../styles/tokens.css", import.meta.url)), "utf8");

function tokensFor(selector: string): Record<string, string> {
  const index = css.indexOf(selector);
  const start = css.indexOf("{", index);
  const end = css.indexOf("}", start);
  const block = css.slice(start + 1, end);
  const tokens: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^\s*(--[\w-]+):\s*([^;]+);/.exec(line);
    if (match?.[1] && match[2]) tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const linear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = channels.map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const PAIRS: Array<[string, string]> = [
  ["text", "bg"],
  ["text", "surface"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["accent", "accent-soft"],
  ["ok", "ok-soft"],
  ["warn", "warn-soft"],
  ["bad", "bad-soft"],
];

describe("design token contrast", () => {
  for (const theme of [":root", '[data-theme="dark"]']) {
    const tokens = tokensFor(theme);
    for (const [foreground, background] of PAIRS) {
      it(`${theme} ${foreground} on ${background} meets 4.5:1`, () => {
        const fg = tokens[`--${foreground}`];
        const bg = tokens[`--${background}`];
        expect(fg, `missing --${foreground}`).toBeTruthy();
        expect(bg, `missing --${background}`).toBeTruthy();
        expect(contrast(fg as string, bg as string)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
