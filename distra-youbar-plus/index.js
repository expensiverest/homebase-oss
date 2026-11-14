(() => {
  "use strict";
  // SPDX-License-Identifier: GPL-3.0-only
  // Distra-native port of Purple-EyeZ's Valenced YouBar+.
  // https://github.com/Valenced/valenced-community-plugins/tree/main/plugins/youbar-plus
  // Startup-safe matching is informed by Rosie's archived Revenge YouBar+ fork.

  const DEFAULTS = Object.freeze({
    showDMButton: true,
    showSettingsButton: true,
    showFavoritesButton: true,
  });
  const OPTIONS = [
    { key: "showDMButton", label: "Direct Messages", icon: "ChatIcon", description: "Add a DM shortcut to the You Bar.", dest: "@me" },
    { key: "showSettingsButton", label: "Settings", icon: "SettingsIcon", description: "Open Discord settings directly.", dest: "settings" },
    { key: "showFavoritesButton", label: "Favorites", icon: "StarIcon", description: "Add a Favorites shortcut (if supported by Discord).", dest: "@favorites" },
  ];

  let api = null;
  let patched = false;
  let status = "Not started";
  let unsubscribe = [];
  let iconCache = new Map();
  const listeners = new Set();

  function emit() {
    for (const update of Array.from(listeners)) {
      try { update(); } catch (_) { /* A screen may already have unmounted. */ }
    }
  }
  function setStatus(message) {
    status = message;
    emit();
    if (api && api.logger) api.logger.info(message);
  }
  function enabled(key) {
    const value = api && api.storage && api.storage[key];
    return typeof value === "boolean" ? value : DEFAULTS[key];
  }

  function iconId(name) {
    if (iconCache.has(name)) return iconCache.get(name);
    // Distra's Vendetta compatibility layer has an asset-name resolver that
    // initializes any as-yet unloaded modules. This is important for StarIcon.
    try {
      const resolver = globalThis.vendetta?.ui?.assets?.getAssetIDByName;
      if (typeof resolver === "function") {
        const found = resolver(name);
        if (typeof found === "number") {
          iconCache.set(name, found);
          return found;
        }
      }
    } catch (error) {
      api?.logger?.warn?.(`Asset resolver failed for ${name}: ${String(error)}`);
    }
    const registry = api && api.common && api.common.assetsRegistry;
    if (!registry || typeof registry.getAssetByID !== "function") return undefined;
    // React Native asset IDs are 1-based, contiguous and assigned as image modules load.
    for (let id = 1; id < 40000; id++) {
      const asset = registry.getAssetByID(id);
      if (!asset) break;
      if (asset.name === name) {
        iconCache.set(name, id);
        return id;
      }
    }
    return undefined;
  }

  function navigate(destination) {
    if (!api) return;
    try {
      if (destination === "settings") {
        // Match the current Valenced plugin: the root settings route is the
        // stable path on Discord's main_tabs_v2 navigation stack.
        const ref = api.common.tabsNavigationRef?.getRootNavigationRef?.();
        if (typeof ref?.navigate === "function") {
          ref.navigate("settings");
          api.logger?.info?.("Settings button: root navigate(settings)");
          return;
        }
        const actions = api.metro.findByProps("openUserSettings");
        if (typeof actions?.openUserSettings === "function") {
          actions.openUserSettings();
          api.logger?.info?.("Settings button: openUserSettings()");
          return;
        }
      } else {
        const transition = api.metro.findByProps("transitionToGuild");
        if (typeof transition?.transitionToGuild === "function") {
          transition.transitionToGuild(destination);
          api.logger?.info?.(`Navigation button: transitionToGuild(${destination})`);
          return;
        }
      }
      throw new Error(`No navigation method for ${destination}`);
    } catch (error) {
      api.logger?.warn?.(`Could not open ${destination}: ${String(error)}`);
      api.toasts?.showToast?.(`YouBar+: ${destination} navigation unavailable`);
    }
  }

  /** Called by Distra's patcher inside the real React component render. */
  function addButtons(args, original) {
    const React = api.common.React;
    const [, invalidate] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => {
      listeners.add(invalidate);
      return () => { listeners.delete(invalidate); };
    }, [invalidate]);

    const output = original(...args);
    const child = output?.props?.children;
    // Discord has changed this tree across versions. If it no longer matches,
    // leave the entire original Notifications button untouched.
    if (!output || !child || Array.isArray(child) || !child.type || !output.type) return output;

    const IconButton = child.type;
    const Container = output.type;
    const originalProps = child.props ?? {};
    const extraButtons = [];
    for (const option of OPTIONS) {
      if (!enabled(option.key)) continue;
      const asset = iconId(option.icon);
      if (asset === undefined) continue;
      const icon = React.createElement(IconButton, {
        key: `distra-youbar-icon-${option.key}`,
        accessibilityLabel: option.label,
        accessibilityRole: "button",
        variant: originalProps.variant ?? "tertiary",
        size: originalProps.size ?? "sm",
        icon: asset,
        onPress: () => navigate(option.dest),
      });
      // The original container may have its own onPress, navigation state, or
      // pointer handlers. Copying those props made every injected button behave
      // like the original (e.g. opening Favorites) instead of its own shortcut.
      // Like the Valenced source, render a FRESH container with only our child.
      const wrapper = React.createElement(Container, {
        key: `distra-youbar-wrapper-${option.key}`,
      }, icon);
      extraButtons.push(wrapper);
    }
    return extraButtons.length ? React.createElement(React.Fragment, null, ...extraButtons, output) : output;
  }

  function patchCandidate(component) {
    if (!api || patched || !component) return false;
    const variants = [component, component.default, component.Result];
    let target, method;
    for (const part of variants) {
      if (typeof part?.type === "function") { target = part; method = "type"; break; }
      if (typeof part?.render === "function") { target = part; method = "render"; break; }
    }
    if (!target) return false;
    try {
      api.patcher.instead(method, target, addButtons);
      patched = true;
      setStatus("Patched. Restart Discord if the buttons aren't visible yet.");
      return true;
    } catch (error) {
      setStatus(`Patch failed: ${String(error)}`);
      api.logger?.warn?.(`Couldn't patch YouBarNotificationsButton: ${String(error)}`);
      return false;
    }
  }

  function tryPatch() {
    if (!api || patched) return patched;
    try {
      const { metro } = api;
      if (patchCandidate(metro.findByTypeName("YouBarNotificationsButton"))) return true;
      if (patchCandidate(metro.findByFileName("YouBarNotificationsButton"))) return true;
    } catch (error) {
      setStatus(`Lookup failed: ${String(error)}`);
      return false;
    }
    setStatus("Waiting for Discord's You Bar component. Try reloading Discord.");
    return false;
  }

  function SettingsComponent() {
    if (!api) return null;
    const React = api.common.React;
    const RN = api.common.ReactNative;
    const [, invalidate] = React.useReducer(n => n + 1, 0);
    React.useEffect(() => {
      listeners.add(invalidate);
      return () => { listeners.delete(invalidate); };
    }, [invalidate]);

    // IMPORTANT: api.components.* are Distra lazy PROXIES. Some Discord design
    // components are memo/forwardRef OBJECTS, not functions. React treats the
    // proxy as callable, then its apply trap throws "target is not callable".
    // Resolve the actual Discord component types from Metro before rendering.
    const design = api.metro.findByProps("TableRowGroup", "TableSwitchRow");
    const note = "The new buttons appear after a Discord restart. Only enable one YouBar+ plugin at a time. Favorites requires support from your current Discord build.";
    const inset = { paddingHorizontal: 12, paddingVertical: 24, paddingBottom: 48 };

    if (design?.TableRowGroup && design?.TableSwitchRow) {
      const retry = design.TableRow
        ? React.createElement(design.TableRow, {
          label: "Retry patch",
          subLabel: status,
          onPress: tryPatch,
        })
        : React.createElement(RN.Pressable, { onPress: tryPatch, style: { paddingVertical: 14 } },
            React.createElement(RN.Text, null, `Retry patch - ${status}`));
      return React.createElement(RN.ScrollView, { contentContainerStyle: inset },
        React.createElement(design.TableRowGroup, { title: "You Bar shortcuts" },
          ...OPTIONS.map(option => React.createElement(design.TableSwitchRow, {
            key: option.key,
            label: option.label,
            subLabel: option.description,
            value: enabled(option.key),
            onValueChange: value => { api.storage[option.key] = !!value; emit(); },
          })),
        ),
        React.createElement(design.TableRowGroup, { title: "Compatibility" }, retry),
        React.createElement(RN.Text, { style: { paddingHorizontal: 10, marginTop: 18, opacity: 0.7, fontSize: 12, lineHeight: 18 } }, note),
      );
    }

    // Safe fallback if Discord's current design-system module cannot be found.
    return React.createElement(RN.ScrollView, { contentContainerStyle: inset },
      React.createElement(RN.Text, { style: { fontSize: 20, fontWeight: "bold", marginBottom: 16 } }, "You Bar shortcuts"),
      ...OPTIONS.map(option => React.createElement(RN.View, {
        key: option.key,
        style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 },
      },
        React.createElement(RN.View, { style: { flexShrink: 1, paddingRight: 12 } },
          React.createElement(RN.Text, { style: { fontWeight: "600", fontSize: 16 } }, option.label),
          React.createElement(RN.Text, { style: { opacity: 0.7, fontSize: 12 } }, option.description),
        ),
        React.createElement(RN.Switch, { accessibilityLabel: option.label, value: enabled(option.key),
          onValueChange: value => { api.storage[option.key] = !!value; emit(); } }),
      )),
      React.createElement(RN.Pressable, { onPress: tryPatch, style: { marginTop: 16, paddingVertical: 14 } },
        React.createElement(RN.Text, null, `Retry patch - ${status}`)),
      React.createElement(RN.Text, { style: { marginTop: 18, opacity: 0.7, fontSize: 12 } }, note),
    );
  }

  return definePlugin({
    start(pluginApi) {
      api = pluginApi;
      patched = false;
      iconCache = new Map();
      unsubscribe = [];
      for (const [key, initial] of Object.entries(DEFAULTS)) {
        if (typeof api.storage[key] !== "boolean") api.storage[key] = initial;
      }
      // v0.1.0 accidentally defaulted Favorites to off AND broke its settings
      // screen, so prior users could never enable it. Enable once on migration.
      if (api.storage.__youbarPortV2Migration !== true) {
        api.storage.showFavoritesButton = true;
        api.storage.__youbarPortV2Migration = true;
      }
      setStatus("Looking for Discord's You Bar component...");

      // waitFor observes already-initialized Metro modules AND modules loaded later.
      // This solves the original YouBar+ startup race without a polling timer.
      const { metro } = api;
      try {
        for (const filter of [metro.byTypeName("YouBarNotificationsButton"), metro.byFileName("YouBarNotificationsButton")]) {
          unsubscribe.push(metro.waitFor(filter, patchCandidate));
        }
      } catch (error) {
        api.logger?.warn?.(`Couldn't watch for the You Bar: ${String(error)}`);
      }
      if (!patched) tryPatch();
    },
    stop() {
      for (const cancel of unsubscribe) { try { cancel(); } catch (_) { /* ignore */ } }
      unsubscribe = [];
      patched = false;
      status = "Stopped";
      listeners.clear();
      api = null;
      // Distra's loader automatically removes the patch registered via api.patcher.
    },
    SettingsComponent,
  });
})()

