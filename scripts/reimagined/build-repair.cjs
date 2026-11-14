'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPresenter } = require('./presenter.cjs');
const root = path.resolve(__dirname, '../..');
const base = path.join(root, 'discord-reimagined');
const out = path.join(root, 'discord-reimagined-preview');
let code = fs.readFileSync(path.join(base, 'next.js'), 'utf8');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
if (digest(code) !== 'e508378660675a0659af7cc1276491ca7588aea7f3245a1da2c11536c75a9451') throw new Error('Baseline differs from the withdrawn 0.2.0 source; reconcile before patching.');
function swap(old, replacement) {
  if (!code.includes(old) || code.indexOf(old) !== code.lastIndexOf(old)) throw new Error('Missing or ambiguous anchor: ' + old.slice(0, 100));
  code = code.replace(old, () => replacement);
}
function region(first, last, replacement) {
  const a = code.indexOf(first), b = code.indexOf(last, a + first.length);
  if (a < 0 || b < 0) throw new Error('Missing region: ' + first);
  code = code.slice(0, a) + replacement + code.slice(b);
}
code = code.replaceAll('0.2.0-alpha.1', '0.2.0-alpha.4');
swap('  let api, React, RN, h, Control, Scene, DockHost, Boundary, Page;', `  let api, React, RN, h, Control, Scene, DockHost, Boundary, Page;
  let presenter = null, modalOwner = null, activeSceneNavigation = null, presentationInstance = "";
  const presentationHosts = new Set();
  const makePresenter = ${createPresenter.toString()};`);
