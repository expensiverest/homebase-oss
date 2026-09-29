import { useCallback, useEffect, useRef, useState } from "react";

/** Within this many pixels of the end counts as "at the bottom". */
export const BOTTOM_THRESHOLD = 80;

export function isNearBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold: number = BOTTOM_THRESHOLD,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold;
}

export interface ChatScrollController {
  /** Callback refs: they attach to the real elements whenever those mount (the screen shows a skeleton first). */
  scrollRef: (element: HTMLDivElement | null) => void;
  contentRef: (element: HTMLDivElement | null) => void;
  /** False once the reader has scrolled up: the cue to offer "Jump to bottom". */
  atBottom: boolean;
  /** True once the thread has scrolled away from its top (the fixed top bar then shows a hairline). */
  scrolled: boolean;
  /** Pins to the end and follows new content again. Returns false when there is no thread element yet. */
  scrollToBottom(): boolean;
  /** Call before prepending older messages; returns the previous height. */
  captureHeight(): number;
  /** Call (before paint) after prepending; keeps the viewport anchored on what was on screen. */
  restoreHeight(previousHeight: number): void;
}

/**
 * Scroll behaviour for a chat thread.
 *
 * The thread follows new content (streamed text, tool rows, new messages) only
 * while the reader is pinned to the bottom; the moment they scroll up it stays
 * put. "Pinned" comes from real scroll events, so content growing under the
 * reader never counts as scrolling, and reaching the end re-pins.
 */
export function useChatScroll(): ChatScrollController {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const pinned = useRef(true);

  useEffect(() => {
    if (!element) return;
    const onScroll = () => {
      const near = isNearBottom(element);
      pinned.current = near;
      setAtBottom(near);
      setScrolled(element.scrollTop > 4);
    };
    onScroll();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [element]);

  // While pinned, keep the end in view as content grows or the viewport shrinks (keyboard).
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const follow = () => {
      if (pinned.current) element.scrollTop = element.scrollHeight;
    };
    const observer = new ResizeObserver(follow);
    observer.observe(element);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [element, content]);

  const scrollToBottom = useCallback(() => {
    if (!element) return false;
    pinned.current = true;
    setAtBottom(true);
    element.scrollTop = element.scrollHeight;
    return true;
  }, [element]);

  const captureHeight = useCallback(() => element?.scrollHeight ?? 0, [element]);

  const restoreHeight = useCallback(
    (previousHeight: number) => {
      if (!element) return;
      const delta = element.scrollHeight - previousHeight;
      if (delta > 0) element.scrollTop += delta;
    },
    [element],
  );

  return {
    scrollRef: setElement,
    contentRef: setContent,
    atBottom,
    scrolled,
    scrollToBottom,
    captureHeight,
    restoreHeight,
  };
}

/** How much the visible height must shrink before we call it a software keyboard (not browser chrome). */
export const KEYBOARD_MIN_SHRINK = 120;

/** The part of the screen the user can actually see, in layout-viewport coordinates. */
export interface VisibleViewport {
  height: number;
  /** How far the visual viewport is scrolled down inside the layout viewport. */
  top: number;
  /**
   * True only when the visible area is keyboard-sized smaller than the layout
   * viewport. Anything smaller (iOS standalone PWAs report a slightly short
   * `visualViewport`) must not shorten the app: it would leave a dead strip.
   */
  keyboard: boolean;
}

/** The visible height is keyboard-sized smaller than the layout viewport. */
export function isViewportShrunk(layoutHeight: number, visibleHeight: number): boolean {
  return layoutHeight - visibleHeight >= KEYBOARD_MIN_SHRINK;
}

/**
 * Tracks the visible area so the composer stays above the software keyboard.
 *
 * `height` alone is not enough on iOS: the layout viewport keeps its full
 * height when the keyboard opens, and iOS scrolls the visual viewport down
 * (`offsetTop`) to reveal the caret. A shell that only takes `height` then sits
 * `offsetTop` pixels too high on screen, which pushed the composer up into the
 * status bar. The shell must follow both values.
 */
export function useVisibleViewport(): VisibleViewport | null {
  const [box, setBox] = useState<VisibleViewport | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      // Pinch-zoomed: keep the last layout box rather than chasing the zoom window.
      if (Math.abs(viewport.scale - 1) > 0.01) return;
      const next = {
        height: Math.round(viewport.height),
        top: Math.max(0, Math.round(viewport.offsetTop)),
        keyboard: isViewportShrunk(window.innerHeight, viewport.height),
      };
      setBox((current) =>
        current && current.height === next.height && current.top === next.top && current.keyboard === next.keyboard
          ? current
          : next,
      );
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return box;
}

/**
 * The on-screen keyboard is open when a text field has focus AND the visible
 * height has dropped well below the tallest height seen. Focus alone is not
 * enough (a hardware keyboard, or a desktop browser, never shrinks the view),
 * and a shrink alone is not enough (Android can hide the keyboard with the
 * field still focused, which must count as closed).
 */
export function isKeyboardOpen({
  baselineHeight,
  height,
  textFieldFocused,
}: {
  baselineHeight: number;
  height: number;
  textFieldFocused: boolean;
}): boolean {
  return textFieldFocused && baselineHeight - height >= KEYBOARD_MIN_SHRINK;
}

function isTextField(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "file", "submit", "reset", "image", "color"].includes(
      element.type,
    );
  }
  return (element as HTMLElement).isContentEditable === true;
}

// The tallest visible height seen at the current width, kept across screens: a screen
// that mounts while the keyboard is already up must not mistake that height for "full".
let tallestHeight = 0;
let tallestWidth = 0;

/** True while the software keyboard is up, so chrome above the input can get out of the way. */
export function useSoftKeyboard(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const evaluate = () => {
      // Rotation changes the tallest possible height; start over.
      if (window.innerWidth !== tallestWidth) {
        tallestWidth = window.innerWidth;
        tallestHeight = 0;
      }
      // iOS leaves innerHeight at the full layout height while the keyboard is up, which
      // seeds a correct baseline even when this screen mounts with the keyboard open.
      tallestHeight = Math.max(tallestHeight, viewport.height, window.innerHeight);
      setOpen(
        isKeyboardOpen({
          baselineHeight: tallestHeight,
          height: viewport.height,
          textFieldFocused: isTextField(document.activeElement),
        }),
      );
    };
    evaluate();
    viewport.addEventListener("resize", evaluate);
    document.addEventListener("focusin", evaluate);
    document.addEventListener("focusout", evaluate);
    return () => {
      viewport.removeEventListener("resize", evaluate);
      document.removeEventListener("focusin", evaluate);
      document.removeEventListener("focusout", evaluate);
    };
  }, []);
  return open;
}
