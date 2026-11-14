const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
function element(type, props, ...children) {
  const next = { ...props };
  if (children.length) next.children = children.length === 1 ? children[0] : children;
  return { type, props: next };
}

function mockClient(initialModule, settings = {}, options = {}) {
  const patches = [];
  const deferred = [];
  const navigation = [];
  const toasts = [];
  const logs = [];
  const icons = ['ChatIcon', 'SettingsIcon', 'StarIcon'];
  // Resolve real React.memo components, rather than wrapping them in callable lazy proxies.
  const memo = name => ({ $typeof: Symbol.for('react.memo'), type: name });
  const design = { TableRowGroup: memo('TableRowGroup'), TableSwitchRow: memo('TableSwitchRow'), TableRow: memo('TableRow') };
  const react = {
    Fragment: Symbol('Fragment'),
    createElement: element,
    useReducer: () => [0, () => {}],
    useEffect: fn => { fn(); },
  };
  let module = initialModule;
  const pluginApi = {
    storage: settings,
    common: {
      React: react,
      ReactNative: { ScrollView: 'ScrollView', View: 'View', Text: 'RNText', Switch: 'Switch', Pressable: 'Pressable' },
      assetsRegistry: { getAssetByID: id => icons[id - 1] ? { name: icons[id - 1] } : undefined },
      tabsNavigationRef: { getRootNavigationRef: () => ({ navigate: to => navigation.push(to) }) },
    },
    metro: {
      byTypeName: name => ({ kind: 'type', name }),
      byFileName: name => ({ kind: 'file', name }),
      waitFor: (filter, callback) => {
        if (module && filter.kind === 'type') callback(module);
        const entry = { filter, callback, active: true };
        deferred.push(entry);
        return () => { entry.active = false; };
      },
      findByTypeName: () => module,
      findByFileName: () => module,
      findByProps: name => name === 'transitionToGuild'
        ? { transitionToGuild: to => navigation.push(to) }
        : name === 'openUserSettings'
          ? { openUserSettings: () => navigation.push('settings') }
          : name === 'TableRowGroup' && !options.noDesign ? design : undefined,
    },
    patcher: {
      instead(method, target, callback) {
        assert.equal(method, 'type');
        patches.push({ method, target, callback });
        return () => {};
      },
    },
    components: {
      Stack: 'Stack', TableRow: 'TableRow', TableRowGroup: 'TableRowGroup',
      TableSwitchRow: 'TableSwitchRow', Text: 'Text',
    },
    logger: { info: x => logs.push(x), warn: x => logs.push('WARN: ' + x) },
    toasts: { showToast: value => toasts.push(value) },
  };
  let result;
  const definePlugin = spec => { result = spec; return spec; };
  const parsed = new Function('definePlugin', 'return (' + code + ');')(definePlugin);
  assert.equal(parsed, result);
  return {
    plugin: parsed, api: pluginApi, patches, navigation, toasts, logs, settings,
    emitNewModule(next) {
      module = next;
      for (const entry of deferred) if (entry.active) entry.callback(next);
    },
  };
}

function notificationComponent() {
  return { type: () => element('Container', { style: { flexDirection: 'row' }, onPress: () => { throw Error('Inherited original container onPress!'); }, testOriginal: true }, element('IconButton', { variant: 'tertiary', size: 'sm' })) };
}
const typeName = node => typeof node?.type === 'object' ? node.type.type : node?.type;
function flatten(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) return node.reduce((all, child) => flatten(child, all), found);
  found.push(node);
  flatten(node.props?.children, found);
  return found;
}

test('evaluates as a Distra-native plugin expression', () => {
  const { plugin } = mockClient(null);
  assert.equal(typeof plugin.start, 'function');
  assert.equal(typeof plugin.stop, 'function');
  assert.equal(typeof plugin.SettingsComponent, 'function');
});

