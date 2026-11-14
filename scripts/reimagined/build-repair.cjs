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
code = code.replaceAll('0.2.0-alpha.1', '0.2.0-alpha.18');
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
swap('diagnostics: report });', 'diagnostics: report, scanApp: startTour });');
swap('async function stop() { stopReturnWatch();', 'async function stop() { stopTour(); stopReturnWatch();');
// Native skin (beta): restyle Discord's own settings lists in place by patching the design-system TableRowGroup. Off by default; any failure turns it off.
swap('showPreviews: true, grid: true, accounts: {} };', 'showPreviews: true, grid: true, nativeSkin: false, nativeSkinRows: false, blueprint: false, accounts: {} };');
swap('h(Toggle, { name: "layout", label: "Navigation dock" }),', 'h(Toggle, { name: "layout", label: "Navigation dock" }), h(Toggle, { name: "nativeSkin", label: "Restyle Discord settings (beta)" }), h(Toggle, { name: "nativeSkinRows", label: "Roomier settings rows (beta)" }),');
swap('if (["palette", "nativePalette"].includes(value.key)) syncTheme();', 'if (["palette", "nativePalette"].includes(value.key)) syncTheme(); if (value.key === "nativeSkin" || value.key === "nativeSkinRows") patchNativeSkin();');
swap('    Boundary = class extends React.Component {', `    SkinFrame = class extends React.Component {
      constructor(p) { super(p); this.state = { failed: false }; this.enter = animated() ? new RN.Animated.Value(0) : null; }
      componentDidMount() { if (this.enter) safe(() => RN.Animated.timing(this.enter, { toValue: 1, duration: 260, useNativeDriver: true }).start()); }
      componentDidCatch() { issue("skin-render-failed"); api.storage.nativeSkin = false; this.setState({ failed: true }); }
      render() {
        if (this.state.failed) return this.props.fallback !== undefined ? this.props.fallback : this.props.children;
        if (!this.enter) return this.props.children;
        return h(RN.Animated.View, { style: { opacity: this.enter, transform: [{ translateY: this.enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] } }, this.props.children);
      }
    };
    Boundary = class extends React.Component {`);
swap('  function scan() {', `  let SkinFrame;
  function patchNativeSkin() {
    if (!live) return;
    const pass = (name, flag, wrap, before) => {
      if (!cfg(flag) && !cfg("blueprint")) return;
      const hubs = [mod("TableRowGroup", "TableRow"), ...(safe(() => before ? api.metro.findByPropsAll(name, "TableRow") : api.metro.findByPropsAll(name), []) || [])].map(unwrap).filter(Boolean);
      let patched = 0;
      for (const hub of new Set(hubs)) {
        const target = safe(() => renderTarget(hub, name), null);
        if (!target) continue;
        const [object, method] = target, seen = targets.get(object) || new Set();
        if (seen.has("skin:" + name)) { patched++; continue; }
        try {
          if (before) api.patcher.before(method, object, args => { if (live && cfg("blueprint")) safe(() => record(name, args, null)); return (!live || !cfg(flag)) ? undefined : safe(() => wrap(args), undefined); });
          else api.patcher.after(method, object, (_args, output) => { if (live && cfg("blueprint") && output != null) safe(() => record(name, _args, output)); return (!live || !cfg(flag) || output == null) ? output : safe(() => wrap(output, _args), output); });
          seen.add("skin:" + name); targets.set(object, seen); patched++;
        } catch (_) { issue("hook-failed:NativeSkin" + name); }
      }
      health.hooks["NativeSkin" + name] = patched ? "patched x" + patched : hubs.length ? "no patchable " + name : "not found";
    };
    pass("TableRowGroup", "nativeSkin", output => SkinFrame ? h(SkinFrame, { fallback: output }, safe(() => skinGroup(output), output)) : output);
    pass("TableRowGroupTitle", "nativeSkin", (output, args) => typeof args?.[0]?.title === "string" ? skinTitle(args[0].title) : output);
    pass("TableRow", "nativeSkinRows", skinRow);
    pass("SearchField", "nativeSkin", output => SkinFrame ? h(SkinFrame, { fallback: output }, safe(() => skinSearch(output), output)) : output);
    probeSearch();
  }
  function scan() {`);
