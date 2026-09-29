import { describe, expect, it } from "vitest";

import { BOTTOM_THRESHOLD, isKeyboardOpen, isNearBottom, isViewportShrunk, KEYBOARD_MIN_SHRINK } from "./chatScroll.js";

describe("isKeyboardOpen", () => {
  const full = 874;

  it("is open only when a text field is focused and the view has shrunk like a keyboard", () => {
    expect(isKeyboardOpen({ baselineHeight: full, height: 480, textFieldFocused: true })).toBe(true);
  });

  it("stays closed with a focused field and no shrink (hardware keyboard, desktop)", () => {
    expect(isKeyboardOpen({ baselineHeight: full, height: full, textFieldFocused: true })).toBe(false);
  });

  it("counts a keyboard hidden while the field keeps focus (Android back) as closed", () => {
    expect(isKeyboardOpen({ baselineHeight: full, height: full, textFieldFocused: true })).toBe(false);
  });

  it("ignores a shrink with nothing focused (e.g. browser chrome)", () => {
    expect(isKeyboardOpen({ baselineHeight: full, height: 480, textFieldFocused: false })).toBe(false);
  });

  it("does not mistake small chrome changes for a keyboard", () => {
    const shrink = KEYBOARD_MIN_SHRINK - 1;
    expect(isKeyboardOpen({ baselineHeight: full, height: full - shrink, textFieldFocused: true })).toBe(false);
    expect(isKeyboardOpen({ baselineHeight: full, height: full - KEYBOARD_MIN_SHRINK, textFieldFocused: true })).toBe(
      true,
    );
  });
});

describe("isNearBottom", () => {
  const view = { scrollHeight: 5000, clientHeight: 800 };

  it("is at the bottom at the very end and within the threshold", () => {
    expect(isNearBottom({ ...view, scrollTop: 4200 })).toBe(true);
    expect(isNearBottom({ ...view, scrollTop: 4200 - (BOTTOM_THRESHOLD - 1) })).toBe(true);
  });

  it("is not at the bottom once the reader has scrolled up past the threshold", () => {
    expect(isNearBottom({ ...view, scrollTop: 4200 - BOTTOM_THRESHOLD })).toBe(false);
    expect(isNearBottom({ ...view, scrollTop: 0 })).toBe(false);
  });

  it("treats content that fits the viewport as at the bottom", () => {
    expect(isNearBottom({ scrollHeight: 600, clientHeight: 800, scrollTop: 0 })).toBe(true);
  });
});

describe("isViewportShrunk", () => {
  it("only keyboard-sized shrinkage counts, so a slightly short visualViewport never shortens the app", () => {
    expect(isViewportShrunk(874, 874)).toBe(false);
    expect(isViewportShrunk(874, 874 - 62)).toBe(false); // e.g. an iOS standalone PWA's reported height
    expect(isViewportShrunk(874, 874 - KEYBOARD_MIN_SHRINK)).toBe(true);
    expect(isViewportShrunk(874, 480)).toBe(true);
  });
});