swap('    if (id !== accountId) { accountId = id;', '    if (id !== accountId) { if (presenter) presenter.dismiss(null, true); accountId = id;');
swap('screen: state.screen }; }', 'screen: state.screen, presentation: presenter ? presenter.snapshot() : null }; }');
region('  function nativeConversation(id) {', '  function push(next) {', `  function routeState(nav) { return safe(() => nav.getRootState?.() || nav.getState?.(), null); }
  function declaredPath(nav) {
    function visit(s, prefix, depth) {
      if (!s || depth > 8) return null;
      if (Array.isArray(s.routeNames) && s.routeNames.includes("DISTRA_CUSTOM_PAGE")) return prefix.concat("DISTRA_CUSTOM_PAGE");
      for (const r of s.routes || []) { const found = visit(r.state, prefix.concat(r.name), depth + 1); if (found) return found; }
      return null;
    }
    return visit(routeState(nav), [], 0);
  }
  function isOurRoute(id) {
    const nav = activeSceneNavigation;
    if (nav && typeof nav.isFocused === "function") {
      const s = safe(() => nav.getState(), null), r = s?.routes?.[s.index ?? 0];
      if (r?.params?.reimaginedTicket === id && r.params.reimaginedInstance === presentationInstance) return nav.isFocused() === true;
    }
    const r = root(); let focused = safe(() => r.getCurrentRoute?.(), null);
    if (!focused) { let s = routeState(r); for (let d = 0; s && d < 10; d++) { focused = s.routes?.[s.index ?? 0]; s = focused?.state; } }
    return focused?.name === "DISTRA_CUSTOM_PAGE" && focused.params?.reimaginedTicket === id && focused.params?.reimaginedInstance === presentationInstance;
  }
  function leaveOwnRoute(id) {
    // Never blindly pop whatever sheet happens to be on top.
    if (!isOurRoute(id)) return;
    const nav = activeSceneNavigation || root();
    if (safe(() => nav.canGoBack(), false)) safe(() => nav.goBack());
  }
  function routePage(id) {
    return function ReimaginedRoutePage() {
      const n = safe(() => unwrap(api.common.NavigationNative), null);
      const navigation = typeof n?.useNavigation === "function" ? n.useNavigation() : null;
      return h(Scene, { presentation: "route", ticket: id, navigation });
    };
  }
  function initPresentation() {
    presenter = makePresenter({
      root, changed: emit, issue,
      canModal: () => !!RN.Modal && presentationHosts.size > 0,
      focused: isOurRoute, routePath: declaredPath, leaveRoute: leaveOwnRoute,
      navigate(nav, path, id) {
        let params = { title: "Discord", headerShown: false, gestureEnabled: false, render: routePage(id), reimaginedTicket: id, reimaginedInstance: presentationInstance };
        for (let i = path.length - 1; i > 0; i--) params = { screen: path[i], params };
        nav.navigate(path[0], params);
      }
    });
  }
  function restoreOriginal() {
    api.storage.layout = false;
    autoPresented = true;
    presenter?.dismiss(null, true); emit();
  }
  function nativeConversation(id) {
    const c = channel(id); if (!permission("VIEW_CHANNEL", c)) return toast("You cannot open this channel.");
    presenter.dismiss(() => {
      if (!live) return;
      try {
        if (isPrivate(c)) { const a = mod("selectPrivateChannel"); if (!a?.selectPrivateChannel) throw new Error("Unavailable"); a.selectPrivateChannel(id); }
        else { const a = mod("transitionToGuild"); if (!a?.transitionToGuild) throw new Error("Unavailable"); a.transitionToGuild(c.guild_id, id); }
      } catch (_) { toast("Use Discord's original navigation to open this conversation."); }
    }, true);
  }
  function nativeSettings(profile) {
    const invoke = () => {
      if (!live) return;
      try {
        const r = root();
        if (profile) {
          const config = mod("SETTING_RENDERER_CONFIG")?.SETTING_RENDERER_CONFIG;
          const found = Object.entries(config || {}).filter(([key, value]) => /^(USER_PROFILE|PROFILE_CUSTOMIZATION|EDIT_PROFILE)$/i.test(key) && value?.screen?.route);
          if (found.length === 1 && r?.navigate) { r.navigate(found[0][1].screen.route); return; }
        }
        const action = mod("openUserSettings");
        if (typeof action?.openUserSettings === "function") action.openUserSettings();
        else if (typeof r?.navigate === "function" && !(typeof r.isReady === "function" && !r.isReady())) r.navigate("settings");
        else throw new Error("settings-unavailable");
        health.capabilities.settingsSheet = "requested; not device-verified";
      } catch (_) { issue("settings-open-failed"); toast("Use Restore Discord, then open Settings from the original bar."); }
    };
    const mode = presenter.snapshot().mode;
    if (mode === "modal" || mode === "modal-opening") presenter.dismiss(invoke, false);
    else invoke();
  }
  function present(tab) {
    if (!live || !me()) return;
    if (tab) state = { ...state, tab, screen: "main", guild: null, channel: null, search: "", history: [], menu: null };
    presenter.open(); emit();
  }
`);
swap('else if (action === "close") { const r = root(); if (r?.canGoBack?.()) r.goBack(); }', 'else if (action === "close") { presenter.dismiss(null, true); }\n    else if (action === "restore") restoreOriginal();');
swap('else if (action === "setting") { api.storage[value.key] = value.value; if (["palette", "nativePalette"].includes(value.key)) syncTheme(); emit(); }', 'else if (action === "setting") { api.storage[value.key] = value.value; if (value.key === "layout" && !value.value) presenter.dismiss(null, true); if (["palette", "nativePalette"].includes(value.key)) syncTheme(); emit(); }');
swap('button("Copy compatibility report", "report", null, { marginTop: SPACE.md })) : this.props.children;', 'button("Copy compatibility report", "report", null, { marginTop: SPACE.md }), button("Restore Discord", "restore", null, { marginTop: SPACE.md }, "render-error-restore")) : this.props.children;');
swap('componentDidMount() { sceneCount++; routeOpening = false; listeners.add(this.refresh);', 'componentDidMount() { sceneCount++; routeOpening = false; if (this.props.presentation === "route") { activeSceneNavigation = this.props.navigation; this.focusOff = safe(() => this.props.navigation?.addListener?.("focus", () => this.ackRoute()), null); } listeners.add(this.refresh);');
swap('componentWillUnmount() { sceneCount = Math.max(0, sceneCount - 1); listeners.delete(this.refresh); this.dimensions?.remove?.(); }', 'componentWillUnmount() { sceneCount = Math.max(0, sceneCount - 1); listeners.delete(this.refresh); this.dimensions?.remove?.(); if (typeof this.focusOff === "function") this.focusOff(); else this.focusOff?.remove?.(); if (this.props.presentation === "route") presenter?.routeUnmounted(this.props.ticket); }');
swap('      render() { if (!live) return h(RN.View, { style: { flex: 1, padding: SPACE.xl } }, t("Reimagined is disabled."), h(RN.Pressable || RN.TouchableOpacity, { onPress: () => safe(() => root().goBack()), style: { padding: SPACE.lg } }, t("Back to Discord")));', `      ackRoute() { const f = this.routeFrame; if (this.props.presentation === "route" && f) presenter.routeReady(this.props.ticket, isOurRoute(this.props.ticket), f.width, f.height); }
      render() { if (!live || (this.props.presentation === "route" && !presenter.acceptsRoute(this.props.ticket))) return h(RN.View, { style: { flex: 1, padding: SPACE.xl } }, t("Return to Discord"), h(RN.Pressable || RN.TouchableOpacity, { onPress: () => leaveOwnRoute(this.props.ticket), style: { padding: SPACE.lg } }, t("Back to Discord")));`);
