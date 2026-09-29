import { describe, expect, it } from "vitest";

import { compositeOver, overlayColor, parseColor } from "./statusBarTint.js";

const style = (values: Record<string, string>) =>
  ({ getPropertyValue: (name: string) => values[name] ?? "" }) as CSSStyleDeclaration;

describe("status bar tint", () => {
  it("parses hex and rgb colours", () => {
    expect(parseColor("#f5f3ee")).toEqual([245, 243, 238, 1]);
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("rgba(27, 26, 23, 0.32)")).toEqual([27, 26, 23, 0.32]);
    expect(parseColor("rgb(0 0 0 / 0.55)")).toEqual([0, 0, 0, 0.55]);
    expect(parseColor("nonsense")).toBeNull();
  });

  it("composites an overlay over the page background", () => {
    expect(compositeOver([245, 243, 238, 1], [0, 0, 0, 0.9])).toBe("#181818");
    expect(compositeOver([255, 255, 255, 1], [0, 0, 0, 0])).toBe("#ffffff");
  });

  it("dims the theme background by the scrim, or by the preview backdrop", () => {
    const light = style({ "--bg": "#f5f3ee", "--scrim": "rgba(27, 26, 23, 0.32)" });
    expect(overlayColor("scrim", light)).toBe("#afaea9");
    expect(overlayColor("lightbox", light)).toBe("#181818");
    const dark = style({ "--bg": "#0e0d0c", "--scrim": "rgba(0, 0, 0, 0.55)" });
    expect(overlayColor("scrim", dark)).toBe("#060605");
  });

  it("does nothing when the tokens are missing", () => {
    expect(overlayColor("scrim", style({}))).toBeNull();
  });
});