swap('api.patcher.after(method, object, (_args, output) => { if (!live || output == null || !me() ||', 'api.patcher.after(method, object, (_args, output) => { if (live && cfg("blueprint")) safe(() => recordTabBar(name, _args[0])); if (!live || output == null || !me() ||');
swap('    scan(); syncTheme();', '    scan(); syncTheme(); patchNativeSkin();');
// Settings blueprint: records a compact structural sample (component names, prop keys, numeric styles; text lengths only) of the native rows and groups so the skin can be designed from real data.
swap('h(Toggle, { name: "diagnostics", label: "Tap diagnostics" }), button("Copy compatibility report", "report", null, { marginTop: SPACE.lg }, "copy-report"),', 'h(Toggle, { name: "diagnostics", label: "Tap diagnostics" }), button("Copy compatibility report", "report", null, { marginTop: SPACE.lg }, "copy-report"), h(Toggle, { name: "blueprint", label: "Record settings blueprint" }), button("Copy settings blueprint", "blueprint", null, { marginTop: SPACE.sm }, "copy-blueprint"), button("Scan whole app (tour)", "tour", null, { marginTop: SPACE.sm }, "scan-app"),');
swap('else if (action === "report") copyReport();', 'else if (action === "report") copyReport(); else if (action === "blueprint") copyBlueprint(); else if (action === "tour") startTour();');
swap('if (value.key === "nativeSkin" || value.key === "nativeSkinRows") patchNativeSkin();', 'if (value.key === "nativeSkin" || value.key === "nativeSkinRows" || value.key === "blueprint") patchNativeSkin();');
swap('  let SkinFrame;', `  let SkinFrame;
  const blueprint = { hub: null, routes: {}, samples: 0, search: [], probes: [], hubSearch: null, census: {}, tour: [], screens: {}, tabBars: {} };
  const TEXTY = /title|label|text|children|description|subtitle|placeholder|accessibilityLabel/i;
  function typeName(t) { return typeof t === "string" ? t : t?.displayName || t?.name || t?.type?.displayName || t?.type?.name || t?.render?.displayName || t?.render?.name || (t ? "anonymous" : "null"); }
  function flat(style, out = {}, depth = 0) {
    if (Array.isArray(style) && depth < 4) { style.forEach(x => flat(x, out, depth + 1)); return out; }
    if (style && typeof style === "object") for (const k of Object.keys(style)) { const v = style[k]; if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 24)) out[k] = v; else if (v && typeof v === "object" && !Array.isArray(v) && v.constructor === Object) out[k] = "{" + Object.keys(v).slice(0, 6).join(",") + "}"; else if (Array.isArray(v)) out[k] = "[" + v.length + "]"; else out[k] = typeof v; }
    return out;
  }
  function describe(node, depth, budget) {
    if (node == null || typeof node === "boolean") return null;
    if (typeof node === "string" || typeof node === "number") return "text(" + String(node).length + ")";
    if (Array.isArray(node)) return node.slice(0, 8).map(x => describe(x, depth, budget)).filter(x => x != null);
    if (typeof node !== "object" || !node.props && !node.type) return typeof node;
    if (budget.n-- <= 0 || depth > 9) return "…";
    const props = node.props || {}, p = {};
    for (const k of Object.keys(props)) {
      if (k === "children") continue;
      const v = props[k];
      if (k === "style" || /Style$/.test(k)) p[k] = flat(v);
      else if (typeof v === "function") p[k] = "fn";
      else if (typeof v === "string") p[k] = TEXTY.test(k) ? "text(" + v.length + ")" : v.slice(0, 24);
      else if (typeof v === "number" || typeof v === "boolean") p[k] = v;
      else if (v && typeof v === "object" && (v.type || v.props)) p[k] = describe(v, depth + 1, budget);
      else p[k] = v == null ? null : Array.isArray(v) ? "[" + v.length + "]" : typeof v;
    }
    const out = { t: typeName(node.type), p };
    const kids = props.children !== undefined ? describe(props.children, depth + 1, budget) : null;
    if (kids != null && !(Array.isArray(kids) && !kids.length)) out.c = kids;
    return out;
  }
  function record(name, args, output) {
    const route = currentRouteName() || "unknown", bucket = blueprint.routes[route] || (blueprint.routes[route] = { TableRowGroup: [], TableRow: [], TextInput: [], TableRowGroupTitle: [] });
    const list = bucket[name] || (bucket[name] = []); if (list.length >= (name === "TableRow" ? 5 : 3) || blueprint.samples > 400) return;
    const sig = Object.keys(args?.[0] || {}).sort().join(",") + "|" + typeName(output?.type); if (list.some(x => x.sig === sig)) return;
    blueprint.samples++;
    list.push({ sig, props: describe({ type: name, props: { ...(args?.[0] || {}), children: undefined } }, 0, { n: 20 })?.p, output: describe(output, 0, { n: 60 }) });
  }
  // Search probe: while blueprint is on, observe every element created through React (createElement and the jsx runtime) and keep samples whose type name or placeholder mentions search, so the real search component is identified.
  function probeSearch() {
    if (!cfg("blueprint")) return;
    const seenHost = targets.get(blueprint) || new Set(); targets.set(blueprint, seenHost);
    const look = args => {
      if (!live || !cfg("blueprint")) return;
      const type = args?.[0], props = args?.[1] || {}, name = typeName(type);
      if (typeof type !== "string" && name !== "anonymous") {
        const list = blueprint.screens[currentRouteName() || "unknown"] || (blueprint.screens[currentRouteName() || "unknown"] = []);
        if (list.length < 40 && !list.includes(name)) list.push(name);
        const route = currentRouteName() || "unknown", key = name, row = blueprint.census[key] || (Object.keys(blueprint.census).length < 400 ? (blueprint.census[key] = { n: 0, routes: [], keys: Object.keys(props).slice(0, 14), sample: null }) : null);
        if (row) { row.n++; if (row.routes.length < 6 && !row.routes.includes(route)) row.routes.push(route); if (!row.sample && /^(Card|Table|Button|Icon|Text|Heading|Header|Nav|Tab|Bar|Search|Field|Input|Toggle|Switch|Avatar|Badge|Sheet|List|Row|Section|Modal|Menu)/.test(name)) row.sample = safe(() => describe({ type, props: { ...props, children: undefined } }, 0, { n: 14 })?.p, null); }
      }
      if (blueprint.search.length >= 8) return;
      const hit = /search/i.test(name) || (typeof props.placeholder === "string" && /search/i.test(props.placeholder)) || (typeof props.accessibilityLabel === "string" && /search/i.test(props.accessibilityLabel));
      if (!hit) return;
      const sig = name + "|" + Object.keys(props).sort().join(","); if (blueprint.search.some(x => x.sig === sig)) return;
      blueprint.search.push({ sig, route: currentRouteName(), el: describe({ type, props }, 0, { n: 30 }) }); health.hooks.SearchProbe = blueprint.probes.length + " probes, " + blueprint.search.length + " samples";
    };
    const attach = (object, method, key) => { if (!object || typeof object[method] !== "function" || seenHost.has(key)) return; try { api.patcher.before(method, object, args => { safe(() => look(args)); }); seenHost.add(key); blueprint.probes.push(key); } catch (_) {} };
    attach(React, "createElement", "createElement");
    for (const rt of safe(() => api.metro.findByPropsAll("jsx", "jsxs"), []) || []) { const o = unwrap(rt); ["jsx", "jsxs", "jsxDEV"].forEach(m => attach(o, m, "rt:" + m + ":" + (blueprint.probes.length))); }
    health.hooks.SearchProbe = blueprint.probes.length ? blueprint.probes.length + " probes, " + blueprint.search.length + " samples" : "no probe";
    for (const hub of [mod("TableRowGroup", "TableRow"), ...(safe(() => api.metro.findByPropsAll("TextInput"), []) || [])].map(unwrap).filter(Boolean)) blueprint.hubSearch = Object.keys(hub).filter(k => /search|input|field/i.test(k)).slice(0, 40);
  }
  // Whole-app tour: walks every route name the mounted navigators declare (skipping risky ones) so the census and samples fill without manual clicking, then returns to where it started.
  let tourTimer = null, tourToken = 0;
  function stopTour() { if (tourTimer !== null) clearTimeout(tourTimer); tourTimer = null; tourToken++; }
  function tourRoutes(nav) {
    const names = new Set();
    // Only siblings of the focused screen: they share its navigator, which is far less likely to need route params.
    let s = routeState(nav), last = s;
    for (let d = 0; s && d < 10; d++) { if (Array.isArray(s.routeNames)) last = s; s = s.routes?.[s.index ?? 0]?.state; }
    (last?.routeNames || []).forEach(n => names.add(n));
    const bad = Array.isArray(api.storage.tourBad) ? api.storage.tourBad : [];
    return [...names].filter(n => typeof n === "string" && !bad.includes(n) && !/^DISTRA_CUSTOM_PAGE$|search|call|voice|camera|login|logout|sign|delete|purchase|checkout|payment|captcha|verify|webview|oauth|profile|channel|guild|thread|message|user|invite|gift|member|report|modal|sheet|picker|share|lightbox|media|forum|stage|event/i.test(n));
  }
  function startTour() {
    const nav = root();
    if (!nav?.navigate) { toast("Tour unavailable: no navigation"); return; }
    stopTour();
    if (api.storage.tourPending) { api.storage.tourBad = (Array.isArray(api.storage.tourBad) ? api.storage.tourBad : []).concat(api.storage.tourPending); api.storage.tourPending = null; toast("Skipping " + api.storage.tourBad.slice(-1)[0] + " (it crashed last time)"); }
    api.storage.blueprint = true; patchNativeSkin();
    const origin = currentRouteName(), queue = tourRoutes(nav), token = tourToken; blueprint.tour = [];
    toast("Touring " + queue.length + " screens…");
    const step = () => {
      if (!live || token !== tourToken) return;
      const name = queue.shift();
      if (!name) { api.storage.tourPending = null; if (origin) safe(() => nav.navigate(origin)); tourTimer = null; toast("Tour done. Copy the blueprint."); return; }
      api.storage.tourPending = name;
      let ok = true; try { nav.navigate(name); } catch (_) { ok = false; }
      tourTimer = setTimeout(() => { api.storage.tourPending = null; blueprint.tour.push({ name, ok, landed: currentRouteName() }); step(); }, 900);
    };
    tourTimer = setTimeout(step, 300);
  }
  // Records how Discord's tab bar is wired (route names, descriptor keys, option keys) so native tab screens can be targeted precisely.
  function recordTabBar(name, props) {
    if (!props || blueprint.tabBars[name]) return;
    const st = props.state || {}, d = props.descriptors || {}, first = d[Object.keys(d)[0]] || {};
    blueprint.tabBars[name] = { propKeys: Object.keys(props).slice(0, 24), routes: (st.routes || []).map(r => r.name), index: st.index, routeNames: st.routeNames, descriptorKeys: Object.keys(first).slice(0, 16), optionKeys: Object.keys(first.options || {}).slice(0, 24), renderIsFn: typeof first.render === "function", navigationKeys: Object.keys(props.navigation || {}).slice(0, 24) };
  }
  function copyBlueprint() {
    const c = safe(() => unwrap(api.common.clipboard), null), hub = mod("TableRowGroup", "TableRow");
    const data = { product: "Discord: Reimagined", version: VERSION, kind: "settings-blueprint", hubExports: hub ? Object.keys(hub).slice(0, 120) : null, route: currentRouteName(), routes: blueprint.routes, census: blueprint.census, screens: blueprint.screens, tabBars: blueprint.tabBars, tour: blueprint.tour, search: blueprint.search, searchProbes: blueprint.probes, hubSearchExports: blueprint.hubSearch, patched: { group: health.hooks.NativeSkinTableRowGroup, row: health.hooks.NativeSkinTableRow } };
    if (c?.setString) { c.setString(JSON.stringify(data)); toast("Settings blueprint copied"); }
  }`);