test('patches a loaded YouBar once, preserves Notifications and exposes DM / Settings buttons', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  assert.equal(model.patches.length, 1);
  assert.equal(model.settings.showDMButton, true);
  assert.equal(model.settings.showSettingsButton, true);
  assert.equal(model.settings.showFavoritesButton, true);

  const { target, callback } = model.patches[0];
  const render = callback([{}], target.type);
  const controls = render.props.children;
  assert.equal(controls.length, 4);
  assert.equal(controls[3].type, 'Container');
  assert.deepEqual(controls.slice(0, 3).map(c => c.type), ['Pressable','Pressable','Pressable']);
  assert.deepEqual(controls.slice(0, 3).map(c => c.props.accessibilityLabel), ['Direct Messages','Settings','Favorites']);
  assert.equal(controls[3].props.testOriginal, true);
  controls[0].props.onPress();
  controls[1].props.onPress();
  assert.deepEqual(model.navigation, ['@me', 'settings']);
  model.plugin.stop();
});

test('waits for modules initialized after startup and avoids duplicate patches', () => {
  const model = mockClient(null);
  model.plugin.start(model.api);
  assert.equal(model.patches.length, 0);
  const component = notificationComponent();
  model.emitNewModule(component);
  assert.equal(model.patches.length, 1);
  model.emitNewModule(component);
  assert.equal(model.patches.length, 1);
  model.plugin.stop();
});

test('settings switches immediately affect rendered shortcuts', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  const settingsPage = model.plugin.SettingsComponent();
  const switches = flatten(settingsPage).filter(node => typeName(node) === 'TableSwitchRow');
  assert.equal(switches.length, 4);
  switches.find(x => x.props.label === 'Favorites').props.onValueChange(true);
  switches.find(x => x.props.label === 'Direct Messages').props.onValueChange(false);
  const { target, callback } = model.patches[0];
  const tree = callback([{}], target.type);
  const buttons = flatten(tree).filter(x => x.type === 'Pressable');
  assert.deepEqual(buttons.map(x => x.props.accessibilityLabel).filter(Boolean), ['Settings', 'Favorites']);
  buttons.find(x => x.props.accessibilityLabel === 'Favorites').props.onPress();
  assert.equal(model.navigation.at(-1), '@favorites');
  model.plugin.stop();
});

test('unexpected render tree fails closed, no UI alteration', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  const empty = { type: 'Unknown', props: { children: null } };
  assert.equal(model.patches[0].callback([], () => empty), empty);
  model.plugin.stop();
});

test('all options can be disabled without removing original Notifications', () => {
  const model = mockClient(notificationComponent(), { showDMButton: false, showSettingsButton: false, showFavoritesButton: false, __youbarPortV2Migration: true });
  model.plugin.start(model.api);
  const { target, callback } = model.patches[0];
  const original = target.type();
  const current = callback([{}], target.type);
  assert.equal(current.type, original.type);
  assert.equal(current.props.children.type, 'IconButton');
  assert.equal(current.props.testOriginal, true);
  model.plugin.stop();
});

test('first upgrade enables missing Favorites once, later user preference stays off', () => {
  const old = { showDMButton: true, showSettingsButton: true, showFavoritesButton: false };
  const model = mockClient(notificationComponent(), old);
  model.plugin.start(model.api);
  assert.equal(old.showFavoritesButton, true);
  assert.equal(old.__youbarPortV2Migration, true);
  const page = model.plugin.SettingsComponent();
  const fav = flatten(page).find(x => typeName(x) === 'TableSwitchRow' && x.props.label === 'Favorites');
  assert.ok(fav);
  fav.props.onValueChange(false);
  assert.equal(old.showFavoritesButton, false);
  model.plugin.stop();
  const second = mockClient(notificationComponent(), old);
  second.plugin.start(second.api);
  assert.equal(old.showFavoritesButton, false);
  second.plugin.stop();
});

test('settings resolves memo components without callable lazy wrappers', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  const page = model.plugin.SettingsComponent();
  const rows = flatten(page).filter(x => typeName(x) === 'TableRowGroup');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].type.$$typeof, Symbol.for('react.memo'));
  assert.equal(flatten(page).filter(x => typeName(x) === 'TableSwitchRow').length, 4);
  model.plugin.stop();
});

