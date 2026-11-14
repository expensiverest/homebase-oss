'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const rootDir = path.resolve(__dirname, '../..');
const code = fs.readFileSync(path.join(rootDir, 'discord-reimagined-preview/index.js'), 'utf8');
const baseline = fs.readFileSync(path.join(rootDir, 'discord-reimagined/next.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'discord-reimagined-preview/manifest.json'), 'utf8'));
function element(type, props, ...children) { return { type, props: { ...props, children: children.length === 1 ? children[0] : children } }; }
function walk(node, fn) { if (!node) return; if (Array.isArray(node)) return node.forEach(x => walk(x, fn)); if (typeof node !== 'object') return; fn(node); walk(node.props?.children, fn); }
function find(node, id) { let result; walk(node, n => { if (n.props?.id === id || n.props?.testID === id) result = n; }); return result; }
function fixture(options = {}) {
  let now = 0, nextTimer = 0, focusedRoute = { name: 'home' }, navReady = true;
  const timers = new Map(), navigations = [], issues = [], cleanups = [];
  let settingsOpened = 0, getUser = () => ({ id: '100000000000000001', username: 'fixture', globalName: 'Fixture' });
  class Component { constructor(props) { this.props = props; this.state = {}; } setState(next) { Object.assign(this.state, typeof next === 'function' ? next(this.state) : next); } }
  const React = { Component, Fragment: 'Fragment', createElement: element };
  const RN = Object.fromEntries(['View','Text','Pressable','TouchableOpacity','ScrollView','SafeAreaView','TextInput','Switch','Image','Modal','KeyboardAvoidingView','FlatList'].map(n => [n,n]));
  RN.Dimensions = { get: () => ({ width: 390, height: 844 }), addEventListener: () => ({ remove() {} }) };
  RN.Platform = { OS: 'ios' };
  if (options.noModal) delete RN.Modal;
  const original = element('OriginalYouBar', { settingsAccess: true });
  const target = { default: { type: () => original } };
  const nav = {
    isReady: () => navReady,
    getRootState: () => ({ routeNames: options.noRoute ? ['home', 'settings'] : options.nested ? ['home','settings'] : ['home','settings','DISTRA_CUSTOM_PAGE'], index: 0,
      routes: options.nested ? [{ name: 'settings', state: { routeNames: ['DISTRA_CUSTOM_PAGE'], routes: [focusedRoute], index: 0 } }] : [focusedRoute] }),
    getCurrentRoute: () => focusedRoute,
    navigate(name, params) { navigations.push({ name, params }); if (options.throwNav) throw Error('navigation rejected'); },
    canGoBack: () => true, goBack() { navigations.push({ name: 'goBack' }); focusedRoute = { name: 'home' }; }
  };
  const scoped = { isFocused: () => focusedRoute.name === 'DISTRA_CUSTOM_PAGE', getState: () => ({ routes: [focusedRoute], index: 0 }), canGoBack: () => true, goBack: () => nav.goBack(), addListener: () => () => {} };
  const stores = { UserStore: { getCurrentUser: () => getUser(), getUser: () => getUser() }, UserProfileStore: { getUserProfile: () => ({ bio: 'fixture' }) } };
  const api = {
    storage: { startHome: !!options.autoStart, nativePalette: false, nativeSkin: !!options.hub, accounts: {} },
    common: { React, ReactNative: RN, tabsNavigationRef: { getRootNavigationRef: () => options.noRoot ? null : nav }, NavigationNative: { useNavigation: () => scoped }, constants: { Permissions: {} } },
    metro: { findByStoreName: name => stores[name] || {}, findByProps: (...keys) => keys[0] === 'TableRowGroup' ? options.hub : keys[0] === 'openUserSettings' && !options.noSettingsAction ? { openUserSettings: () => settingsOpened++ } : undefined,
      findByFileName: name => name === 'YouBar' ? target : null, findByTypeName: () => null },
    patcher: { after(method, object, cb) { const orig = object[method]; object[method] = (...args) => cb(args, orig(...args)); cleanups.push(() => object[method] = orig); } },
    logger: { warn: s => issues.push(s) }, toasts: { showToast() {} }
  };
  const sandbox = { definePlugin: x => x, console, setTimeout: (fn, ms = 0) => { const id = ++nextTimer; timers.set(id, { at: now + ms, fn }); return id; }, clearTimeout: id => timers.delete(id) };
  const plugin = vm.runInNewContext('(' + code + ')', sandbox);
  plugin.start(api);
  const mounted = [];
  function mount(el) { const obj = new el.type(el.props); mounted.push(obj); obj.componentDidMount?.(); return obj; }
  const hostElement = target.default.type();
  const host = mount(hostElement);
  function advance(ms) { const end = now + ms; let guard = 0; for (;;) { const entry = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0]; if (!entry) break; if (++guard > 1000) throw Error('timer loop'); timers.delete(entry[0]); now = entry[1].at; entry[1].fn(); } now = end; }
  function press(node) { const component = new node.type(node.props); component.press(); }
  function launch() { press(find(host.render(), 'reimagined-launcher')); }
  function modal() { let result; walk(host.render(), n => { if (n.type === 'Modal') result = n; }); return result; }
  function mountModalScene() {
    const m = modal(); assert.equal(m.props.visible, true); m.props.onShow();
    return mount(m.props.children.props.children);
  }
  function mountRoute() {
    const request = navigations.findLast(n => n.params?.render || n.params?.params?.render); assert.ok(request);
    let params = request.params; while (params.params) params = params.params;
    focusedRoute = { name: 'DISTRA_CUSTOM_PAGE', params };
    const scene = mount(params.render());
    const render = scene.render();
    render.props.onLayout?.({ nativeEvent: { layout: { width: 390, height: 700 } } });
    return scene;
  }
  async function stop() { await plugin.stop(); mounted.reverse().forEach(c => c.componentWillUnmount?.()); cleanups.forEach(f => f()); }
  return { api, plugin, original, host, navigations, issues, launch, modal, mountModalScene, mountRoute, mount, press, advance, stop, settingsOpened: () => settingsOpened,
    changeUser: fn => getUser = fn, setReady: v => navReady = v, focused: r => focusedRoute = r };
}
function controlInScene(scene, id) {
  let result;
  function visit(el, depth = 0) {
    if (!el || depth > 30 || result) return;
    if (Array.isArray(el)) return el.forEach(x => visit(x, depth));
    if (typeof el !== 'object') return;
    if (el.props?.id === id || el.props?.testID === id) { result = el; return; }
    if (typeof el.type === 'function') {
      if (el.type.prototype?.render) visit(new el.type(el.props).render(), depth + 1);
      else visit(el.type(el.props), depth + 1);
    } else visit(el.props?.children, depth + 1);
  }
  visit(scene.render()); return result;
}
test('package entry point and exact source SHA-256 match', () => {
  assert.equal(manifest.main, 'index.js'); assert.equal(manifest.version, '0.2.0-alpha.5');
  assert.equal(manifest.hash, crypto.createHash('sha256').update(code).digest('hex'));
});
test('0.2 message, profile and voice service implementation is preserved', () => {
  const segment = s => s.slice(s.indexOf('  function explain(e)'), s.indexOf('  function buildUI()'));
  assert.ok(segment(code).length > 5000); assert.equal(segment(code), segment(baseline));
});
test('silently ignored route keeps original You Bar before and after fallback', async () => {
  const f = fixture(); assert.equal(f.host.render().props.children[0], f.original); f.launch(); f.advance(1400);
  assert.equal(f.plugin.diagnostics().presentation.mode, 'modal-opening'); assert.equal(f.host.render().props.children[0], f.original);
  f.mountModalScene(); assert.equal(f.plugin.diagnostics().presentation.mode, 'modal'); await f.stop();
});
test('unregistered route is not dispatched; actual 0.2 Scene uses Modal fallback', async () => {
  const f = fixture({ noRoute: true }); f.launch(); assert.equal(f.navigations.length, 0); const scene = f.mountModalScene();
  assert.equal(scene.render().props.testID, 'reimagined-scene'); assert.equal(f.host.render().props.children[0].props.settingsAccess, true); await f.stop();
});
test('missing Modal support fails open to the original bar', async () => {
  const f = fixture({ noRoute: true, noModal: true }); f.launch(); assert.equal(f.plugin.diagnostics().presentation.mode, 'idle');
  assert.equal(f.host.render().props.children[0], f.original); await f.stop();
});
test('actual Scene nonzero layout and focused route acknowledge native presentation', async () => {
  const f = fixture(); f.launch(); f.mountRoute(); f.advance(2000); assert.equal(f.plugin.diagnostics().presentation.mode, 'route'); assert.equal(f.modal().props.visible, false); await f.stop();
});
test('observed nested navigator receives correct nested screen parameters', async () => {
  const f = fixture({ nested: true }); f.launch(); assert.equal(f.navigations[0].name, 'settings'); assert.equal(f.navigations[0].params.screen, 'DISTRA_CUSTOM_PAGE'); f.mountRoute(); assert.equal(f.plugin.diagnostics().presentation.mode, 'route'); await f.stop();
});
test('settings from fallback opens only after onDismiss, not underneath the modal', async () => {
  const f = fixture({ noRoute: true }); f.launch(); const scene = f.mountModalScene();
  const settings = controlInScene(scene, 'open-settings'); assert.ok(settings, 'Settings control exists'); f.press(settings);
  assert.equal(f.settingsOpened(), 0); assert.equal(f.modal().props.visible, false); f.modal().props.onDismiss(); assert.equal(f.settingsOpened(), 1); await f.stop();
});
test('Restore Discord stays accessible and disables automatic replacement', async () => {
  const f = fixture({ noRoute: true }); f.launch(); const scene = f.mountModalScene(); f.press(find(scene.render(), 'restore-discord'));
  assert.equal(f.api.storage.layout, false); assert.equal(f.modal().props.visible, false); assert.equal(f.host.render().props.children[0], f.original); await f.stop();
});
test('after Restore Discord a launcher returns to Reimagined', async () => {
  const f = fixture({ noRoute: true }); f.launch(); const scene = f.mountModalScene(); f.press(find(scene.render(), 'restore-discord'));
  assert.equal(find(f.host.render(), 'reimagined-launcher'), undefined);
  f.press(find(f.host.render(), 'reimagined-return'));
  assert.equal(f.api.storage.layout, true); assert.equal(f.modal().props.visible, true); await f.stop();
});
test('Home renders the glance summary and the Mentions filter exists', async () => {
  const f = fixture({ noRoute: true }); f.launch(); const scene = f.mountModalScene();
  assert.ok(controlInScene(scene, 'search'));
  const glance = [];
  (function visit(el, d = 0) { if (!el || d > 30) return; if (Array.isArray(el)) return el.forEach(x => visit(x, d)); if (typeof el !== 'object') { if (el === 'All caught up') glance.push(el); return; }
    if (typeof el.type === 'function') visit(el.type.prototype?.render ? new el.type(el.props).render() : el.type(el.props), d + 1); else visit(el.props?.children, d + 1); })(scene.render());
  assert.equal(glance.length, 1);
  f.press(controlInScene(scene, 'tab-messages')); assert.ok(controlInScene(scene, 'filter-mentions')); await f.stop();
});
test('returns to Reimagined after leaving a native Settings screen', async () => {
  const f = fixture({ noRoute: true }); f.launch(); const scene = f.mountModalScene();
  f.press(controlInScene(scene, 'open-settings')); f.modal().props.onDismiss();
  assert.equal(f.settingsOpened(), 1); assert.equal(f.modal().props.visible, false);
  f.focused({ name: 'settings' }); f.advance(800); f.focused({ name: 'home' }); f.advance(1000);
  assert.equal(f.modal().props.visible, true); await f.stop();
});
test('native skin wraps design-system groups and is inert when disabled', async () => {
  const group = { default: { type: () => ({ type: 'RowGroup', props: {} }) } };
  const f = fixture({ hub: { TableRowGroup: group.default, TableRow: {} } });
  assert.equal(f.plugin.diagnostics().hooks.NativeSkinGroup, 'patched x1');
  const wrapped = group.default.type(); assert.equal(typeof wrapped.type, 'function'); assert.equal(wrapped.props.children.type, 'RowGroup');
  f.api.storage.nativeSkin = false; assert.equal(group.default.type().type, 'RowGroup'); await f.stop();
});
test('teardown preserves the original component rather than leaving a dead custom dock', async () => {
  const f = fixture(); f.launch(); await f.stop(); assert.equal(f.host.render(), f.original); f.advance(5000); assert.equal(f.plugin.diagnostics().presentation.mode, 'stopped');
});
test('native navigation readiness is respected during auto launch', async () => {
  const f = fixture({ autoStart: true }); f.setReady(false); f.advance(450); assert.equal(f.navigations.length, 0); f.setReady(true); f.advance(150); assert.equal(f.navigations.length, 1); await f.stop();
});
test('late route callbacks cannot take over a displayed fallback', async () => {
  const f = fixture(); f.launch(); f.advance(1400); f.mountModalScene(); const late = f.mountRoute(); assert.equal(f.plugin.diagnostics().presentation.mode, 'modal'); assert.notEqual(late.render().props.testID, 'reimagined-scene'); await f.stop();
});
