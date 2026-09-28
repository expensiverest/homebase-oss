import { useCallback, useEffect, useRef, useState } from "react";

export interface ChatScrollController {
  atBottom: boolean;
  scrollToBottom(smooth?: boolean): void;
  /** Call before prepending older messages; returns the previous height. */
  captureHeight(): number;
  /** Call after prepending; keeps the viewport anchored. */
  restoreHeight(previousHeight: number): void;
}

export function useChatScroll(ref: React.RefObject<HTMLElement | null>): ChatScrollController {
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  const updateAtBottom = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const next = distance < 80;
    atBottomRef.current = next;
    setAtBottom(next);
  }, [ref]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    updateAtBottom();
    element.addEventListener("scroll", updateAtBottom, { passive: true });
    return () => element.removeEventListener("scroll", updateAtBottom);
  }, [ref, updateAtBottom]);

  const scrollToBottom = useCallback(
    (smooth = false) => {
      const element = ref.current;
      if (!element) return;
      element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
      atBottomRef.current = true;
      setAtBottom(true);
    },
    [ref],
  );

  const captureHeight = useCallback(() => ref.current?.scrollHeight ?? 0, [ref]);

  const restoreHeight = useCallback(
    (previousHeight: number) => {
      const element = ref.current;
      if (!element) return;
      const delta = element.scrollHeight - previousHeight;
      if (delta > 0) element.scrollTop += delta;
    },
    [ref],
  );

  return { atBottom, scrollToBottom, captureHeight, restoreHeight };
}

/** Keeps the composer sized above the iOS software keyboard. */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setHeight(viewport.height);
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return height;
}
