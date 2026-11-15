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
  const React = { Component, Fragment: 'Fragment', createElement: element, isValidElement: v => !!v && typeof v === 'object' && 'props' in v && 'type' in v, cloneElement: (el, props, ...kids) => ({ ...el, props: { ...el.props, ...(props || {}), ...(kids.length ? { children: kids.length === 1 ? kids[0] : kids } : {}) } }), Children: { toArray: c => c == null ? [] : [].concat(c) } };
  const RN = Object.fromEntries(['View','Text','Pressable','TouchableOpacity','ScrollView','SafeAreaView','TextInput','Switch','Image','Modal','KeyboardAvoidingView','FlatList'].map(n => [n,n]));
  RN.Dimensions = { get: () => ({ width: 390, height: 844 }), addEventListener: () => ({ remove() {} }) };
  RN.Platform = { OS: 'ios' };
  RN.StyleSheet = { flatten: st => Array.isArray(st) ? Object.assign({}, ...st.map(RN.StyleSheet.flatten)) : st || {} };
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
    storage: { startHome: !!options.autoStart, nativePalette: false, nativeSkin: !!options.hub, nativeSkinRows: !!options.rows, blueprint: !!options.blueprint, nativeScreens: !!options.screens, accounts: {} },
    common: { React, ReactNative: RN, tabsNavigationRef: { getRootNavigationRef: () => options.noRoot ? null : nav }, NavigationNative: { useNavigation: () => scoped }, constants: { Permissions: {} } },
    metro: { findByStoreName: name => stores[name] || {}, findByProps: (...keys) => keys[0] === 'TableRowGroup' ? options.hub : keys[0] === 'openUserSettings' && !options.noSettingsAction ? { openUserSettings: () => settingsOpened++ } : undefined,
      findByFilePath: file => options.files?.[file], findByFileName: name => name === 'YouBar' ? target : null, findByTypeName: () => null },
    patcher: { after(method, object, cb) { const orig = object[method]; object[method] = (...args) => cb(args, orig(...args)); cleanups.push(() => object[method] = orig); }, before(method, object, cb) { const orig = object[method]; object[method] = (...args) => { const r = cb(args); return orig(...(r || args)); }; cleanups.push(() => object[method] = orig); } },
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
  assert.equal(manifest.main, 'index.js'); assert.equal(manifest.version, '0.2.0-alpha.40');
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
  assert.equal(f.plugin.diagnostics().hooks.NativeSkinTableRowGroup, 'patched x1');
  const wrapped = group.default.type(); assert.equal(typeof wrapped.type, 'function'); assert.equal(wrapped.props.children.type, 'RowGroup');
  f.api.storage.nativeSkin = false; assert.equal(group.default.type().type, 'RowGroup'); await f.stop();
});
test('native skin restyles group titles, containers, rows and selected radios', async () => {
  const card = { type: 'Card', props: { style: { padding: 0 }, children: { type: 'TableRowInner', props: { trailing: { type: 'FormRadio', props: { selected: true } } } } } };
  const group = { type: 'Provider', props: { children: { type: 'View', props: { style: { flexShrink: 0 }, children: [{ type: 'TableRowGroupTitle', props: { title: 'Devices' } }, { type: 'View', props: { style: { borderRadius: 12, overflow: 'hidden' }, children: card } }] } } } };
  const hub = { TableRowGroup: { type: () => group }, TableRow: { type: () => card } };
  const f = fixture({ hub, rows: true });
  const g = hub.TableRowGroup.type();
  const flatText = JSON.stringify(g);
  assert.ok(flatText.includes('DEVICES')); assert.ok(flatText.includes('"borderRadius":24'));
  const r = hub.TableRow.type(); assert.ok(JSON.stringify(r).includes('"minHeight":64') && JSON.stringify(r).includes('backgroundColor'));
  await f.stop();
});
test('blueprint recording observes rows without altering them', async () => {
  const row = { default: { type: () => ({ type: 'Row', props: { style: { height: 40 } } }) } };
  const f = fixture({ hub: { TableRowGroup: { default: { type: () => ({ type: 'G', props: {} }) } }.default, TableRow: row.default } });
  f.api.storage.nativeSkin = false; f.api.storage.nativeSkinRows = false; f.api.storage.blueprint = true;
  f.api.storage.nativeSkinRows = true; f.api.storage.nativeSkinRows = false;
  const out = row.default.type(); assert.equal(out.type, 'Row'); assert.equal(out.props.style.height, 40); await f.stop();
});
test('native skin wraps the settings SearchField in a pill', async () => {
  const field = { type: () => ({ type: 'Field', props: {} }) };
  const f = fixture({ hub: { TableRowGroup: { type: () => null }, TableRow: {}, SearchField: field } });
  assert.equal(f.plugin.diagnostics().hooks.NativeSkinSearchField, 'patched x1');
  const out = JSON.stringify(field.type()); assert.ok(out.includes('"borderRadius":18') && out.includes('Field')); await f.stop();
});
test('native screens restyle design-system cards in place and report hub exports', async () => {
  const card = { type: () => ({ type: 'View', props: { style: { flex: 1 } } }) };
  const f = fixture({ hub: { TableRowGroup: { type: () => null }, TableRow: {}, Card: card }, screens: true });
  const d = f.plugin.diagnostics().hooks; assert.equal(d.NativeSkinCard, 'patched x1'); assert.match(d.HubExports, /Card/);
  const out = JSON.stringify(card.type()); assert.ok(out.includes('"borderRadius":24') && out.includes('"flex":1')); await f.stop();
});
test('native screens keep conversation rows native unless the row beta is enabled', async () => {
  const f = fixture({ hub: { TableRowGroup: { type: () => null }, TableRow: {} }, screens: true });
  const create = f.api.common.React.createElement, Row = function Row() { return null; };
  assert.equal(create(Row, { channelId: '1' }).type, Row); f.api.storage.nativeRowsBeta = true;
  const wrapped = create(Row, { channelId: '1' }); assert.notEqual(wrapped.type, Row); assert.equal(wrapped.props.__reimaginedOrig, Row);
  const card = new wrapped.type(wrapped.props), relaid = card.render(); assert.equal(relaid.props.id, '1');
  const nativeRow = new relaid.type(relaid.props); assert.equal(nativeRow.render(), relaid.props.fallback);
  assert.equal(create(Row, { channelId: '1', extra: 1 }).type, Row);
  assert.equal(create(Row, { channelId: '1', __reimaginedRaw: true }).type, Row);
  f.api.storage.nativeScreens = false; assert.equal(create(Row, { channelId: '1' }).type, Row); await f.stop();
});
test('native screens re-lay out pieces in place and only replace You on its route', async () => {
  const out = { type: 'native-out', props: { children: { type: 'Text', props: { children: 'Recent activity' } } } };
  const NC = 'modules/notification_center/native/', files = {
    'modules/main_tabs_v2/native/tabs/you/YouScreen.tsx': { default: () => out },
    [NC + 'ForYouRecentActivitySectionHeader.tsx']: { ForYouRecentActivitySectionHeader: () => out },
    [NC + 'ForYouItems.tsx']: { ForYouItems: () => out },
    'modules/main_tabs_v2/native/tabs/messages/items/MessagesItemChannel.tsx': { MessagesItemChannelFast: () => out }
  };
  const f = fixture({ hub: { TableRowGroup: { type: () => null }, TableRow: {} }, screens: true, files });
  await f.advance(2000);
  const hooks = f.plugin.diagnostics().hooks;
  assert.equal(hooks.NativeForYouEmpty, undefined); assert.equal(hooks.NativeDmRow, 'not found'); assert.equal(hooks.NativeYou, 'patched');
  assert.equal(files['modules/main_tabs_v2/native/tabs/you/YouScreen.tsx'].default(), out);
  const header = files[NC + 'ForYouRecentActivitySectionHeader.tsx'].ForYouRecentActivitySectionHeader();
  assert.notEqual(header, out); assert.equal(header.props.fallback, out); assert.ok(JSON.stringify(header).includes('RECENT ACTIVITY'));
  assert.equal(files[NC + 'ForYouItems.tsx'].ForYouItems(), out);
  assert.equal(files['modules/main_tabs_v2/native/tabs/messages/items/MessagesItemChannel.tsx'].MessagesItemChannelFast({ channelId: '9' }), out);
  f.focused({ name: 'you' }); const you = files['modules/main_tabs_v2/native/tabs/you/YouScreen.tsx'].default();
  assert.equal(you.props.__out, out); const host = new you.type(you.props), tree = host.render();
  const find = (n, pred) => !n || typeof n !== 'object' ? null : pred(n) ? n : [].concat(n.props?.children ?? []).concat(Array.isArray(n) ? n : []).reduce((a, k) => a || find(k, pred), null);
  const page = find(tree, n => n.type?.name === 'YouPage'); assert.ok(page, 'You page rendered');
  const youText = JSON.stringify(new page.type(page.props).render()); for (const s of ['MEMBER SINCE', 'Edit Profile', 'Quests', 'Shop', 'Nitro', 'Friends', 'NOTE (ONLY VISIBLE TO YOU)']) assert.ok(youText.includes(s), s);
  host.state.classic = true; assert.ok(JSON.stringify(host.render()).includes('native-out'));
  assert.equal(f.plugin.diagnostics().hooks.NativeForYouRecentHeader, 'applied');
  f.api.storage.nativeScreens = false; assert.equal(files[NC + 'ForYouRecentActivitySectionHeader.tsx'].ForYouRecentActivitySectionHeader(), out); await f.stop();
});
test('native screens redesign DM rows, notifications and the server rail in measured cells and hide the quest dock', async () => {
  const MI = 'modules/main_tabs_v2/native/tabs/messages/items/', NC = 'modules/notification_center/native/', QH = 'modules/quests/native/QuestHooks.native.tsx';
  const pressable = { type: 'PressableHighlight', props: { onPress() {}, onLongPress() {}, style: { flex: 1 } } };
  const item = info => info.kind === 'divider' ? { type: 'View', props: { style: { height: 1 } } } : { type: 'ErrorBoundary', props: { children: { type: 'Row', props: { item: info } } } };
  const files = {
    [MI + 'MessagesItemChannel.tsx']: { getMessagesItemChannelSizes: () => ({ avatar: 32, height: 56, label: 20, labelSecondary: 16, padding: 16 }) },
    [MI + 'channel/MessagesItemChannelBase.tsx']: { default: () => ({ type: 'View', props: { style: { height: 0 }, children: pressable } }) },
    [NC + 'ForYouItems.tsx']: { ForYouItems: () => ({ type: 'View', props: { children: { type: 'FlashList', props: { data: [], renderItem: item } } } }) },
    'modules/guilds_bar/native/GuildsBar.tsx': { default: () => ({ type: 'Profiler', props: { children: { type: 'View', props: { nativeID: 'guilds-bar-view', style: { flex: 1 } } } } }) },
    [QH]: { useIsMobileQuestDockRenderedBase: () => true, useMobileQuestDockHeight: () => 120 },
    'modules/quests/native/QuestDock/QuestDock.tsx': { default: () => ({ type: 'Dock', props: {} }) }
  };
  const f = fixture({ hub: { TableRowGroup: { type: () => null }, TableRow: {} }, screens: true, files });
  const sizes = files[MI + 'MessagesItemChannel.tsx'].getMessagesItemChannelSizes(); assert.ok(sizes.height > 56); assert.equal(sizes.avatar, 40);
  const row = files[MI + 'channel/MessagesItemChannelBase.tsx'].default({ height: sizes.height, channel: { id: '1' } });
  const card = JSON.stringify(row.props.children.props.style); assert.ok(card.includes('borderRadius') && card.includes('"flex":1'));
  assert.deepEqual(files[MI + 'channel/MessagesItemChannelBase.tsx'].default({ height: 56, channel: { id: '1' } }).props.children.props.style, { flex: 1 });
  const list = files[NC + 'ForYouItems.tsx'].ForYouItems().props.children, rendered = list.props.renderItem({ kind: 'row' });
  assert.equal(rendered.props.children.type, 'ErrorBoundary'); assert.ok(JSON.stringify(rendered.props.style).includes('borderRadius'));
  assert.equal(list.props.renderItem({ kind: 'divider' }).props.style.height > 1, true);
  assert.ok(JSON.stringify(files['modules/guilds_bar/native/GuildsBar.tsx'].default()).includes('borderTopRightRadius'));
  assert.equal(files[QH].useIsMobileQuestDockRenderedBase(), false); assert.equal(files[QH].useMobileQuestDockHeight(), 0);
  assert.equal(files['modules/quests/native/QuestDock/QuestDock.tsx'].default(), null);
  f.api.storage.hideQuestDock = false; assert.equal(files[QH].useIsMobileQuestDockRenderedBase(), true);
  f.api.storage.nativeScreens = false; assert.equal(files[MI + 'MessagesItemChannel.tsx'].getMessagesItemChannelSizes().height, 56); await f.stop();
});
test('alpha.36: servers move to a top strip, scroll bars are hidden, DM rows get new content and You embeds native profile pieces', async () => {
  const pane = { type: 'View', props: { nativeID: 'messages-parent-view', style: { position: 'absolute', left: 72 } } };
  const HomePanelContent = () => ({ type: 'Rail', props: {} });
  const LeftPanelContent = () => ({ type: 'View', props: { style: { flex: 1 }, children: [{ type: HomePanelContent, props: {} }, pane] } });
  const LeftMenuTabsInner = () => ({ type: 'View', props: { children: { type: LeftPanelContent, props: {} } } });
  const MI = 'modules/main_tabs_v2/native/tabs/messages/items/', UPN = 'modules/user_profile/native/';
  const NativeNote = () => null, NativeBoard = () => null;
  const files = {
    'components_native/MainChannels.tsx': { default: () => ({ type: 'Profiler', props: { children: { type: LeftMenuTabsInner, props: {} } } }) },
    'modules/main_tabs_v2/native/tabs/guilds/HomePanelContent.tsx': { HomePanelContent },
    [MI + 'MessagesItemChannel.tsx']: { getMessagesItemChannelSizes: () => ({ avatar: 32, height: 56, padding: 16 }) },
    [MI + 'channel/MessagesItemChannelBase.tsx']: { default: () => ({ type: 'View', props: { children: { type: 'Pressable', props: { onPress() {}, onLongPress() {}, children: 'native content' } } } }) },
    'modules/main_tabs_v2/native/tabs/you/YouScreen.tsx': { default: () => ({ type: 'native-out', props: {} }) },
    [UPN + 'UserProfileNote.tsx']: { default: NativeNote }, [UPN + 'UserProfileWidgetsBoardTab.tsx']: { default: NativeBoard }
  };
  const f = fixture({ hub: { TableRowGroup: { type: () => null }, TableRow: {} }, screens: true, files });
  const create = f.api.common.React.createElement;
  const sv = create('ScrollView', { showsVerticalScrollIndicator: true });
  assert.equal(sv.props.showsVerticalScrollIndicator, false); assert.equal(sv.props.showsHorizontalScrollIndicator, false);
  f.api.storage.hideScrollBars = false; assert.equal(create('ScrollView', { showsVerticalScrollIndicator: true }).props.showsVerticalScrollIndicator, true); f.api.storage.hideScrollBars = true;
  const top = files['components_native/MainChannels.tsx'].default(), inner = top.props.children;
  assert.notEqual(inner.type, LeftMenuTabsInner);
  const mid = inner.type(inner.props), left = mid.props.children; assert.notEqual(left.type, LeftPanelContent);
  const panel = left.type(left.props), kids = [].concat(panel.props.children);
  assert.ok(!kids.some(k => k?.type === HomePanelContent), 'rail removed');
  const paneEl = kids.find(k => k?.props?.el?.props?.nativeID === 'messages-parent-view'), movedPane = new paneEl.type(paneEl.props).render(); assert.ok(JSON.stringify(movedPane.props.style).includes('"left":0'));
  const strip = kids[kids.length - 1].props.children, outer = new strip.type(strip.props).render(), body = outer.type(outer.props), stripTree = new body.type(body.props).render();
  assert.equal(stripTree.props.testID, 'reimagined-server-strip'); assert.equal(stripTree.props.children.props.horizontal, true);
  assert.equal(f.plugin.diagnostics().hooks.ServerStrip, 'applied');
  const sizes = files[MI + 'MessagesItemChannel.tsx'].getMessagesItemChannelSizes();
  const row = files[MI + 'channel/MessagesItemChannelBase.tsx'].default({ height: sizes.height, channel: { id: '1', type: 3, name: 'Crew', recipients: [] } });
  const rowText = JSON.stringify(row); assert.ok(rowText.includes('Crew') && !rowText.includes('native content'));
  f.focused({ name: 'you' }); const you = files['modules/main_tabs_v2/native/tabs/you/YouScreen.tsx'].default(), host = new you.type(you.props);
  const find = (n, pred) => !n || typeof n !== 'object' ? null : pred(n) ? n : [].concat(n.props?.children ?? []).concat(Array.isArray(n) ? n : []).reduce((a, k) => a || find(k, pred), null);
  const page = find(host.render(), n => n.type?.name === 'YouPage'), instance = new page.type(page.props);
  assert.ok(find(instance.render(), n => n.type === NativeNote), 'native note embedded');
  instance.state.tab = 'board'; assert.ok(find(instance.render(), n => n.type === NativeBoard), 'native board tab');
  await f.stop();
});
const RN_bg = el => [].concat(el.props.style).reduce((a, st) => st && st.backgroundColor !== undefined ? st.backgroundColor : a, undefined);
test('alpha.40: strip positions, native You actions, chat and server screens redesigned in place', async () => {
  const pane = { type: 'View', props: { nativeID: 'messages-parent-view', style: { position: 'absolute', left: 72, borderTopLeftRadius: 24 }, children: { type: 'Fragment', props: { children: [
    { type: 'View', props: { style: [{ flex: 1 }, { borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }], children: { type: 'Screens', props: {} } } },
    { type: 'View', props: { pointerEvents: 'none', style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderRadius: 24 } } }] } } } };
  const frame = { type: 'View', props: { pointerEvents: 'none', style: { position: 'absolute', top: 0, bottom: 0, left: 72, right: 0, borderLeftWidth: 1, borderTopWidth: 1, borderTopLeftRadius: 24 } } };
  const HomePanelContent = () => ({ type: 'Rail', props: {} });
  const panelFn = () => ({ type: 'View', props: { children: [{ type: HomePanelContent, props: {} }, pane, frame] } });
  const calls = [];
  const files = {
    'components_native/MainChannels.tsx': { default: () => ({ type: 'View', props: { children: { type: panelFn, props: {} } } }) },
    'modules/main_tabs_v2/native/tabs/guilds/HomePanelContent.tsx': { HomePanelContent },
    'modules/main_tabs_v2/native/you_bar/hooks/useYouBarTotalHeight.tsx': { useYouBarTotalHeight: () => 90 },
    'modules/main_tabs_v2/native/tabs/you/YouScreen.tsx': { default: () => ({ type: 'native-out', props: {} }) },
    'modules/user_settings/core/native/openUserSettings.tsx': { openUserSettings: o => calls.push(['settings', o.screen]), UserSettingsSections: { PROFILE_CUSTOMIZATION: 'PROFILE_CUSTOMIZATION', PREMIUM: 'PREMIUM' } },
    'modules/collectibles/CollectiblesActionCreators.tsx': { openCollectiblesShopMobile: () => calls.push(['shop']) },
    'modules/quests/native/QuestUtils.native.tsx': { openQuestHome: o => calls.push(['quests', typeof o]) },
    'modules/chat/native/ChatView.tsx': { default: () => ({ type: 'NativeChat', props: { style: { flex: 1 } } }) },
    'modules/chat_input/native/ChatInput.tsx': { default: () => ({ type: 'View', props: { children: { type: 'View', props: { collapsable: false, onStartShouldSetResponder: () => true, onResponderRelease: () => {}, style: { borderRadius: 24 }, children: { type: 'View', props: { style: { flexDirection: 'row', paddingHorizontal: 8 }, children: [
      { type: 'View', props: { style: { paddingBottom: 6, paddingLeft: 4 }, children: { type: 'Actions', props: { onPressAction: 1, canUpload: true } } } }, { type: 'View', props: { style: { flex: 1 }, children: 'field' } }, { type: 'View', props: { style: { paddingBottom: 6 }, children: [{ type: 'Right', props: { onPressExpression: 1, onPressAction: 1 } }, null] } }, { type: 'Send', props: { onSendMessage: 1 } }] } } } } } }) },
    'modules/channel_list_v2/native/items/TextChannel.tsx': { default: p => ({ type: 'Pressable', props: { style: { marginHorizontal: 8 }, children: [p.selected ? { type: 'View', props: { style: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } } } : null, { type: 'View', props: { style: { flexDirection: 'row' }, children: 'general' } }] } }) }
  };
  const f = fixture({ hub: { TableRowGroup: { type: () => null }, TableRow: {} }, screens: true, files });
  const layout = () => { const panel = files['components_native/MainChannels.tsx'].default().props.children, kids = [].concat(panel.type(panel.props).props.children);
    const paneEl = kids.find(k => k?.props?.el), strip = kids[kids.length - 1].props.children, outer = new strip.type(strip.props).render(), body = outer.type(outer.props);
    const frameEl = kids.find(k => k?.props?.frame);
    const paneOut = new paneEl.type(paneEl.props).render(), flat = st => Object.assign({}, ...[].concat(st).flat(3).filter(Boolean)), inner = paneOut.props.children.props.children;
    return { inner: flat(inner[0].props.style), innerFrame: flat(inner[1].props.style), pane: paneOut.props.style, frame: Object.assign({}, ...[].concat(new frameEl.type(frameEl.props).render().props.style)), strip: new body.type(body.props).render() }; };
  const seek = (n, pred) => !n || typeof n !== 'object' ? null : pred(n) ? n : [].concat(n.props?.children ?? []).concat(Array.isArray(n) ? n : []).reduce((a, k) => a || seek(k, pred), null);
  f.api.storage.stripPosition = 'left'; let l = layout();
  assert.ok(JSON.stringify(l.pane).includes('"left":68')); assert.ok(JSON.stringify(l.pane).includes('"borderTopLeftRadius":24,"borderTopRightRadius":0')); assert.equal(l.strip.props.style.left, 0); assert.equal(l.strip.props.style.bottom, 90); assert.ok(l.strip.props.style.borderBottomRightRadius > 0); assert.equal(l.strip.props.style.width, 68); assert.equal(l.strip.props.children.props.horizontal, false);
  f.api.storage.stripPosition = 'right'; l = layout(); assert.ok(JSON.stringify(l.pane).includes('"right":68')); assert.ok(JSON.stringify(l.pane).includes('"borderTopLeftRadius":0,"borderTopRightRadius":24')); assert.equal(l.strip.props.style.right, 0); assert.equal(l.strip.props.style.bottom, 90);
  assert.deepEqual([l.frame.left, l.frame.right, l.frame.borderTopLeftRadius, l.frame.borderTopRightRadius, l.frame.borderLeftWidth, l.frame.borderRightWidth], [0, 68, 0, 24, 0, 1]);
  const marker = seek(l.strip, n => n.props?.pointerEvents === 'none' && n.props.style?.height === 24); assert.equal(marker.props.style.left, -12); assert.equal(marker.props.style.right, undefined);
  assert.deepEqual([l.inner.borderTopLeftRadius, l.inner.borderTopRightRadius], [0, 24]); assert.deepEqual([l.innerFrame.borderTopLeftRadius, l.innerFrame.borderTopRightRadius, l.innerFrame.borderLeftWidth, l.innerFrame.borderRightWidth, l.innerFrame.borderTopWidth], [0, 24, 0, 1, 1]);
  f.api.storage.stripPosition = 'bottom'; l = layout(); assert.ok(JSON.stringify(l.pane).includes('"bottom":78')); assert.ok(JSON.stringify(l.pane).includes('"borderTopLeftRadius":0,"borderTopRightRadius":0')); assert.equal(l.strip.props.style.bottom, 104); assert.ok(l.strip.props.style.left > 0); assert.equal(l.strip.props.style.left, l.strip.props.style.right); assert.ok(l.strip.props.style.borderRadius > 0); assert.equal(l.frame.borderTopLeftRadius, 0); assert.equal(l.frame.opacity, 0); assert.deepEqual([l.inner.borderTopLeftRadius, l.inner.borderTopRightRadius, l.innerFrame.opacity], [0, 0, 0]);
  assert.match(f.plugin.diagnostics().hooks.PaneCorners, /frames=1 rounded=1/); assert.equal(l.strip.props.children.props.horizontal, true);
  assert.equal(f.plugin.diagnostics().hooks.ServerStripPosition, 'bottom');
  f.api.storage.stripPosition = 'top'; l = layout(); assert.ok(JSON.stringify(l.pane).includes('"borderTopLeftRadius":24,"borderTopRightRadius":24'));
  f.focused({ name: 'you' }); const you = files['modules/main_tabs_v2/native/tabs/you/YouScreen.tsx'].default(), host = new you.type(you.props);
  const find = (n, pred) => !n || typeof n !== 'object' ? null : pred(n) ? n : [].concat(n.props?.children ?? []).concat(Array.isArray(n) ? n : []).reduce((a, k) => a || find(k, pred), null);
  const page = find(host.render(), n => n.type?.name === 'YouPage'), tree = new page.type(page.props).render();
  for (const id of ['edit-profile', 'avatar-settings', 'you-nitro', 'you-shop', 'you-quests']) find(tree, n => n.props?.id === id).props.run();
  assert.deepEqual(calls, [['settings', 'PROFILE_CUSTOMIZATION'], ['settings', 'PROFILE_CUSTOMIZATION'], ['settings', 'PREMIUM'], ['shop'], ['quests', 'object']]);
  assert.ok(JSON.stringify(files['modules/chat/native/ChatView.tsx'].default().props.style).includes('backgroundColor'));
  const box = files['modules/chat_input/native/ChatInput.tsx'].default().props.children, tiers = box.props.children.props.children;
  assert.ok(JSON.stringify(box.props.style).includes('"borderRadius":22')); assert.equal(tiers[0].props.children.props.children, 'field');
  const tools = tiers[1].props.children; assert.equal(tools[0].props.children.type, 'Actions'); assert.equal(tools[2].props.children[0].type, 'Right'); assert.equal(tools[3].type, 'Send'); assert.ok(JSON.stringify(tools[0].props.style).includes('"paddingBottom":0')); assert.equal(f.plugin.diagnostics().hooks.NativeComposerLayout, 'two-tier');
  const row = files['modules/channel_list_v2/native/items/TextChannel.tsx'].default({ channel: { id: '5' }, selected: true }), plain = files['modules/channel_list_v2/native/items/TextChannel.tsx'].default({ channel: { id: '6' }, selected: false });
  assert.equal(row.type, 'Pressable'); assert.ok(JSON.stringify(row.props.style).includes('"borderRadius":18'));
  assert.ok(JSON.stringify(row.props.children[0].props.style).includes('backgroundColor')); assert.ok(!JSON.stringify(row.props.style).includes('marginHorizontal":12')); assert.equal(RN_bg(plain), undefined);
  await f.stop();
});
test('app tour visits declared routes, skips risky ones and returns', async () => {
  const f = fixture({ hub: { TableRowGroup: { type: () => null }, TableRow: {} } });
  f.plugin.scanApp(); f.advance(300); for (let i = 0; i < 6; i++) f.advance(900);
  const names = f.navigations.map(n => n.name);
  assert.ok(names.includes('settings')); assert.ok(!names.includes('DISTRA_CUSTOM_PAGE')); assert.equal(names[names.length - 1], 'home'); await f.stop();
});
test('native screens swap only exact screen roots on mapped routes and fail open', async () => {
  const f = fixture({ hub: { TableRowGroup: { type: () => null }, TableRow: {} }, screens: true });
  const create = f.api.common.React.createElement, Screen = function Screen() { return null; };
  const swapped = create(Screen, { route: { name: 'guilds' }, navigation: {} });
  assert.notEqual(swapped.type, Screen); assert.equal(swapped.props.__reimaginedOrig, Screen);
  assert.notEqual(create(Screen, { route: { name: 'guilds' }, navigation: {}, extra: 1 }).type, Screen);
  assert.equal(create(Screen, { route: { name: 'guilds' }, navigation: {}, screen: {} }).type, Screen); assert.match(f.plugin.diagnostics().hooks['Screen:guilds'], /navigator-internal/);
  assert.equal(create(Screen, { route: { name: 'channel' }, navigation: {} }).type, Screen);
  assert.equal(create(Screen, { route: { name: 'guilds' }, navigation: {}, __reimaginedRaw: true }).props.__reimaginedRaw, undefined);
  f.api.storage.nativeScreens = false; assert.equal(create(Screen, { route: { name: 'guilds' }, navigation: {} }).type, Screen); await f.stop();
});
test('blueprint search probe captures search elements', async () => {
  const f = fixture({ hub: { TableRowGroup: () => null, TableRow: () => null }, blueprint: true });
  f.api.common.React.createElement(function SearchBar() { return null; }, { placeholder: 'Search', style: { height: 36 } });
  assert.match(f.plugin.diagnostics().hooks.SearchProbe, /1 samples/); await f.stop();
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
