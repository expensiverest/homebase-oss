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

function mockClient(initialModule, settings = {}) {
  const patches = [];
  const deferred = [];
  const navigation = [];
  const toasts = [];
  const logs = [];
  const icons = ['ChatIcon', 'SettingsIcon', 'StarIcon'];
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
      ReactNative: { ScrollView: 'ScrollView' },
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
          ? { openUserSettings: () => navigation.push('settings') } : undefined,
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
  return { type: () => element('Container', { style: { flexDirection: 'row' } }, element('IconButton', { variant: 'tertiary', size: 'sm' })) };
}
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
  assert.equal(model.settings.showFavoritesButton, false);

  const { target, callback } = model.patches[0];
  const render = callback([{}], target.type);
  const containers = render.props.children;
  assert.equal(containers.length, 3);
  assert.equal(containers[2].type, 'Container');
  const dm = containers[0].props.children;
  const settings = containers[1].props.children;
  assert.equal(dm.props.accessibilityLabel, 'Direct Messages');
  assert.equal(settings.props.accessibilityLabel, 'Settings');
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
  const switches = flatten(settingsPage).filter(node => node.type === 'TableSwitchRow');
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
  const model = mockClient(notificationComponent(), { showDMButton: false, showSettingsButton: false, showFavoritesButton: false });
  model.plugin.start(model.api);
  const { target, callback } = model.patches[0];
  const original = target.type();
  assert.deepEqual(callback([{}], target.type), original);
  model.plugin.stop();
});
