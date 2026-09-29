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
 * Blocks page-level touch panning and page zoom; returns a cleanup. Scrollers keep working.
 *
 * iOS (Safari and standalone PWAs) can still pinch-zoom a page that says `user-scalable=no`, so
 * multi-finger touches are cancelled outright and the WebKit-only `gesture*` events are stopped.
 */
export function lockPagePanning(target: Document = document): () => void {
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      event.preventDefault(); // a pinch: never zoom the page
      return;
    }
    if (!canScrollInside(event.target instanceof Element ? event.target : null)) event.preventDefault();
  };
  const stop = (event: Event) => event.preventDefault();
  target.addEventListener("touchmove", onTouchMove, { passive: false });
  for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
    target.addEventListener(name, stop, { passive: false });
  }
  return () => {
    target.removeEventListener("touchmove", onTouchMove);
    for (const name of ["gesturestart", "gesturechange", "gestureend"]) target.removeEventListener(name, stop);
  };
}