// Native skin visuals, derived from the settings blueprint: group = Provider > View > [TableRowGroupTitle?, rounded clipped View > rows]; row = Card > TableRowInner (optionally followed by a TableRowDivider in a fragment).
swap('  let SkinFrame;', `  let SkinFrame;
  const skinned = new WeakSet();
  const isEl = x => React.isValidElement(x);
  // Settings search: Discord's SettingSearchBar renders the design hub's SearchField; wrap it in a pill with an accent hairline and clip the inner field to it.
  function skinSearch(output) {
    const c = colors();
    return h(RN.View, { style: { borderRadius: RAD.medium, padding: 3, backgroundColor: c.elevated, borderWidth: RN.StyleSheet?.hairlineWidth || 1, borderColor: c.accentSoft, marginHorizontal: SPACE.xs } }, output);
  }
  function skinTitle(text) { const c = colors(); return h(RN.Text, { style: { color: c.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.9, marginLeft: SPACE.md, marginBottom: SPACE.sm, marginTop: SPACE.xs } }, text.toUpperCase()); }
  function skinGroup(output) {
    if (!isEl(output) || !isEl(output.props.children)) return output;
    const c = colors(), view = output.props.children;
    const kids = React.Children.toArray(view.props.children).map(kid => {
      if (!isEl(kid)) return kid;
      const name = typeName(kid.type), style = flat(kid.props.style);
      if (name === "TableRowGroupTitle" && typeof kid.props.title === "string") return React.cloneElement(skinTitle(kid.props.title), { key: kid.key });
      if (style.borderRadius === 12 && style.overflow === "hidden") return React.cloneElement(kid, { style: [kid.props.style, { borderRadius: RAD.large, borderWidth: RN.StyleSheet?.hairlineWidth || 1, borderColor: c.line, backgroundColor: c.elevated }] });
      return kid;
    });
    return React.cloneElement(output, null, React.cloneElement(view, { style: [view.props.style, { marginBottom: SPACE.sm }] }, ...kids));
  }
  function skinCard(card) {
    if (!isEl(card) || typeName(card.type) !== "Card" || skinned.has(card)) return card;
    const c = colors(), inner = card.props.children, trailing = inner?.props?.trailing, icon = inner?.props?.icon;
    const selected = isEl(trailing) && typeName(trailing.type) === "FormRadio" && trailing.props.selected === true;
    const tile = isEl(icon) ? h(RN.View, { style: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: c.accentSoft } }, icon) : icon;
    const child = isEl(inner) && icon && inner.props.icon !== tile ? React.cloneElement(inner, { icon: tile }) : inner;
    const out = React.cloneElement(card, { radius: RAD.large, style: [card.props.style, { minHeight: 64, justifyContent: "center", backgroundColor: selected ? c.accentSoft : c.elevated }] }, child);
    skinned.add(out); return out;
  }
  function skinRow(output) {
    if (!isEl(output)) return output;
    if (typeName(output.type) === "Card") return skinCard(output);
    const kids = React.Children.toArray(output.props.children);
    return kids.length ? React.cloneElement(output, null, ...kids.map(skinCard)) : output;
  }`);