swap('return h(Safe, { testID: "reimagined-scene", style: { flex: 1, backgroundColor: colors().bg } },', `return h(Safe, { testID: "reimagined-scene", onLayout: event => { this.routeFrame = event?.nativeEvent?.layout; this.ackRoute(); }, style: { flex: 1, backgroundColor: colors().bg } },`);
swap('content), state.screen === "main" || state.screen === "channels" ? h(Dock) : null, state.drawer ?', 'content), h(Control, { id: "restore-discord", label: "Restore Discord", action: "restore", style: { minHeight: 44, alignSelf: "center", paddingHorizontal: SPACE.md } }, t("Restore Discord", { fontSize: TYPE.small, color: colors().muted })), state.screen === "main" || state.screen === "channels" ? h(Dock) : null, state.drawer ?');
region('    DockHost = class extends React.Component {', '    // Plugin settings remain a small entry point;', `    DockHost = class extends React.Component {
      constructor(p) { super(p); this.state = { tick: 0 }; this.refresh = () => this.setState(s => ({ tick: s.tick + 1 })); }
      componentDidMount() {
        presentationHosts.add(this); if (!modalOwner) modalOwner = this;
        listeners.add(this.refresh);
        if (this.props.mode !== "settings" && cfg("layout") && cfg("startHome") && !autoPresented && me()) {
          autoPresented = true; this.timer = setTimeout(() => { if (live) present("home"); }, 150);
        }
      }
      componentWillUnmount() {
        clearTimeout(this.timer); listeners.delete(this.refresh); presentationHosts.delete(this);
        if (modalOwner === this) modalOwner = presentationHosts.values().next().value || null;
        presenter?.hostLost(); Promise.resolve().then(emit);
      }
      render() {
        if (!live) return this.props.original || null;
        const p = presenter.snapshot();
        // Original navigation remains intact; the custom dock belongs inside Scene.
        const launch = this.props.mode !== "settings" && cfg("layout") && me()
          ? button("Reimagined", null, null, { marginHorizontal: SPACE.lg }, "reimagined-launcher", () => present()) : null;
        return h(React.Fragment, null, this.props.original, launch,
          RN.Modal ? h(RN.Modal, { visible: p.modal && modalOwner === this,
            presentationStyle: "fullScreen", animationType: "none",
            onShow: () => presenter.modalShown(p.ticket),
            onRequestClose: () => presenter.dismiss(null, false),
            onDismiss: () => presenter.modalDismissed(p.ticket) },
            h(Boundary, null, h(Scene, { presentation: "modal", ticket: p.ticket }))) : null);
      }
    };
`);
swap('checkAccount(); buildUI();', 'checkAccount(); buildUI(); initPresentation();');
swap('api = pluginApi; live = true; epoch++; accountId = null;', 'api = pluginApi; live = true; epoch++; presenter = null; modalOwner = null; activeSceneNavigation = null; presentationInstance = Date.now().toString(36) + Math.random().toString(36).slice(2); presentationHosts.clear(); accountId = null;');
swap('async function stop() { live = false; epoch++;', 'async function stop() { presenter?.stop(); live = false; epoch++;');
swap('SettingsComponent: () => live && buildUI.Settings ? h(buildUI.Settings) : null', 'SettingsComponent: () => live && buildUI.Settings ? h(DockHost, { mode: "settings", original: h(buildUI.Settings) }) : null');
// Design pass: a Discord-recognizable palette, quieter navigation and visible mention counts.
swap('    midnight: { name: "Midnight"', `    blurple: { name: "Blurple", bg: "#17181f", surface: "#20222b", elevated: "#2b2d38", line: "#3a3d4b", ink: "#f2f3f8", muted: "#b0b4c4", faint: "#9296a9", accent: "#b4bcff", accentInk: "#1d2160", accentSoft: "#30346a", danger: "#f5a9b3", clear: "transparent", shade: "rgba(8,9,14,0.62)" },
    midnight: { name: "Midnight"`);
