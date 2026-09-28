import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Reveals streaming text at a comfortable pace instead of reflowing on every
 * tiny chunk. Very fast streams catch up in one frame; reduced-motion users
 * see updates immediately.
 */
export function useSmoothText(target: string, options: { enabled?: boolean } = {}): string {
  const enabled = options.enabled ?? true;
  const [display, setDisplay] = useState(target);
  const targetRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  targetRef.current = target;

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      setDisplay(target);
      return;
    }
    if (target.length < display.length || !target.startsWith(display)) {
      setDisplay(target); // History replaced the live text; take it over at once.
      return;
    }
    if (display === target) return;

    const step = () => {
      setDisplay((current) => {
        const full = targetRef.current;
        if (!full.startsWith(current)) return full;
        if (current === full) return current;
        const remaining = full.length - current.length;
        const advance = Math.max(1, Math.ceil(remaining / 8));
        return full.slice(0, current.length + advance);
      });
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [target, enabled, display]);

  return enabled ? display : target;
}
