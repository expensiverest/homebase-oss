/**
 * The app never lets the page itself move: the shell is fixed. But a touch drag that starts on
 * something that is not a scroll area (the composer, headers) would otherwise pan the page or
 * the visual viewport, which shakes the whole screen while the keyboard is up. So a drag is
 * allowed only when it begins inside something that can really scroll.
 */
export function canScrollInside(element: Element | null, boundary: Element | null = null): boolean {
  for (let node: Element | null = element; node && node !== boundary; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrollsY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const scrollsX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    if (scrollsY || scrollsX) return true;
  }
  return false;
}

/**
 * Blocks one-finger page panning; multi-finger gestures remain available for accessibility zoom.
 */
export function lockPagePanning(target: Document = document): () => void {
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) return;
    if (!canScrollInside(event.target instanceof Element ? event.target : null)) event.preventDefault();
  };
  target.addEventListener("touchmove", onTouchMove, { passive: false });
  return () => {
    target.removeEventListener("touchmove", onTouchMove);
  };
}