swap('const DEFAULTS = { palette: "midnight"', 'const DEFAULTS = { palette: "blurple"');
swap('  const unread = id => !!call(stores.ReadStateStore, "hasUnread", [id], false);', `  const unread = id => !!call(stores.ReadStateStore, "hasUnread", [id], false);
  const mentionCount = id => Math.max(0, Number(call(stores.ReadStateStore, "getMentionCount", [id], 0)) || 0);`);
swap('unread: unread(c.id), preview: cfg("showPreviews")', 'unread: unread(c.id), mentions: mentionCount(c.id), preview: cfg("showPreviews")');
swap('    function DmRow(p) {', `    function Badge(p) {
      const c = colors(), n = p.count;
      if (!n && !p.dot) return null;
      return h(RN.View, { accessible: false, style: n ? { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: RAD.round, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", marginLeft: SPACE.sm } : { width: 8, height: 8, borderRadius: RAD.round, backgroundColor: c.accent, marginLeft: SPACE.sm } },
        n ? t(n > 99 ? "99+" : String(n), { fontSize: 11, lineHeight: 14, fontWeight: "700", color: c.accentInk }, { accessible: false }) : null);
    }
    function DmRow(p) {`);
swap('d.unread ? h(RN.View, { style: { width: 7, height: 7, borderRadius: RAD.round, backgroundColor: colors().accent } }) : null', 'h(Badge, { count: d.mentions, dot: d.unread })');
swap('t(d.preview, { color: colors().muted,', 't(d.preview, { color: d.unread ? colors().ink : colors().muted,');
region('    function Dock() {', '    Boundary = class', `    function Dock() {
      const c = colors(), total = listDms().reduce((sum, d) => sum + d.mentions, 0);
      return h(RN.View, { testID: "reimagined-dock", style: { width: "100%", paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm, backgroundColor: c.bg } }, h(RN.View, { style: { flexDirection: "row", alignItems: "center", padding: SPACE.xs, borderRadius: RAD.round, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line } },
        ...NAV.map(n => {
          const on = state.tab === n.id && state.screen === "main";
          return h(Control, { key: n.id, id: "tab-" + n.id, label: n.label, role: "tab", action: "tab", value: n.id, selected: on, measure: true, longPress: n.id === "servers" ? () => send("drawer") : undefined,
            style: { flex: on ? 1.7 : 1, minWidth: 0, minHeight: 50, flexDirection: "row", borderRadius: RAD.round, backgroundColor: on ? c.accentSoft : c.clear } },
            h(Icon, { name: n.icon, color: on ? c.accent : c.muted, size: 22 }),
            on ? t(n.label, { fontSize: TYPE.caption, lineHeight: 18, fontWeight: "600", color: c.accent, marginLeft: SPACE.sm, flexShrink: 1 }, { numberOfLines: 1, accessible: false }) : null,
            n.id === "messages" && total ? h(RN.View, { accessible: false, style: { position: "absolute", top: 6, right: on ? 10 : "22%", minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: RAD.round, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" } }, t(total > 99 ? "99+" : String(total), { fontSize: 10, lineHeight: 13, fontWeight: "700", color: c.accentInk }, { accessible: false })) : null);
        })));
    }
`);
// Motion: spring press feedback, animated page entrance and animated dock changes. All guarded for hosts without Animated.
swap('  const NAV = [', '  const animated = () => !!RN.Animated && !cfg("reduceMotion");\n  const NAV = [');
swap('constructor(p) { super(p); this.state = { pressed: false }; this.press = this.press.bind(this); }', 'constructor(p) { super(p); this.state = { pressed: false }; this.press = this.press.bind(this); this.scale = RN.Animated ? new RN.Animated.Value(1) : null; }\n      spring(to) { if (this.scale && !cfg("reduceMotion")) safe(() => RN.Animated.spring(this.scale, { toValue: to, speed: 40, bounciness: 6, useNativeDriver: true }).start()); }');
swap('onPressIn: () => this.setState({ pressed: true }), onPressOut: () => this.setState({ pressed: false }),', 'onPressIn: () => { this.spring(0.95); this.setState({ pressed: true }); }, onPressOut: () => { this.spring(1); this.setState({ pressed: false }); },');
swap('render() { const p = this.props; return h(RN.Pressable || RN.TouchableOpacity, {', 'render() { const p = this.props; return h(RN.Animated && RN.Pressable ? (Control.animatedPressable || (Control.animatedPressable = RN.Animated.createAnimatedComponent(RN.Pressable))) : (RN.Pressable || RN.TouchableOpacity), {');
swap('opacity: p.disabled ? 0.4 : this.state.pressed ? 0.65 : 1 }, p.style] }, p.children); }', 'opacity: p.disabled ? 0.4 : this.state.pressed ? 0.8 : 1, ...(this.scale && RN.Pressable ? { transform: [{ scale: this.scale }] } : null) }, p.style] }, p.children); }');
swap('h(Header, { title: p.title, back: p.back, right: p.right }), h(RN.View, { style: { paddingHorizontal: SPACE.xl, width: "100%", maxWidth: 820, alignSelf: "center" } }, p.children)); }', 'h(Header, { title: p.title, back: p.back, right: p.right }), h(RN.Animated && this.enter ? RN.Animated.View : RN.View, { style: [{ paddingHorizontal: SPACE.xl, width: "100%", maxWidth: 820, alignSelf: "center" }, this.enter ? { opacity: this.enter, transform: [{ translateY: this.enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] } : null] }, p.children)); }');
swap('    Page = class extends React.Component {\n', '    Page = class extends React.Component {\n      constructor(p) { super(p); this.enter = animated() ? new RN.Animated.Value(0) : null; }\n      componentDidMount() { if (this.enter) safe(() => RN.Animated.timing(this.enter, { toValue: 1, duration: 280, easing: RN.Easing?.out?.(RN.Easing.cubic), useNativeDriver: true }).start()); }\n');
swap('if (action === "tab") { if (!NAV.some(n => n.id === value)) return;', 'if (action === "tab") { if (!NAV.some(n => n.id === value)) return; if (animated()) safe(() => RN.LayoutAnimation.configureNext(RN.LayoutAnimation.Presets.easeInEaseOut));');
// Recovery: Restore Discord must always leave a way back to the redesign.
swap('const launch = this.props.mode !== "settings" && cfg("layout") && me()\n          ? button("Reimagined", null, null, { marginHorizontal: SPACE.lg }, "reimagined-launcher", () => present()) : null;', `const launch = this.props.mode === "settings" || !me() ? null
          : cfg("layout") ? button("Reimagined", null, null, { marginHorizontal: SPACE.lg }, "reimagined-launcher", () => present())
          : button("Return to Reimagined", null, null, { marginHorizontal: SPACE.lg, backgroundColor: colors().accentSoft }, "reimagined-return", () => { api.storage.layout = true; present(); });`);