// Native screens: when enabled, the screen components Discord's navigator renders for the guilds, notifications and you routes are replaced in place by Reimagined content (YouBar and native navigation stay), failing open to the original screen.
swap('nativeSkinRows: false, blueprint: false', 'nativeSkinRows: false, nativeScreens: false, blueprint: false');
swap('h(Toggle, { name: "nativeSkinRows", label: "Roomier settings rows (beta)" }),', 'h(Toggle, { name: "nativeSkinRows", label: "Roomier settings rows (beta)" }), h(Toggle, { name: "nativeScreens", label: "Reimagined inside native screens (beta)" }),');
swap('if (value.key === "nativeSkin" || value.key === "nativeSkinRows" || value.key === "blueprint") patchNativeSkin();', 'if (value.key === "nativeSkin" || value.key === "nativeSkinRows" || value.key === "blueprint" || value.key === "nativeScreens") patchNativeSkin();');
swap('cfg("layout") && cfg("startHome") && !autoPresented', 'cfg("layout") && !cfg("nativeScreens") && cfg("startHome") && !autoPresented');
swap('const launch = this.props.mode === "settings" || !me() ? null', 'const launch = this.props.mode === "settings" || !me() || cfg("nativeScreens") ? null');
swap('if (!baseRoute || !cfg("layout")) return;', 'if (!baseRoute || !cfg("layout") || cfg("nativeScreens")) return;');
swap('    push({ screen: "conversation", channel: id }); loadMessages(id);', '    if (cfg("nativeScreens")) { nativeConversation(id); return; }\n    push({ screen: "conversation", channel: id }); loadMessages(id);');
swap('  let SkinFrame;', `  let SkinFrame, NativeHost, embeddedRoute = null;
  const SCREEN_TAB = { guilds: "home", notifications: "messages", you: "you" };
  function swapScreen(args) {
    const type = args?.[0], props = args?.[1];
    if (props && props.__reimaginedRaw) { const { __reimaginedRaw, ...rest } = props; return [type, rest, ...args.slice(2)]; }
    if (!live || !cfg("nativeScreens") || !NativeHost || typeof type === "string" || type === NativeHost || !props || !props.route || !props.navigation) return undefined;
    const name = props.route.name, keys = Object.keys(props);
    if (typeof name !== "string") return undefined;
    const kind = typeof type === "function" ? "fn" : type && typeof type === "object" ? (type.$$typeof ? "memo/forward" : type.render ? "render" : "object") : typeof type;
    // Report what each candidate looked like so a miss can be diagnosed from the compatibility report alone.
    const why = !SCREEN_TAB[name] ? "unmapped" : keys.some(k => ["screen", "routeState", "getState", "setState", "options", "children"].includes(k)) ? "navigator-internal" : kind === "string" || kind === "undefined" ? "bad-type" : "";
    const seenKey = "Screen:" + name;
    if (!health.hooks[seenKey] || health.hooks[seenKey].length < 140) health.hooks[seenKey] = (health.hooks[seenKey] ? health.hooks[seenKey] + " ; " : "") + typeName(type) + "/" + kind + " {" + keys.slice(0, 8).join(",") + "} " + (why || "swap");
    if (why) return undefined;
    health.hooks.NativeScreens = "swapped " + name;
    return [NativeHost, { ...props, __reimaginedOrig: type }, ...args.slice(2)];
  }
  function patchScreens() {
    if (!live || !cfg("nativeScreens")) return;
    const seen = targets.get(swapScreen) || new Set(); targets.set(swapScreen, seen);
    const attach = (object, method, key) => { if (!object || typeof object[method] !== "function" || seen.has(key)) return; try { api.patcher.before(method, object, args => swapScreen(args)); seen.add(key); } catch (_) { issue("hook-failed:NativeScreens"); } };
    attach(React, "createElement", "createElement");
    let n = 0; for (const rt of safe(() => api.metro.findByPropsAll("jsx", "jsxs"), []) || []) { const o = unwrap(rt); n++; ["jsx", "jsxs", "jsxDEV"].forEach(m => attach(o, m, "rt" + n + ":" + m)); }
    health.hooks.NativeScreens = health.hooks.NativeScreens || (seen.size ? "armed" : "no hook");
  }`);
