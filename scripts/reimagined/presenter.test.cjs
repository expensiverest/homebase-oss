'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresenter } = require('./presenter.cjs');
function fixture(options = {}) {
  let now = 0, next = 0, ready = true, focused = true, modal = true;
  const jobs = new Map(), issues = [], calls = [], left = [];
  const nav = { isReady: () => ready, navigate() {} };
  const env = { timeout: 1400, root: () => nav, changed() {}, issue: x => issues.push(x), canModal: () => modal,
    focused: () => focused, routePath: () => ['DISTRA_CUSTOM_PAGE'],
    navigate: (_nav, path, id) => calls.push({ path, id }), leaveRoute: id => left.push(id),
    setTimeout: (fn, ms) => { const id = ++next; jobs.set(id, { at: now + ms, fn }); return id; }, clearTimeout: id => jobs.delete(id), ...options };
  const p = createPresenter(env);
  function advance(ms) { const end = now + ms; let guard = 0; for (;;) { const found = [...jobs].filter(([,j]) => j.at <= end).sort((a,b) => a[1].at - b[1].at)[0]; if (!found) break; if (++guard > 1000) throw Error('Timer loop'); jobs.delete(found[0]); now = found[1].at; found[1].fn(); } now = end; }
  return { p, env, jobs, issues, calls, left, advance, ready: v => ready = v, focused: v => focused = v, modal: v => modal = v };
}
test('navigate returning undefined is not acknowledged as a visible page', () => {
  const f = fixture(); f.p.open(); assert.equal(f.p.snapshot().mode, 'route-opening'); assert.equal(f.p.snapshot().ready, false);
  f.advance(1400); assert.equal(f.p.snapshot().mode, 'modal-opening'); assert.ok(f.issues.includes('presenter:route-not-visible'));
});
test('missing declared route immediately uses fallback instead of guessing route names', () => {
  const f = fixture({ routePath: () => null }); f.p.open(); assert.equal(f.calls.length, 0); assert.equal(f.p.snapshot().modal, true);
});
test('missing root uses bounded readiness wait then fallback', () => {
  const f = fixture({ root: () => null }); f.p.open(); f.advance(600); assert.equal(f.p.snapshot().mode, 'modal-opening');
});
test('not-ready root is never navigated until it reports ready', () => {
  const f = fixture(); f.ready(false); f.p.open(); f.advance(300); assert.equal(f.calls.length, 0); f.ready(true); f.advance(150); assert.equal(f.calls.length, 1);
});
test('root that never becomes ready does not retry forever', () => {
  const f = fixture(); f.ready(false); f.p.open(); f.advance(600); assert.equal(f.calls.length, 0); assert.equal(f.p.snapshot().modal, true);
});
test('navigation exception falls back', () => {
  const f = fixture({ navigate() { throw Error('bad route'); } }); f.p.open(); assert.equal(f.p.snapshot().modal, true);
});
test('mounted but unfocused route is not success', () => {
  const f = fixture(); f.p.open(); const id = f.p.snapshot().ticket;
  assert.equal(f.p.routeReady(id, false, 390, 700), false); f.advance(1400); assert.equal(f.p.snapshot().modal, true);
});
test('zero-height or zero-width layout is not a successful mount', () => {
  const f = fixture(); f.p.open(); const id = f.p.snapshot().ticket;
  assert.equal(f.p.routeReady(id, true, 390, 0), false); assert.equal(f.p.routeReady(id, true, 0, 700), false); assert.equal(f.p.snapshot().ready, false);
});
test('focused nonzero route acknowledges success and cancels fallback timer', () => {
  const f = fixture(); f.p.open(); const id = f.p.snapshot().ticket;
  assert.equal(f.p.routeReady(id, true, 390, 700), true); f.advance(5000); assert.equal(f.p.snapshot().mode, 'route'); assert.equal(f.jobs.size, 0);
});
test('late route cannot replace an already selected modal fallback', () => {
  const f = fixture(); f.p.open(); const id = f.p.snapshot().ticket; f.advance(1400);
  assert.equal(f.p.routeReady(id, true, 390, 700), false); assert.equal(f.p.acceptsRoute(id), false); assert.equal(f.p.snapshot().modal, true);
});
test('onShow is required to confirm modal presentation', () => {
  const f = fixture({ routePath: () => null }); f.p.open(); const id = f.p.snapshot().ticket;
  assert.equal(f.p.snapshot().ready, false); assert.equal(f.p.modalShown(id), true); assert.equal(f.p.snapshot().mode, 'modal');
});
test('modal that fails to show times out without trapping original navigation', () => {
  const f = fixture({ routePath: () => null }); f.p.open(); f.advance(1400); assert.equal(f.p.snapshot().mode, 'idle'); assert.equal(f.p.snapshot().requested, false);
});
test('no Modal primitive or no mounted host leaves presenter idle', () => {
  const f = fixture({ routePath: () => null, canModal: () => false }); f.p.open(); assert.equal(f.p.snapshot().mode, 'idle'); assert.equal(f.jobs.size, 0);
});
test('repeated taps while opening do not enqueue duplicate routes', () => {
  const f = fixture(); f.p.open(); f.p.open(); f.p.open(); assert.equal(f.calls.length, 1);
});
test('mounted background route is not mistaken for a focused scene', () => {
  const f = fixture(); f.p.open(); f.p.routeReady(f.p.snapshot().ticket, true, 390, 700); f.focused(false); f.p.open(); assert.equal(f.calls.length, 2);
});
test('settings handoff waits for native modal dismissal and runs once', () => {
  const f = fixture({ routePath: () => null }); let opens = 0; f.p.open(); const id = f.p.snapshot().ticket; f.p.modalShown(id);
  f.p.dismiss(() => opens++, false); assert.equal(opens, 0); assert.equal(f.p.snapshot().modal, false);
  f.p.modalDismissed(id); f.p.modalDismissed(id); assert.equal(opens, 1); assert.equal(f.p.snapshot().mode, 'idle');
});
test('unconfirmed modal dismissal never opens settings underneath it', () => {
  const f = fixture({ routePath: () => null }); let opens = 0; f.p.open(); const id = f.p.snapshot().ticket; f.p.modalShown(id);
  f.p.dismiss(() => opens++, false); f.advance(1400); f.p.modalDismissed(id); assert.equal(opens, 0); assert.equal(f.p.snapshot().mode, 'idle');
});
test('stop cancels pending route watchdog', () => {
  const f = fixture(); f.p.open(); f.p.stop(); f.advance(5000); assert.equal(f.jobs.size, 0); assert.equal(f.p.snapshot().mode, 'stopped');
});
test('stop cancels a pending Settings handoff', () => {
  const f = fixture({ routePath: () => null }); let opens = 0; f.p.open(); const id = f.p.snapshot().ticket; f.p.modalShown(id);
  f.p.dismiss(() => opens++, false); f.p.stop(); f.p.modalDismissed(id); f.advance(5000); assert.equal(opens, 0);
});
test('explicit restore leaves only its own route through guarded callback', () => {
  const f = fixture(); f.p.open(); const id = f.p.snapshot().ticket; f.p.routeReady(id, true, 390, 700);
  f.p.dismiss(null, true); assert.deepEqual(f.left, [id]); assert.equal(f.p.snapshot().mode, 'idle');
});
test('losing all modal hosts clears the visible state', () => {
  const f = fixture({ routePath: () => null }); f.p.open(); f.p.modalShown(f.p.snapshot().ticket); f.modal(false); f.p.hostLost(); assert.equal(f.p.snapshot().mode, 'idle');
});
test('route unmount resets presentation even when there are other mounted scenes', () => {
  const f = fixture(); f.p.open(); const id = f.p.snapshot().ticket; f.p.routeReady(id, true, 390, 700); f.p.routeUnmounted(id); assert.equal(f.p.snapshot().mode, 'idle');
});
test('stale ticket acknowledgements cannot affect a later request', () => {
  const f = fixture(); f.p.open(); const old = f.p.snapshot().ticket; f.p.dismiss(null, true); f.p.open();
  assert.equal(f.p.routeReady(old, true, 390, 700), false); assert.equal(f.p.modalShown(old), false); assert.equal(f.p.snapshot().ready, false);
});