// Layout: a Home glance (greeting, unread summary, jump-back-in row), a Mentions filter, and no dead end for forum channels.
swap('    function Home(p) {', `    function HomeGlance() {
      const c = colors(), hour = new Date().getHours(), name = userName(me()).split(/\\s+/)[0];
      const ds = listDms(), unreadCount = ds.filter(d => d.unread).length, mentionTotal = ds.reduce((n, d) => n + d.mentions, 0);
      const recent = account().recent.map(r => { const ch = channel(r.id), dm = ds.find(d => d.id === r.id); return ch ? { id: r.id, name: dm?.name || ch.name || "Channel", user: dm?.user, dm: !!dm } : null; }).filter(Boolean).slice(0, 8);
      const summary = mentionTotal ? mentionTotal + (mentionTotal === 1 ? " mention" : " mentions") : unreadCount ? unreadCount + " unread" : "All caught up";
      return h(RN.View, { style: { marginBottom: SPACE.lg } },
        h(RN.View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACE.lg } },
          h(RN.View, { style: { flex: 1, minWidth: 0 } }, t((hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening") + (name && name !== "Unknown" ? ", " + name : ""), { fontSize: TYPE.title, lineHeight: 26, fontWeight: "600", letterSpacing: -0.3 }, { numberOfLines: 1 })),
          mentionTotal || unreadCount ? h(Control, { id: "glance-unread", label: summary, run: () => { send("tab", "messages"); send("filter", mentionTotal ? "mentions" : "unread"); }, style: { flexDirection: "row", borderRadius: RAD.round, paddingHorizontal: SPACE.md, backgroundColor: c.accentSoft } }, t(summary, { fontSize: TYPE.small, fontWeight: "600", color: c.accent })) : t(summary, { fontSize: TYPE.small, color: c.muted })),
        recent.length ? h(RN.ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false, keyboardShouldPersistTaps: "handled", testID: "jump-back-in" }, ...recent.map(r => h(Control, { key: r.id, id: "recent:" + r.id, label: r.name, action: "channel", value: r.id, style: { flexDirection: "row", marginRight: SPACE.sm, paddingLeft: SPACE.sm, paddingRight: SPACE.md, borderRadius: RAD.round, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line } }, r.dm ? h(Avatar, { name: r.name, uri: imageUrl(r.user, "user"), size: 28 }) : h(Icon, { name: "HashIcon", size: 18, color: c.faint }), t(r.name, { marginLeft: SPACE.sm, fontSize: TYPE.caption, maxWidth: 140 }, { numberOfLines: 1 })))) : null);
    }
    function Home(p) {`);