test('settings uses safe React Native fallback when design components are missing', () => {
  const model = mockClient(notificationComponent(), {}, { noDesign: true });
  model.plugin.start(model.api);
  const page = model.plugin.SettingsComponent();
  const switches = flatten(page).filter(x => x.type === 'Switch');
  assert.equal(switches.length, 4);
  switches.find(x => x.props.accessibilityLabel === 'Settings').props.onValueChange(false);
  assert.equal(model.settings.showSettingsButton, false);
  model.plugin.stop();
});

test('independent 40px Pressables block child hit testing and never reuse original wrapper', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  const { target, callback } = model.patches[0];
  const tree = callback([{}], target.type);
  const buttons = tree.props.children.slice(0, -1);
  for (const button of buttons) {
    assert.equal(button.type, 'Pressable');
    assert.equal(button.props.style.width, 40);
    assert.equal(button.props.style.minWidth, 40);
    assert.equal(button.props.style.height, 40);
    assert.equal(button.props.style.overflow, 'hidden');
    assert.equal(button.props.hitSlop, 0);
    assert.equal(button.props.children.type, 'View');
    assert.equal(button.props.children.props.pointerEvents, 'none');
    assert.equal(button.props.children.props.children.type, 'IconButton');
    assert.equal(typeof button.props.onPress, 'function');
    assert.equal(typeof button.props.children.props.children.props.onPress, 'function');
  }
  assert.ok(tree.props.children.at(-1).props.onPress);
  model.plugin.stop();
});

test('all three shortcuts reach distinct destinations', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  const { target, callback } = model.patches[0];
  const tree = callback([{}], target.type);
  const extra = tree.props.children.slice(0,-1);
  extra.forEach(x => x.props.onPress());
  assert.deepEqual(model.navigation, ['@me','settings','@favorites']);
  model.plugin.stop();
});

test('diagnostic mode identifies actual button hit without navigating', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  const settings = model.plugin.SettingsComponent();
  const toggle = flatten(settings).find(node => typeName(node) === 'TableSwitchRow' && node.props.label === 'Tap diagnostics (no navigation)');
  assert.ok(toggle);
  toggle.props.onValueChange(true);
  const { target, callback } = model.patches[0];
  const buttons = callback([{}], target.type).props.children.slice(0, -1);
  for (const button of buttons) button.props.onPress();
  assert.deepEqual(model.navigation, []);
  assert.deepEqual(model.toasts, [
    'YouBar+ tapped: Direct Messages', 'YouBar+ tapped: Settings', 'YouBar+ tapped: Favorites',
  ]);
  model.plugin.stop();
});

test('each simulated 40px hit box maps to one button (no shared native wrapper)', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  const { target, callback } = model.patches[0];
  const items = callback([{}], target.type).props.children.slice(0, -1);
  const clicks = [20, 60, 100];
  for (const x of clicks) {
    const idx = Math.floor(x / 40);
    assert.equal(x >= idx * 40 && x < idx * 40 + items[idx].props.style.width, true);
    items[idx].props.onPress();
  }
  assert.deepEqual(model.navigation, ['@me', 'settings', '@favorites']);
  model.plugin.stop();
});

test('enabling and disabling tap diagnostics preserves configured shortcuts', () => {
  const settings = { showDMButton: true, showSettingsButton: true, showFavoritesButton: false, __youbarPortV2Migration: true };
  const model = mockClient(notificationComponent(), settings);
  model.plugin.start(model.api);
  assert.equal(settings.diagnostics, false);
  const settingsPage = model.plugin.SettingsComponent();
  const toggle = flatten(settingsPage).find(node => typeName(node) === 'TableSwitchRow' && node.props.label === 'Tap diagnostics (no navigation)');
  toggle.props.onValueChange(true);
  toggle.props.onValueChange(false);
  assert.equal(settings.showFavoritesButton, false);
  assert.equal(settings.diagnostics, false);
  model.plugin.stop();
});