swap('    pass("SearchField", "nativeSkin",', '    patchScreens();\n    pass("SearchField", "nativeSkin",');
swap('    Boundary = class extends React.Component {', `    NativeHost = class extends React.Component {
      constructor(p) { super(p); this.state = { failed: false, tick: 0, width: safe(() => RN.Dimensions.get("window").width, 390) }; this.refresh = () => this.setState(s => ({ tick: s.tick + 1 })); }
      componentDidMount() { listeners.add(this.refresh); this.focusOff = safe(() => this.props.navigation?.addListener?.("focus", () => this.claim()), null); this.claim(true); loadProfile(accountId); }
      componentWillUnmount() { listeners.delete(this.refresh); if (typeof this.focusOff === "function") this.focusOff(); else this.focusOff?.remove?.(); }
      claim(quiet) { const r = this.props.route?.name; if (embeddedRoute === r) return; embeddedRoute = r; state = { ...state, tab: SCREEN_TAB[r] || "home", screen: "main", history: [], menu: null, drawer: false, channel: null }; if (!quiet) emit(); }
      componentDidCatch() { issue("native-screen-failed"); api.storage.nativeScreens = false; this.setState({ failed: true }); }
      render() {
        const { __reimaginedOrig: Orig, ...rest } = this.props;
        if (!live || this.state.failed || !cfg("nativeScreens") || !me()) return h(Orig, { ...rest, __reimaginedRaw: true });
        const c = colors(), Safe = RN.SafeAreaView || RN.View, width = Math.min(this.state.width, 820), mine = embeddedRoute === rest.route?.name, tab = mine ? state.tab : SCREEN_TAB[rest.route?.name], screen = mine ? state.screen : "main";
        const content = screen === "media" ? h(Media) : screen === "call" ? h(CallScreen) : screen === "edit-profile" ? h(EditProfile) : screen === "preferences" ? h(Preferences) : screen === "profile" ? h(Profile, { id: state.profile }) : screen === "channels" ? h(Channels) : tab === "servers" ? h(Servers, { width }) : tab === "messages" ? h(Messages) : tab === "you" ? h(Profile, { id: accountId }) : h(Home, { width });
        return h(Safe, { testID: "reimagined-native-screen", style: { flex: 1, backgroundColor: c.bg, paddingBottom: 84 } }, h(Boundary, { key: screen + ":" + tab }, h(SkinFrame, null, content)), state.drawer && mine ? h(ServerDrawer, { width }) : null);
      }
    };
    Boundary = class extends React.Component {`);