swap('return h(Page, { title: "Home" },\n      h(Search, { placeholder: "Search" }),', 'return h(Page, { title: "Home" }, h(HomeGlance),\n      h(Search, { placeholder: "Search" }),');
swap('{ id: "unread", name: "Unread" }, { id: "pinned", name: "Pinned" }]', '{ id: "unread", name: "Unread" }, { id: "mentions", name: "Mentions" }, { id: "pinned", name: "Pinned" }]');
swap('(state.filter !== "unread" || d.unread) &&', '(state.filter !== "unread" || d.unread) && (state.filter !== "mentions" || d.mentions > 0) &&');
swap('toast("Forum and media-channel layouts are not replaced in this build."); return;', 'toast("Opening this forum in Discord. Use Return to Reimagined to come back."); nativeConversation(id); return;');
// Seamless return: after handing off to a native screen, reopen Reimagined once the user is back on the route they started from.
swap('  function nativeConversation(id) {', `  let baseRoute = null, returnTimer = null;
  const customRouteName = "DISTRA_CUSTOM_PAGE";
  const currentRouteName = () => safe(() => { const r = root(); return (r.getCurrentRoute?.() || null)?.name || null; }, null);
  function stopReturnWatch() { if (returnTimer !== null) clearTimeout(returnTimer); returnTimer = null; }
  function watchReturn() {
    stopReturnWatch();
    if (!baseRoute || !cfg("layout")) return;
    let away = false; const armedAt = Date.now();
    const tick = () => {
      returnTimer = null; if (!live || !cfg("layout")) return;
      const name = currentRouteName();
      if (name && name !== customRouteName && name !== baseRoute) away = true;
      else if (away && name === baseRoute) { returnTimer = setTimeout(() => { returnTimer = null; if (live && cfg("layout")) present(); }, 250); return; }
      // Give up if the handoff never left the starting route.
      if (!away && Date.now() - armedAt > 20000) return;
      returnTimer = setTimeout(tick, 350);
    };
    returnTimer = setTimeout(tick, 350);
  }
  function nativeConversation(id) {`);
