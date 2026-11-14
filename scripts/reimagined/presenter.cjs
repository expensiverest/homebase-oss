'use strict';

/** Presentation state machine. A navigate() return is NEVER an acknowledgement. */
function createPresenter(env) {
  let mode = 'idle', ticket = 0, requested = false, closed = false;
  let timer = null, afterDismiss = null;
  const later = env.setTimeout || setTimeout;
  const cancel = env.clearTimeout || clearTimeout;
  const delay = env.timeout || 1400;
  const notify = () => { if (!closed) env.changed(); };
  function clear() { if (timer !== null) cancel(timer); timer = null; }
  function schedule(fn, ms) { clear(); timer = later(() => { timer = null; if (!closed) fn(); }, ms); }
  function fail(code) {
    clear(); requested = false; mode = 'idle'; afterDismiss = null;
    env.issue(code); notify();
  }
  function fallback(id, code) {
    if (closed || !requested || id !== ticket) return;
    env.issue(code); clear();
    if (!env.canModal()) return fail('presenter:no-fallback-host');
    mode = 'modal-opening'; notify();
    schedule(() => { if (id === ticket && mode === 'modal-opening') fail('presenter:modal-not-shown'); }, delay);
  }
  function tryRoute(id, attempt) {
    if (closed || !requested || id !== ticket) return;
    const nav = env.root();
    if (!nav || (typeof nav.isReady === 'function' && !nav.isReady())) {
      if (attempt < 4) return schedule(() => tryRoute(id, attempt + 1), 150);
      return fallback(id, 'presenter:navigator-not-ready');
    }
    // Only use a route actually declared by an observed navigator. No guessed
    // nested navigation. Unmounted/lazy settings routes use the proven Modal path.
    const path = env.routePath(nav);
    if (!path || !path.length || typeof nav.navigate !== 'function') return fallback(id, 'presenter:route-not-registered');
    mode = 'route-opening';
    // Arm BEFORE navigate: a renderer may acknowledge synchronously in a test.
    schedule(() => { if (id === ticket && mode === 'route-opening') fallback(id, 'presenter:route-not-visible'); }, delay);
    try { env.navigate(nav, path, id); }
    catch (_) { fallback(id, 'presenter:route-threw'); }
  }
  return {
    snapshot() { return { mode, ticket, requested, ready: mode === 'route' || mode === 'modal', modal: mode === 'modal-opening' || mode === 'modal' }; },
    open() {
      if (closed) return;
      if (requested && (mode === 'modal' || mode === 'modal-opening' || mode === 'route-opening' || mode === 'waiting')) return notify();
      if (requested && mode === 'route' && env.focused(ticket)) return notify();
      clear(); afterDismiss = null; requested = true; ticket++; mode = 'waiting';
      notify(); tryRoute(ticket, 0);
    },
    acceptsRoute(id) { return !closed && requested && id === ticket && (mode === 'route-opening' || mode === 'route'); },
    routeReady(id, focused, width, height) {
      if (closed || !requested || id !== ticket || mode !== 'route-opening' || !focused || !(width > 0 && height > 0)) return false;
      clear(); mode = 'route'; notify(); return true;
    },
    modalShown(id) {
      if (closed || !requested || id !== ticket || mode !== 'modal-opening') return false;
      clear(); mode = 'modal'; notify(); return true;
    },
    routeUnmounted(id) {
      if (closed || id !== ticket || !['route', 'route-opening'].includes(mode)) return;
      clear(); requested = false; mode = 'idle'; notify();
    },
    hostLost() {
      if (['modal', 'modal-opening'].includes(mode) && !env.canModal()) fail('presenter:modal-host-unmounted');
    },
    dismiss(action, leaveRoute) {
      if (closed) return;
      clear(); const previous = mode, previousTicket = ticket; requested = false;
      if (previous === 'modal' || previous === 'modal-opening') {
        mode = 'dismissing'; afterDismiss = typeof action === 'function' ? action : null; notify();
        // Never open native Settings beneath an undismissed iOS Modal.
        schedule(() => { if (mode === 'dismissing') fail('presenter:dismiss-not-confirmed'); }, delay);
      } else {
        mode = 'idle'; ticket++; afterDismiss = null;
        if (leaveRoute && (previous === 'route' || previous === 'route-opening')) env.leaveRoute(previousTicket);
        notify(); if (typeof action === 'function' && !closed) action();
      }
    },
    modalDismissed(id) {
      if (closed || id !== ticket || mode !== 'dismissing') return;
      clear(); const action = afterDismiss; afterDismiss = null; mode = 'idle'; ticket++; notify();
      if (action && !closed) action();
    },
    stop() {
      if (closed) return;
      clear(); const previous = mode, previousTicket = ticket;
      requested = false; afterDismiss = null; mode = 'stopped'; ticket++; closed = true;
      if (previous === 'route' || previous === 'route-opening') env.leaveRoute(previousTicket);
    }
  };
}
module.exports = { createPresenter };