// Discovery: screen root elements (props are exactly navigation and route) per route name.
swap('      if (blueprint.search.length >= 8) return;', '      if (props.route && typeof props.route.name === "string" && props.navigation && typeof type !== "string") { const list = blueprint.screenRoots[props.route.name] || (blueprint.screenRoots[props.route.name] = []), sig = name + "|" + Object.keys(props).sort().join(","); if (list.length < 4 && !list.some(x => x.sig === sig)) list.push({ sig, type: name, keys: Object.keys(props).slice(0, 14) }); }\n      if (blueprint.search.length >= 8) return;');
swap('screens: {}, tabBars: {} };', 'screens: {}, screenRoots: {}, tabBars: {} };');
swap('screens: blueprint.screens, tabBars: blueprint.tabBars,', 'screens: blueprint.screens, screenRoots: blueprint.screenRoots, tabBars: blueprint.tabBars,');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.js'), code);
fs.copyFileSync(path.join(base, 'LICENSE'), path.join(out, 'LICENSE'));
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
  name: 'Discord: Reimagined (0.2 Preview)', version: '0.2.0-alpha.18',
  description: '0.2 features with acknowledged route presentation, modal fallback and preserved original navigation. Device verification pending.',
  authors: [{ name: 'expensiverest' }], main: 'index.js', hash: digest(code), distra: { spec: 1 }
}, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'README.md'), `# Discord: Reimagined 0.2.0-alpha.18

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

Appearance > Reimagined inside native screens (beta) renders Reimagined Home, Messages and You as the content of Discord's own guilds, notifications and you screens (the YouBar and native navigation stay; conversations open in Discord's native chat); it needs an app restart to take effect and falls back to the original screen on any error. Preferences > Scan whole app (tour) visits the sibling screens of the screen you are on (names that look parameter-dependent are skipped, and a route that crashed is remembered and skipped next time), records a component census, then returns; copy the settings blueprint afterwards. Appearance > Restyle Discord settings (beta) restyles Discord's own settings lists in place (a fade-and-rise entrance; Discord's own card styling is left untouched) by patching the design-system TableRowGroup. It is off by default, needs no tweak, and switches itself off if a restyled list fails to render. The settings search bar (the design hub's SearchField) is wrapped in a rounded frame with an accent hairline (unclipped, so the focus ring stays whole). Appearance > Roomier settings rows (beta) restyles each TableRow (taller, translucent icon tiles, accent-tinted selected radio rows); the group skin adds a rounded hairline-bordered card with small-caps section titles. Appearance > Record settings blueprint, then Copy settings blueprint, captures a text-free structural sample (component names, prop keys, numeric styles) of the rows and groups on each screen you visit so the skin can be designed from real data. Check the compatibility report for NativeSkinTableRowGroup and NativeSkinTableRow.

## Validation

Presenter tests and synthetic plugin lifecycle integration checks run in the Reimagined Repair workflow before publication. No physical iOS/Hermes/Yoga test or real Discord service action is claimed. See scripts/reimagined/ for the reproducible build and tests.

The installer SHA-256 covers the exact source bytes. Runtime has no remote code loader. GPL-3.0-only.
`);
console.log(JSON.stringify({ version: '0.2.0-alpha.18', sourceSHA256: digest(code), output: out }));