swap('    presenter.dismiss(() => {\n      if (!live) return;\n      try {\n        if (isPrivate(c))', '    presenter.dismiss(() => {\n      if (!live) return;\n      watchReturn();\n      try {\n        if (isPrivate(c))');
swap('    const invoke = () => {\n      if (!live) return;\n      try {\n        const r = root();', '    const invoke = () => {\n      if (!live) return;\n      if (!(presenter.snapshot().mode === "route")) watchReturn();\n      try {\n        const r = root();');
swap('  function present(tab) {\n    if (!live || !me()) return;', '  function present(tab) {\n    if (!live || !me()) return;\n    stopReturnWatch(); { const n = currentRouteName(); if (n && n !== customRouteName) baseRoute = n; }');
swap('  function restoreOriginal() {\n    api.storage.layout = false;', '  function restoreOriginal() {\n    stopReturnWatch(); api.storage.layout = false;');
swap('async function stop() { presenter?.stop();', 'async function stop() { stopReturnWatch(); presenter?.stop();');
// Native skin (beta): restyle Discord's own settings lists in place by patching the design-system TableRowGroup. Off by default; any failure turns it off.
swap('showPreviews: true, grid: true, accounts: {} };', 'showPreviews: true, grid: true, nativeSkin: false, accounts: {} };');
swap('h(Toggle, { name: "layout", label: "Navigation dock" }),', 'h(Toggle, { name: "layout", label: "Navigation dock" }), h(Toggle, { name: "nativeSkin", label: "Restyle Discord settings (beta)" }),');
swap('if (["palette", "nativePalette"].includes(value.key)) syncTheme();', 'if (["palette", "nativePalette"].includes(value.key)) syncTheme(); if (value.key === "nativeSkin") patchNativeSkin();');
swap('    Boundary = class extends React.Component {', `    SkinFrame = class extends React.Component {
      constructor(p) { super(p); this.state = { failed: false }; this.enter = animated() ? new RN.Animated.Value(0) : null; }
      componentDidMount() { if (this.enter) safe(() => RN.Animated.timing(this.enter, { toValue: 1, duration: 260, useNativeDriver: true }).start()); }
      componentDidCatch() { issue("skin-render-failed"); api.storage.nativeSkin = false; this.setState({ failed: true }); }
      render() {
        if (this.state.failed) return null;
        const c = colors();
        return h(RN.Animated && this.enter ? RN.Animated.View : RN.View, { style: { borderRadius: RAD.large, borderWidth: 1, borderColor: c.line, overflow: "hidden", backgroundColor: c.surface, marginBottom: SPACE.sm, opacity: this.enter || 1 } }, this.props.children);
      }
    };
    Boundary = class extends React.Component {`);
