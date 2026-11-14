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
  const containers = render.props.children;
  assert.equal(containers.length, 4);
  assert.equal(containers[3].type, 'Container');
  const dm = containers[0].props.children;
  const settings = containers[1].props.children;
  const favorites = containers[2].props.children;
  assert.equal(Object.hasOwn(containers[0].props, 'onPress'), false);
  assert.equal(Object.hasOwn(containers[1].props, 'onPress'), false);
  assert.equal(Object.hasOwn(containers[2].props, 'onPress'), false);
  assert.equal(containers[3].props.testOriginal, true);
  assert.equal(dm.props.accessibilityLabel, 'Direct Messages');
  assert.equal(settings.props.accessibilityLabel, 'Settings');
  assert.equal(favorites.props.accessibilityLabel, 'Favorites');
  dm.props.onPress();
  settings.props.onPress();
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
  assert.equal(switches.length, 3);
  switches.find(x => x.props.label === 'Favorites').props.onValueChange(true);
  switches.find(x => x.props.label === 'Direct Messages').props.onValueChange(false);
  const { target, callback } = model.patches[0];
  const tree = callback([{}], target.type);
  const buttons = flatten(tree).filter(x => x.type === 'IconButton');
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
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type.$$typeof, Symbol.for('react.memo'));
  assert.equal(flatten(page).filter(x => typeName(x) === 'TableSwitchRow').length, 3);
  model.plugin.stop();
});

test('settings uses safe React Native fallback when design components are missing', () => {
  const model = mockClient(notificationComponent(), {}, { noDesign: true });
  model.plugin.start(model.api);
  const page = model.plugin.SettingsComponent();
  const switches = flatten(page).filter(x => x.type === 'Switch');
  assert.equal(switches.length, 3);
  switches.find(x => x.props.accessibilityLabel === 'Settings').props.onValueChange(false);
  assert.equal(model.settings.showSettingsButton, false);
  model.plugin.stop();
});

test('new button containers never inherit original pointer handlers', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  const { target, callback } = model.patches[0];
  const tree = callback([{}], target.type);
  for (const container of tree.props.children.slice(0,-1)) {
    assert.deepEqual(Object.keys(container.props).sort(), ['children','key']);
    assert.equal(typeof container.props.children.props.onPress, 'function');
  }
  assert.equal(typeof tree.props.children.at(-1).props.onPress, 'function');
  model.plugin.stop();
});

test('all three shortcuts reach distinct destinations', () => {
  const model = mockClient(notificationComponent());
  model.plugin.start(model.api);
  const { target, callback } = model.patches[0];
  const tree = callback([{}], target.type);
  const extra = tree.props.children.slice(0,-1).map(x => x.props.children);
  extra.forEach(x => x.props.onPress());
  assert.deepEqual(model.navigation, ['@me','settings','@favorites']);
  model.plugin.stop();
});