swap('  function scan() {', `  let SkinFrame;
  function patchNativeSkin() {
    if (!live || !cfg("nativeSkin")) return;
    const hub = mod("TableRowGroup", "TableRow"), target = hub ? safe(() => renderTarget(hub, "TableRowGroup"), null) : null;
    if (!target) { health.hooks.NativeSkinGroup = "not found"; return; }
    const [object, method] = target, seen = targets.get(object) || new Set();
    if (!seen.has("skin:" + method)) {
      try {
        api.patcher.after(method, object, (_args, output) => (!live || !cfg("nativeSkin") || output == null || !SkinFrame) ? output : h(SkinFrame, null, output));
        seen.add("skin:" + method); targets.set(object, seen);
      } catch (_) { issue("hook-failed:NativeSkinGroup"); return; }
    }
    health.hooks.NativeSkinGroup = "patched";
  }
  function scan() {`);
swap('    scan(); syncTheme();', '    scan(); syncTheme(); patchNativeSkin();');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.js'), code);
fs.copyFileSync(path.join(base, 'LICENSE'), path.join(out, 'LICENSE'));
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
  name: 'Discord: Reimagined (0.2 Preview)', version: '0.2.0-alpha.4',
  description: '0.2 features with acknowledged route presentation, modal fallback and preserved original navigation. Device verification pending.',
  authors: [{ name: 'expensiverest' }], main: 'index.js', hash: digest(code), distra: { spec: 1 }
}, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'README.md'), `# Discord: Reimagined 0.2.0-alpha.4

Opt-in repair of the withdrawn 0.2.0-alpha.1. Disable the stable Reimagined plugin and all other navigation plugins before enabling this one.

Install folder:

https://raw.githubusercontent.com/expensiverest/homebase-oss/distra-youbar-plus-port/discord-reimagined-preview/

The stable discord-reimagined/manifest.json is deliberately unchanged.

## Repair

Original Discord navigation is preserved. A custom native route is used only when it is declared in the observed navigation tree and its Scene confirms focus plus nonzero layout. Unready roots, missing routes, silent ignores and thrown errors fall back to a full-screen React Native Modal. A late route cannot take over the fallback. The same 0.2 conversation/composer/profile/call/media components are retained.

Restore Discord dismisses the redesign and disables automatic replacement. Settings opened from a verified native route can cover it normally. In Modal fallback, the modal must dismiss before native Settings opens; the screen state/draft is retained, but the redesign is not shown underneath that sheet. This is an explicit fallback limitation, not full sheet-stacking parity.

## Design refinements

New default Blurple palette (existing choices are kept), a pill dock that labels only the active tab, and mention-count badges on conversations and the Messages tab.

## Motion and recovery

Spring press feedback, animated page entrance and animated dock changes (disabled by Reduce motion). After Restore Discord, a Return to Reimagined button stays above the original bar.

## Layout

Home now opens with a greeting, an unread/mention summary and a Jump back in row of recent chats and channels. Messages has a Mentions filter. Forum and media channels hand off to Discord instead of dead-ending.

## Replaced vs. native

Replaced: Home, Servers, server channels, Messages, conversations, voice call controls, media viewer, profiles, profile editor, appearance and server drawer. Still native because Discord exposes no safe hook: Settings (shown as a sheet), the call media engine and video, uploads and pickers, forum/media-channel browsing, NSFW age gates.

## Returning from native screens

When Reimagined hands off to a Discord screen (a forum, Settings under the fallback modal, a conversation), it watches navigation and reopens itself once you are back on the route you started from.

## Native skin (beta)

Appearance > Restyle Discord settings (beta) restyles Discord's own settings lists in place (rounded bordered cards with a fade-in) by patching the design-system TableRowGroup. It is off by default, needs no tweak, and switches itself off if a restyled list fails to render. Check the compatibility report for NativeSkinGroup.

## Validation

Presenter tests and synthetic plugin lifecycle integration checks run in the Reimagined Repair workflow before publication. No physical iOS/Hermes/Yoga test or real Discord service action is claimed. See scripts/reimagined/ for the reproducible build and tests.

The installer SHA-256 covers the exact source bytes. Runtime has no remote code loader. GPL-3.0-only.
`);
console.log(JSON.stringify({ version: '0.2.0-alpha.4', sourceSHA256: digest(code), output: out }));
