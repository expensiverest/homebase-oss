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
code = code.replaceAll('0.2.0-alpha.1', '0.2.0-alpha.35');
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
        presentationHosts.add(this); treeHost = this; if (!modalOwner) modalOwner = this;
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
        const overlay = null;
        return h(React.Fragment, null, this.props.original, launch, overlay,
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
        return h(RN.Animated.View, { style: { flex: this.props.fill ? 1 : undefined, opacity: this.enter, transform: [{ translateY: this.enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] } }, this.props.children);
      }
    };
    Boundary = class extends React.Component {`);
swap('  function scan() {', `  let SkinFrame;
  // Re-lays out Discord's own screens in place. Whole screens are only replaced where they are self-contained pushed routes (You);
  // elsewhere the native screen, its scroll plumbing and the YouBar stay intact while its building blocks (rows, section headers, items, empty states) take the Reimagined layout.
  const LAYOUT_TARGETS = [["NativeYou", "modules/main_tabs_v2/native/tabs/you/YouScreen.tsx", "you", true]];
  const NC = "modules/notification_center/native/", MT = "modules/main_tabs_v2/native/tabs/messages/";
  // Discord's notification and DM lists use fixed-size cells, so only self-sizing pieces (section headers) are re-laid out; rows and items stay native.
  const PIECE_TARGETS = [
    ["NativeForYouReadHeader", NC + "ForYouReadSectionHeader.tsx", ["ForYouReadSectionHeader"], "header"],
    ["NativeForYouRecentHeader", NC + "ForYouRecentActivitySectionHeader.tsx", ["ForYouRecentActivitySectionHeader"], "header"],
    ["NativeForYouFriendsHeader", NC + "ForYouSuggestedFriendsSectionHeader.tsx", ["default"], "header"]
  ];
  const passthrough = p => p.__out == null ? null : p.__out;
  function nodeText(node, depth = 0) {
    if (node == null || depth > 8 || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node).trim();
    if (Array.isArray(node)) { for (const n of node) { const v = nodeText(n, depth + 1); if (v) return v; } return ""; }
    return isEl(node) ? nodeText(node.props?.children, depth + 1) : "";
  }
  function rowChannelId(p) {
    const v = p?.channelId || p?.channel?.id || p?.item?.channel?.id || p?.item?.channelId || p?.row?.channel?.id || p?.data?.channel?.id;
    return typeof v === "string" ? v : null;
  }
  function pieceWrap(kind, output, args) {
    const c = colors();
    if (kind === "row") { const id = rowChannelId(args?.[0]); return id && RowCard && !args?.[0]?.__reimaginedRaw ? h(RowCard, { channelId: id, __reimaginedOrig: () => output }) : output; }
    if (kind === "header") { const text = nodeText(output); return text ? h(SkinFrame, { fallback: output }, h(RN.View, { style: { paddingTop: SPACE.lg } }, skinTitle(text))) : output; }
    if (kind === "card") return h(SkinFrame, { fallback: output }, h(RN.View, { style: { marginHorizontal: SPACE.md, marginVertical: SPACE.xs, borderRadius: RAD.large, backgroundColor: c.surface, borderWidth: RN.StyleSheet?.hairlineWidth || 1, borderColor: c.line, overflow: "hidden" } }, output));
    if (kind === "empty") return h(SkinFrame, { fallback: output }, h(RN.View, { style: { margin: SPACE.xl, paddingVertical: SPACE.xxl, paddingHorizontal: SPACE.xl, borderRadius: RAD.sheet, backgroundColor: c.surface, alignItems: "center" } }, output));
    return output;
  }
  function hookExport(label, file, names, wrap) {
    const raw = safe(() => api.metro.findByFilePath(file), null);
    if (!raw) { health.hooks[label] = "not found"; return; }
    let patched = 0;
    for (const name of names) {
      if (raw[name] == null && name !== "default") continue;
      const target = safe(() => renderTarget(raw, name), null);
      if (!target) continue;
      const [object, method] = target, seen = targets.get(object) || new Set();
      if (seen.has("layout")) { patched++; continue; }
      try {
        api.patcher.after(method, object, (args, output) => {
          if (!live || !cfg("nativeScreens") || output == null) return output;
          const next = safe(() => wrap(output, args), output);
          if (next !== output) health.hooks[label] = "applied";
          return next;
        });
        seen.add("layout"); targets.set(object, seen); patched++;
      } catch (_) { issue("hook-failed:" + label); }
    }
    if (health.hooks[label] !== "applied") health.hooks[label] = patched ? "patched" : "no export";
  }
  function openChannelSheet(id) {
    const sheet = safe(() => api.metro.findByFilePath("modules/channel/native/ChannelLongPressActionSheet.tsx"), null), lazy = mod("openLazy", "hideActionSheet");
    if (sheet && typeof lazy?.openLazy === "function" && safe(() => (lazy.openLazy(Promise.resolve(sheet.default ? sheet : { default: sheet }), "ChannelLongPress", { channelId: id }), true), false)) return;
    openChannel(id);
  }
  function patchLayouts() {
    if (!live) return;
    for (const [label, file, route, pushed] of LAYOUT_TARGETS) hookExport(label, file, ["default"], output => {
      if (!NativeHost || currentRouteName() !== route) return output;
      return h(NativeHost, { route: { name: route }, forceTab: SCREEN_TAB[route] || route, navigation: safe(() => root(), null), overlay: pushed, __out: output, __reimaginedOrig: passthrough });
    });
    for (const [label, file, names, kind] of PIECE_TARGETS) hookExport(label, file, names, (output, args) => pieceWrap(kind, output, args));
    patchRedesign();
  }
  // In-place redesign of Discord's own lists. Fixed-size lists (DMs, the server rail) are only restyled inside the geometry Discord measures:
  // the DM cell height comes from getMessagesItemChannelSizes, so it is enlarged there and the native row is restyled to exactly fill it.
  const rowHeights = new Set(), cardItems = new WeakMap();
  function patchFn(label, file, name, after) {
    const raw = safe(() => api.metro.findByFilePath(file), null);
    if (!raw || typeof raw[name] !== "function") { health.hooks[label] = raw ? "no export" : "not found"; return; }
    const seen = targets.get(raw) || new Set();
    if (seen.has("fn:" + name)) return;
    try { api.patcher.after(name, raw, (args, output) => { if (!live) return output; try { return after(args, output); } catch (_) { return output; } }); seen.add("fn:" + name); targets.set(raw, seen); if (health.hooks[label] !== "applied") health.hooks[label] = "patched"; }
    catch (_) { issue("hook-failed:" + label); }
  }
  function mapTree(node, pred, fn, depth = 0) {
    if (depth > 12 || node == null || typeof node !== "object") return node;
    if (Array.isArray(node)) { let changed = false; const next = node.map(n => { const m = mapTree(n, pred, fn, depth + 1); if (m !== n) changed = true; return m; }); return changed ? next : node; }
    if (!isEl(node)) return node;
    if (pred(node)) return fn(node);
    const kids = node.props?.children, next = kids == null ? kids : mapTree(kids, pred, fn, depth + 1);
    return next === kids ? node : React.cloneElement(node, null, ...(Array.isArray(next) ? next : [next]));
  }
  const addStyle = (el, extra) => React.cloneElement(el, { style: typeof el.props.style === "function" ? state => [el.props.style(state), extra] : [el.props.style, extra] });
  const hairline = () => RN.StyleSheet?.hairlineWidth || 1;
  const ROW_GAP = 12;
  function cardRenderItem(orig) {
    if (typeof orig !== "function") return orig;
    if (cardItems.has(orig)) return cardItems.get(orig);
    const next = function (info) {
      const out = orig.apply(this, arguments);
      if (!live || !cfg("nativeScreens") || !isEl(out)) return out;
      const c = colors(), p = out.props || {}, inner = isEl(p.children) ? p.children.props || {} : {};
      if (p.children == null && p.style != null && Object.keys(p).length === 1) return h(RN.View, { style: { height: SPACE.xs } });
      if (!(inner.item || p.item || p.suggestedFriend)) return out;
      health.hooks.NativeForYouCards = "applied";
      return h(RN.View, { style: { marginHorizontal: SPACE.md, marginVertical: 4, borderRadius: RAD.large, backgroundColor: c.surface, borderWidth: hairline(), borderColor: c.line, overflow: "hidden" } }, out);
    };
    cardItems.set(orig, next); return next;
  }
  function patchRedesign() {
    const MI = MT + "items/", QH = "modules/quests/native/QuestHooks.native.tsx";
    patchFn("NativeDmSizes", MI + "MessagesItemChannel.tsx", "getMessagesItemChannelSizes", (_args, out) => {
      if (!cfg("nativeScreens") || !out || typeof out.height !== "number") return out;
      const height = Math.round(Math.max(out.height, 40 + (out.padding || 16)) + ROW_GAP);
      rowHeights.add(height); health.hooks.NativeDmSizes = "applied";
      return { ...out, avatar: 40, height };
    });
    patchFn("NativeDmRow", MI + "channel/MessagesItemChannelBase.tsx", "default", (args, out) => {
      const p = args?.[0];
      if (!cfg("nativeScreens") || !isEl(out) || !p || !rowHeights.has(p.height)) return out;
      const c = colors(), id = p.channel?.id, hot = !!id && unread(id);
      const card = { flex: 1, marginHorizontal: SPACE.md, marginVertical: ROW_GAP / 2, marginBottom: ROW_GAP / 2, paddingHorizontal: SPACE.md, borderRadius: RAD.large, backgroundColor: hot ? c.elevated : c.surface, borderWidth: hairline(), borderColor: hot ? c.accent : c.line, overflow: "hidden" };
      let done = false;
      const pressable = n => !done && typeof n.props?.onPress === "function" && typeof n.props?.onLongPress === "function";
      const next = mapTree(out, pressable, n => { done = true; return addStyle(n, card); });
      if (done) health.hooks.NativeDmRow = "applied";
      return next;
    });
    patchFn("NativeDmAvatar", MI + "channel/MessagesItemChannelAvatar.tsx", "default", (_args, out) => {
      if (!cfg("nativeScreens") || !rowHeights.size || !isEl(out) || !out.props?.user) return out;
      const S = safe(() => api.metro.findByProps("AvatarSizes")?.AvatarSizes, null);
      return S && S.LARGE_40 != null && out.props.size === S.REFRESH_MEDIUM_32 ? React.cloneElement(out, { size: S.LARGE_40 }) : out;
    });
    hookExport("NativeForYouList", NC + "ForYouItems.tsx", ["ForYouItems"], output => mapTree(output, n => typeof n.props?.renderItem === "function" && "data" in n.props, n => React.cloneElement(n, { renderItem: cardRenderItem(n.props.renderItem) })));
    // The server rail becomes a floating panel: its own surface, rounded trailing edge and pill separators. Width and item geometry stay Discord's.
    hookExport("NativeGuildRail", "modules/guilds_bar/native/GuildsBar.tsx", ["default"], output => { const c = colors(); return mapTree(output, n => n.props?.nativeID === "guilds-bar-view", n => addStyle(n, { backgroundColor: c.surface, borderTopRightRadius: RAD.sheet, borderBottomRightRadius: RAD.sheet, borderRightWidth: hairline(), borderColor: c.line, marginVertical: SPACE.sm, paddingTop: SPACE.xs })); });
    hookExport("NativeGuildSeparator", "modules/guilds_bar/native/GuildsBarSeparator.tsx", ["default"], output => isEl(output) && output.props?.style != null && output.props.children == null ? addStyle(output, { backgroundColor: colors().accentSoft, borderRadius: 2, width: 20, alignSelf: "center" }) : output);
    // The Quests dock floating above the YouBar: the original hooks still run (hook order is preserved) but report it as not rendered with no height.
    const noDock = (value) => (_args, out) => cfg("hideQuestDock") ? (health.hooks.QuestDock = "hidden", value) : out;
    patchFn("QuestDock", QH, "useIsMobileQuestDockRenderedBase", noDock(false));
    patchFn("QuestDockRendered", QH, "useIsMobileQuestDockRendered", noDock(false));
    patchFn("QuestDockVisible", QH, "useIsMobileQuestDockVisibleToUser", noDock(false));
    patchFn("QuestDockHeight", QH, "useMobileQuestDockHeight", noDock(0));
    for (const [label, file] of [["QuestDockView", "modules/quests/native/QuestDock/QuestDock.tsx"], ["QuestDockNoFill", "modules/quests/native/QuestDock/NoFillQuestDock.tsx"]]) patchFn(label, file, "default", (_args, out) => cfg("hideQuestDock") ? null : out);
  }
  function patchNativeSkin() {
    if (!live) return;
    const pass = (name, flag, wrap, before, only) => {
      if (!cfg(flag) && !cfg("blueprint")) return;
      const hubs = [mod("TableRowGroup", "TableRow"), ...(only ? [] : safe(() => before ? api.metro.findByPropsAll(name, "TableRow") : api.metro.findByPropsAll(name), []) || [])].map(unwrap).filter(Boolean);
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
    // Restyles shared design-system pieces so every native screen (Home, Notifications, You) picks up the Reimagined surface language in place.
    const hubKeys = safe(() => Object.keys(unwrap(mod("TableRowGroup", "TableRow")) || {}), []) || [];
    health.hooks.HubExports = hubKeys.join(",").slice(0, 900) || "none";
    const restyle = style => output => isEl(output) && output.props ? React.cloneElement(output, { style: [output.props.style, style()] }) : output;
    const cardStyle = () => { const c = colors(); return { backgroundColor: c.elevated, borderRadius: RAD.large, borderWidth: RN.StyleSheet?.hairlineWidth || 1, borderColor: c.line }; };
    const pillStyle = () => ({ borderRadius: RAD.round });
    const chipStyle = () => { const c = colors(); return { backgroundColor: c.accentSoft, borderRadius: RAD.round }; };
    pass("Card", "nativeScreens", restyle(cardStyle), false, true);
    pass("Button", "nativeScreens", restyle(pillStyle), false, true);
    pass("Chip", "nativeScreens", restyle(chipStyle), false, true);
    pass("SearchField", "nativeSkin", output => SkinFrame ? h(SkinFrame, { fallback: output }, safe(() => skinSearch(output), output)) : output);
    probeSearch();
  }
  function scan() {`);
swap('api.patcher.after(method, object, (_args, output) => { if (!live || output == null || !me() ||', 'api.patcher.after(method, object, (_args, output) => { if (live && cfg("blueprint")) safe(() => recordTabBar(name, _args[0])); if (!live || output == null || !me() ||');
swap('    scan(); syncTheme();', '    scan(); syncTheme(); patchNativeSkin(); patchLayouts();');
// Settings blueprint: records a compact structural sample (component names, prop keys, numeric styles; text lengths only) of the native rows and groups so the skin can be designed from real data.
swap('h(Toggle, { name: "diagnostics", label: "Tap diagnostics" }), button("Copy compatibility report", "report", null, { marginTop: SPACE.lg }, "copy-report"),', 'h(Toggle, { name: "diagnostics", label: "Tap diagnostics" }), button("Copy compatibility report", "report", null, { marginTop: SPACE.lg }, "copy-report"), h(Toggle, { name: "blueprint", label: "Record settings blueprint" }), button("Copy settings blueprint", "blueprint", null, { marginTop: SPACE.sm }, "copy-blueprint"), button("Scan whole app (tour)", "tour", null, { marginTop: SPACE.sm }, "scan-app"), button("Copy screen tree", "tree", null, { marginTop: SPACE.sm }, "copy-tree"),');
swap('else if (action === "report") copyReport();', 'else if (action === "report") copyReport(); else if (action === "blueprint") copyBlueprint(); else if (action === "tour") startTour(); else if (action === "tree") safe(() => copyTree());');
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
  // Walks the mounted React tree from a class instance we own (its _reactInternals is a fiber) and copies an indented outline of composite components, so native screens can be targeted without guessing.
  let treeHost = null; const rowInstances = new Set();
  function copyTree() {
    const c = safe(() => unwrap(api.common.clipboard), null);
    // Candidate fibers come from every class instance we own (docks and conversation rows); unmounted ones keep a detached fiber, so prefer a chain that reaches a HostRoot and otherwise the tallest one.
    let root = null, best = -1;
    const sources = [...presentationHosts, treeHost, ...rowInstances];
    for (const inst of sources) {
      const first = inst?._reactInternals || inst?._reactInternalFiber;
      for (const f of [first, first?.alternate]) {
        let top = f, depth = 0; while (top?.return) { top = top.return; depth++; }
        if (!top) continue;
        const score = (top.tag === 3 ? 1e6 : 0) + depth;
        if (score > best) { best = score; root = top.tag === 3 ? (top.stateNode?.current || top) : top; }
      }
    }
    if (!root) { toast("Tree unavailable (" + sources.length + " sources)"); return; }
    const nameOf = f => { const t = f.type; if (!t || typeof t === "string") return null; if (f.tag === 5 || f.tag === 6) return null; const n = t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name; return (f.tag === 14 || f.tag === 15 ? "memo:" : f.tag === 11 ? "fwd:" : "") + (n || "anonymous"); };
    const lines = [], stack = [[root, 0]]; let count = 0;
    while (stack.length && lines.length < 3500) {
      const [f, d] = stack.pop(); if (!f) continue;
      if (f.sibling) stack.push([f.sibling, d]);
      let nd = d; const n = nameOf(f), p = f.memoizedProps && typeof f.memoizedProps === "object" ? f.memoizedProps : null;
      if (n) {
        const keys = p ? Object.keys(p).slice(0, 8).join(",") : "", tag = p ? [p.testID, p.nativeID, p.accessibilityLabel, p.route?.name].filter(x => typeof x === "string").map(x => x.slice(0, 28)).join("|") : "";
        lines.push(" ".repeat(Math.min(d, 60)) + n + "{" + keys + "}" + (tag ? " #" + tag : "")); nd = d + 1;
      } else if (p && (typeof p.testID === "string" || typeof p.accessibilityLabel === "string")) lines.push(" ".repeat(Math.min(d, 60)) + "·" + (typeof f.type === "string" ? f.type : "host") + " #" + [p.testID, p.accessibilityLabel].filter(x => typeof x === "string").map(x => x.slice(0, 28)).join("|"));
      if (f.child) stack.push([f.child, nd]); count++;
    }
    const text = "reimagined-tree " + VERSION + " route=" + currentRouteName() + " fibers=" + count + "\\n" + lines.join("\\n");
    if (c?.setString) { c.setString(text); toast("Screen tree copied (" + lines.length + " lines)"); }
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
swap('nativeSkinRows: false, blueprint: false', 'nativeSkinRows: false, nativeScreens: false, hideQuestDock: true, blueprint: false');
swap('h(Toggle, { name: "nativeSkinRows", label: "Roomier settings rows (beta)" }),', 'h(Toggle, { name: "nativeSkinRows", label: "Roomier settings rows (beta)" }), h(Toggle, { name: "nativeScreens", label: "Restyle native screens (beta)" }), h(Toggle, { name: "hideQuestDock", label: "Hide Quests dock above the YouBar" }),');
swap('if (value.key === "nativeSkin" || value.key === "nativeSkinRows" || value.key === "blueprint") patchNativeSkin();', 'if (value.key === "nativeSkin" || value.key === "nativeSkinRows" || value.key === "blueprint" || value.key === "nativeScreens") patchNativeSkin();');
swap('cfg("layout") && cfg("startHome") && !autoPresented', 'cfg("layout") && !cfg("nativeScreens") && cfg("startHome") && !autoPresented');
swap('const launch = this.props.mode === "settings" || !me() ? null', 'const launch = this.props.mode === "settings" || !me() || cfg("nativeScreens") ? null');
swap('if (!baseRoute || !cfg("layout")) return;', 'if (!baseRoute || !cfg("layout") || cfg("nativeScreens")) return;');
swap('    push({ screen: "conversation", channel: id }); loadMessages(id);', '    if (cfg("nativeScreens")) { nativeConversation(id); return; }\n    push({ screen: "conversation", channel: id }); loadMessages(id);');
swap('  let SkinFrame;', `  let SkinFrame, NativeHost, NativeOverlay, RowCard, NativeRow, embeddedRoute = null;
  const SCREEN_TAB = { guilds: "home", messages: "messages", notifications: "messages", you: "you" };
  // Diagnostic: lists (in the compatibility report) which navigation-related elements Discord really creates, with their prop names.
  let navProbeCount = 0; const treeSeen = new Set();
  function navProbe(type, props) {
    const name = typeName(type), keys = Object.keys(props);
    const hit = props.route || props.navigation || props.descriptors || props.state || /screen|scene|navigator|stack|route|tab|pager|layout/i.test(name);
    const rn = currentRouteName();
    if (rn && typeof type !== "string" && !/^(Scene|Router|Boundary|DockHost|NativeHost|SkinFrame)/.test(name)) {
      // Only the first route to render a component claims it, so persistent shell parts don't hide what is unique to each screen.
      const ek = "Tree:" + rn, cur = health.hooks[ek] || "", entry = name + "{" + keys.slice(0, 5).join(",") + "}";
      if (cur.length < 1100 && !treeSeen.has(entry)) { treeSeen.add(entry); health.hooks[ek] = cur + (cur ? " " : "") + entry; }
    }
    if (!hit) return;
    const key = "Nav:" + name; if (health.hooks[key] || navProbeCount >= 24) return;
    navProbeCount++;
    health.hooks[key] = "{" + keys.slice(0, 10).join(",") + "}" + (props.route && typeof props.route.name === "string" ? " route=" + props.route.name : "") + (typeof props.children === "function" ? " children=fn" : "");
  }
  function swapScreen(args) {
    const type = args?.[0], props = args?.[1];
    if (props && props.__reimaginedRaw) { const { __reimaginedRaw, ...rest } = props; return [type, rest, ...args.slice(2)]; }
    if (live && cfg("nativeScreens") && props && typeof type !== "string") safe(() => navProbe(type, props));
    // Layout: conversation rows (recognised by their props, since Discord's component names are minified) become spaced cards in place.
    if (live && cfg("nativeScreens") && cfg("nativeRowsBeta") && RowCard && props && typeof type !== "string" && type !== RowCard && props.channelId != null && Object.keys(props).every(k => k === "key" || k === "channelId")) {
      health.hooks.NativeRows = "cards";
      return [RowCard, { ...props, __reimaginedOrig: type }, ...args.slice(2)];
    }
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
swap('    Boundary = class extends React.Component {', `    RowCard = class extends React.Component {
      constructor(p) { super(p); this.state = { failed: false }; }
      componentDidMount() { rowInstances.add(this); }
      componentWillUnmount() { rowInstances.delete(this); }
      componentDidCatch() { issue("native-row-failed"); this.setState({ failed: true }); }
      render() {
        const { __reimaginedOrig: Orig, ...rest } = this.props, raw = h(Orig, { ...rest, __reimaginedRaw: true });
        if (!live || this.state.failed || !cfg("nativeScreens")) return raw;
        return h(NativeRow, { id: rest.channelId, fallback: raw });
      }
    };
    // Discord's conversation/channel row, re-laid out: avatar with presence, name, preview and badge on a soft press-scaled surface. Tap opens the channel natively; long press opens Discord's own channel actions.
    NativeRow = class extends React.Component {
      constructor(p) { super(p); this.scale = RN.Animated ? new RN.Animated.Value(1) : null; this.press = to => this.scale && animated() && safe(() => RN.Animated.spring(this.scale, { toValue: to, speed: 40, bounciness: 6, useNativeDriver: true }).start()); }
      render() {
        const ch = channel(this.props.id);
        if (!ch || ![0, 1, 3, 5, 10, 11, 12].includes(ch.type)) return this.props.fallback;
        const c = colors(), dm = isPrivate(ch), uid = dm && ch.type === 1 ? call(ch, "getRecipientId", [], ch.recipients?.[0]) : null, u = uid ? user(uid) : null;
        const name = dm ? (ch.name || (ch.type === 3 ? (ch.recipients || []).map(id => userName(user(id))).slice(0, 3).join(", ") || "Group DM" : userName(u))) : (ch.name || "channel");
        const isUnread = unread(ch.id), mentions = mentionCount(ch.id), muted = !!call(stores.UserGuildSettingsStore, "isChannelMuted", [ch.guild_id || null, ch.id], false);
        const last = cfg("showPreviews") && dm ? call(call(stores.MessageStore, "getMessages", [ch.id], null), "last", [], null) : null, preview = typeof last?.content === "string" && last.content ? last.content.replace(/\s+/g, " ") : null;
        const status = uid ? call(stores.PresenceStore, "getStatus", [uid], "offline") : null, dot = { online: c.success || "#3BA55D", idle: "#FAA81A", dnd: c.danger || "#ED4245" }[status];
        const size = dm ? 42 : 30;
        const lead = dm ? h(RN.View, null, h(Avatar, { name, uri: u ? imageUrl(u, "user") : null, size }), dot ? h(RN.View, { style: { position: "absolute", right: -1, bottom: -1, width: 14, height: 14, borderRadius: 7, backgroundColor: dot, borderWidth: 3, borderColor: c.bg } }) : null)
          : h(RN.View, { style: { width: size, height: size, borderRadius: RAD.small - 2, backgroundColor: isUnread ? c.accentSoft : c.elevated, alignItems: "center", justifyContent: "center" } }, t(ch.type === 5 ? "\u{1F4E3}" : "#", { fontSize: 15, fontWeight: "700", color: isUnread ? c.accent : c.muted }));
        return h(this.scale ? RN.Animated.View : RN.View, { style: this.scale ? { transform: [{ scale: this.scale }] } : null }, h(RN.Pressable, {
          accessibilityRole: "button", accessibilityLabel: name + (mentions ? ", " + mentions + " mentions" : isUnread ? ", unread" : ""),
          onPressIn: () => this.press(0.97), onPressOut: () => this.press(1),
          onPress: () => { recordTap("native-row"); openChannel(ch.id); },
          onLongPress: () => { recordTap("native-row-menu"); openChannelSheet(ch.id); }, delayLongPress: 320,
          style: ({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: dm ? 58 : 40, marginHorizontal: SPACE.sm, marginVertical: 1, paddingHorizontal: SPACE.md, paddingVertical: dm ? SPACE.sm : 6, borderRadius: RAD.medium, backgroundColor: pressed ? c.elevated : isUnread && dm ? c.surface : "transparent", opacity: muted && !isUnread ? 0.55 : 1 })
        }, lead,
          h(RN.View, { style: { flex: 1, minWidth: 0, marginLeft: SPACE.md } },
            t(name, { fontSize: dm ? TYPE.body : 15, fontWeight: isUnread ? "700" : "500", color: isUnread ? c.ink : dm ? c.ink : c.muted }, { numberOfLines: 1 }),
            preview ? t(preview, { fontSize: TYPE.caption - 1, marginTop: 2, color: isUnread ? c.ink : c.muted }, { numberOfLines: 1 }) : null),
          mentions || isUnread ? h(RN.View, { style: { marginLeft: SPACE.sm } }, h(Badge, { count: mentions, dot: isUnread && !mentions })) : null));
      }
    };
    NativeHost = class extends React.Component {
      constructor(p) { super(p); this.state = { failed: false, tick: 0, width: safe(() => RN.Dimensions.get("window").width, 390) }; this.refresh = () => this.setState(s => ({ tick: s.tick + 1 })); }
      componentDidMount() { listeners.add(this.refresh); this.focusOff = safe(() => this.props.navigation?.addListener?.("focus", () => this.claim()), null); this.claim(true); loadProfile(accountId); }
      componentWillUnmount() { listeners.delete(this.refresh); if (typeof this.focusOff === "function") this.focusOff(); else this.focusOff?.remove?.(); }
      claim(quiet) { const r = this.props.route?.name; if (embeddedRoute === r) return; embeddedRoute = r; state = { ...state, tab: SCREEN_TAB[r] || "home", screen: "main", history: [], menu: null, drawer: false, channel: null }; if (!quiet) emit(); }
      componentDidCatch() { issue("native-screen-failed"); api.storage.nativeScreens = false; this.setState({ failed: true }); }
      render() {
        const { __reimaginedOrig: Orig, ...rest } = this.props;
        if (!live || this.state.failed || !cfg("nativeScreens") || !me()) return h(Orig, { ...rest, __reimaginedRaw: true });
        if (this.state.classic && rest.__out != null) { const c = colors(); return h(RN.View, { style: { flex: 1 } }, rest.__out, h(Control, { id: "you-reimagined", label: "Back to Reimagined", run: () => this.setState({ classic: false }), style: { position: "absolute", top: 58, right: SPACE.lg, paddingHorizontal: SPACE.lg, borderRadius: RAD.round, backgroundColor: c.accentSoft } }, t("Reimagined", { fontSize: TYPE.caption, fontWeight: "700", color: c.accent }))); }
        const c = colors(), Safe = RN.SafeAreaView || RN.View, width = Math.min(this.state.width, 820), mine = embeddedRoute === rest.route?.name, tab = rest.forceTab || (mine ? state.tab : SCREEN_TAB[rest.route?.name]), screen = mine ? state.screen : "main";
        const content = screen === "media" ? h(Media) : screen === "call" ? h(CallScreen) : screen === "edit-profile" ? h(EditProfile) : screen === "preferences" ? h(Preferences) : screen === "profile" ? h(Profile, { id: state.profile }) : screen === "channels" ? h(Channels) : tab === "servers" ? h(Servers, { width }) : tab === "messages" ? h(Messages) : tab === "you" ? h(YouPage, { onClassic: rest.__out != null ? () => { recordTap("you-classic"); this.setState({ classic: true }); } : null }) : h(Home, { width });
        return h(Safe, { testID: "reimagined-native-screen", style: { flex: 1, backgroundColor: c.bg, paddingBottom: rest.overlay ? 0 : 84 } }, h(Boundary, { key: screen + ":" + tab }, h(SkinFrame, { fill: true }, content)), state.drawer && mine ? h(ServerDrawer, { width }) : null);
      }
    };
    // Discord renders one persistent shell for every tab, so there is no per-screen element to swap: the Reimagined content is laid over the shell, above the YouBar's top edge.
    NativeOverlay = class extends React.Component {
      constructor(p) { super(p); this.state = { route: null, win: null, box: null }; this.anchor = null; this.onLayout = () => safe(() => this.anchor?.measureInWindow?.((x, y, w, hh) => this.setState({ box: { x, y, w, h: hh } }))); }
      componentDidMount() { this.poll = setInterval(() => { const r = currentRouteName(); if (r !== this.state.route) this.setState({ route: r }); }, 350); }
      componentWillUnmount() { clearInterval(this.poll); }
      render() {
        const anchor = h(RN.View, { key: "anchor", ref: r => { this.anchor = r; }, onLayout: this.onLayout, pointerEvents: "none", style: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 } });
        const { route, box } = this.state;
        if (!live || !cfg("nativeScreens") || !SCREEN_TAB[route] || !box) return anchor;
        const win = safe(() => RN.Dimensions.get("window"), { width: 390, height: 844 }), top = box.y >= 40 ? box.y : win.height - 84;
        health.hooks.NativeScreens = "overlay " + route;
        const content = h(NativeHost, { route: { name: route }, navigation: safe(() => root(), null), overlay: true, __reimaginedOrig: () => null });
        // The You and Notifications routes are pushed screens that cover the YouBar, so they get a full-screen layer with a way back.
        if (route !== "guilds") {
          const c = colors(), back = () => safe(() => root()?.goBack?.());
          return h(React.Fragment, null, anchor, RN.Modal ? h(RN.Modal, { visible: true, presentationStyle: "fullScreen", animationType: "fade", onRequestClose: back },
            h(RN.View, { testID: "reimagined-native-overlay", style: { flex: 1, backgroundColor: c.bg } }, content,
              h(RN.Pressable, { onPress: back, accessibilityRole: "button", accessibilityLabel: "Back", style: { position: "absolute", bottom: 34, alignSelf: "center", paddingHorizontal: SPACE.xl, paddingVertical: SPACE.md, borderRadius: RAD.round, backgroundColor: c.elevated, borderWidth: 1, borderColor: c.line } }, t("Back", { fontSize: 15, fontWeight: "600", color: c.ink })))) : null);
        }
        return h(React.Fragment, null, anchor, h(RN.View, { testID: "reimagined-native-overlay", pointerEvents: "box-none", style: { position: "absolute", left: -box.x, top: -box.y, width: win.width, height: top, zIndex: 50 } },
          content));
      }
    };
    Boundary = class extends React.Component {`);
// Discovery: screen root elements (props are exactly navigation and route) per route name.
swap('      if (blueprint.search.length >= 8) return;', '      if (props.route && typeof props.route.name === "string" && props.navigation && typeof type !== "string") { const list = blueprint.screenRoots[props.route.name] || (blueprint.screenRoots[props.route.name] = []), sig = name + "|" + Object.keys(props).sort().join(","); if (list.length < 4 && !list.some(x => x.sig === sig)) list.push({ sig, type: name, keys: Object.keys(props).slice(0, 14) }); }\n      if (blueprint.search.length >= 8) return;');
swap('screens: {}, tabBars: {} };', 'screens: {}, screenRoots: {}, tabBars: {} };');
swap('screens: blueprint.screens, tabBars: blueprint.tabBars,', 'screens: blueprint.screens, screenRoots: blueprint.screenRoots, tabBars: blueprint.tabBars,');
// You page rebuilt from Discord's own stores and profile so it carries everything the native You screen shows.
swap('    class EditProfile extends React.Component {', `    // The You page: everything the native You screen exposes (banner, status, badges, Orbs, member since, connections, friends, note, activity,
    // Quests/Shop/Nitro/Settings, account switcher), laid out in the Reimagined language. Anything only Discord can render (activity history, wishlist) opens the native page in place.
    const youStore = name => { youStore.cache = youStore.cache || {}; return youStore.cache[name] || (youStore.cache[name] = safe(() => api.metro.findByStoreName(name), null)); };
    const deepLink = path => { recordTap("you-link:" + path); safe(() => RN.Linking.openURL("discord://-" + path)); };
    const accountSheet = () => { const m = safe(() => api.metro.findByFilePath("modules/main_tabs_v2/native/tabs/you/utils/showYouAccountActionSheet.tsx"), null), fn = m?.showYouAccountActionSheet || m?.default; if (typeof fn !== "function" || safe(() => (fn(), false), true)) send("settings"); };
    const since = id => safe(() => new Date(Number((BigInt(id) >> BigInt(22)) + BigInt(1420070400000))).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }), null);
    const activityArt = a => { const img = a?.assets?.large_image; if (!img) return null; if (img.startsWith("spotify:")) return "https://i.scdn.co/image/" + img.slice(8); if (img.startsWith("mp:")) return "https://media.discordapp.net/" + img.slice(3); return a.application_id ? "https://cdn.discordapp.com/app-assets/" + a.application_id + "/" + img + ".png" : null; };
    const youExtra = {};
    class YouPage extends React.Component {
      constructor(p) { super(p); this.state = { tab: "main" }; }
      componentDidMount() {
        const id = accountId; if (!id || youExtra[id]) return; youExtra[id] = {};
        safe(() => http("get", "/users/" + encodeURIComponent(id) + "/profile").then(p => { youExtra[id] = { ...(p?.user_profile || {}), badges: p?.badges, connectedAccounts: p?.connected_accounts }; if (live) this.setState({ loaded: true }); }, () => { delete youExtra[id]; }));
      }
      render() {
        const c = colors(), id = accountId, u = me(), data = { ...profileFor(id), ...(youExtra[id] || {}) }, name = data._displayName || userName(u);
        const status = call(stores.PresenceStore, "getStatus", [id], "online"), ring = { online: "#3BA55D", idle: "#FAA81A", dnd: "#ED4245" }[status] || c.line;
        const acts = call(stores.PresenceStore, "getActivities", [id], []) || [], custom = acts.find(a => a?.type === 4), others = acts.filter(a => a && a.type !== 4);
        const accentNum = data.accentColor ?? data.accent_color ?? u?.accentColor, banner = imageUrl({ id, banner: data.banner || u?.banner }, "banner"), accent = typeof accentNum === "number" ? "#" + accentNum.toString(16).padStart(6, "0") : c.accentSoft;
        const badges = Array.isArray(data.badges) ? data.badges : [], links = (data.connectedAccounts || data.connected_accounts || []).filter(x => x && x.name);
        const rel = call(stores.RelationshipStore, "getFriendIDs", [], null) || Object.entries(call(stores.RelationshipStore, "getRelationships", [], {}) || {}).filter(([, v]) => v === 1 || v?.type === 1).map(([k]) => k);
        const vc = youStore("VirtualCurrencyStore"), orbs = call(vc, "getCurrentBalance", [], null) ?? vc?.balance, note = call(youStore("NoteStore"), "getNote", [id], null)?.note;
        const card = (children, extra) => h(RN.View, { style: [{ backgroundColor: c.surface, borderRadius: RAD.large, padding: SPACE.lg, marginBottom: SPACE.md }, extra] }, children);
        const label = s => t(s, { fontSize: TYPE.small, fontWeight: "700", letterSpacing: 0.8, color: c.muted, marginBottom: SPACE.sm });
        const tile = (icon, text, run, key) => h(Control, { key, id: "you-" + key, label: text, run, style: { flex: 1, paddingVertical: SPACE.md, borderRadius: RAD.medium, backgroundColor: c.surface, marginHorizontal: 3 } }, h(Icon, { name: icon, size: 22, color: c.ink }), t(text, { fontSize: TYPE.small, fontWeight: "600", marginTop: SPACE.xs }));
        const seg = ["main", "activity"].map(k => h(Control, { key: k, id: "you-tab-" + k, label: k, selected: this.state.tab === k, run: () => { if (animated()) safe(() => RN.LayoutAnimation.configureNext(RN.LayoutAnimation.Presets.easeInEaseOut)); this.setState({ tab: k }); }, style: { flex: 1, borderRadius: RAD.round, backgroundColor: this.state.tab === k ? c.elevated : "transparent" } }, t(k === "main" ? "Main" : "Activity", { fontSize: TYPE.caption, fontWeight: "700", color: this.state.tab === k ? c.ink : c.muted })));
        const main = [
          orbs != null ? card(h(RN.View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" } }, t("Orbs Balance", { fontWeight: "600" }), h(RN.View, { style: { paddingHorizontal: SPACE.md, paddingVertical: 6, borderRadius: RAD.round, backgroundColor: c.elevated } }, t(String(orbs), { fontWeight: "700" }))), null) : null,
          data.bio ? card([label("ABOUT ME"), h(MessageText, { key: "bio", content: data.bio })]) : null,
          card([label("MEMBER SINCE"), t(since(id) || "Unknown", { key: "d", fontSize: TYPE.body })]),
          links.length ? card([label("CONNECTIONS"), ...links.map((l, i) => h(RN.View, { key: "l" + i, style: { flexDirection: "row", alignItems: "center", paddingVertical: 6 } }, h(RN.View, { style: { paddingHorizontal: SPACE.sm, paddingVertical: 2, borderRadius: RAD.small - 4, backgroundColor: c.elevated, marginRight: SPACE.md } }, t(String(l.type || "").toUpperCase(), { fontSize: 10, fontWeight: "700", color: c.muted })), t(l.name + (l.verified ? "  \\u2713" : ""), { flex: 1, fontWeight: "600" }, { numberOfLines: 1 })))]) : null,
          card(h(RN.View, { style: { flexDirection: "row", alignItems: "center" } }, h(RN.View, { style: { flex: 1 } }, t("Friends", { fontWeight: "600" }), t(rel.length + " friends", { fontSize: TYPE.caption, color: c.muted, marginTop: 2 })), h(RN.View, { style: { flexDirection: "row" } }, ...rel.slice(0, 5).map((fid, i) => h(RN.View, { key: fid, style: { marginLeft: i ? -10 : 0, borderRadius: 16, borderWidth: 2, borderColor: c.surface } }, h(Avatar, { name: userName(user(fid)), uri: imageUrl(user(fid), "user"), size: 28 })))))),
          card([label("NOTE (ONLY VISIBLE TO YOU)"), t(note || "No note yet.", { key: "n", color: note ? c.ink : c.muted })])
        ];
        const activity = [
          others.length ? others.map((a, i) => card(h(RN.View, { style: { flexDirection: "row", alignItems: "center" } }, activityArt(a) ? h(RN.Image, { source: { uri: activityArt(a) }, style: { width: 56, height: 56, borderRadius: RAD.small, marginRight: SPACE.md } }) : null,
            h(RN.View, { style: { flex: 1, minWidth: 0 } }, t(({ 0: "Playing", 1: "Streaming", 2: "Listening to", 3: "Watching", 5: "Competing in" }[a.type] || "") + " " + (a.name || ""), { fontSize: TYPE.small, fontWeight: "700", color: c.muted }, { numberOfLines: 1 }), a.details ? t(a.details, { fontWeight: "600", marginTop: 2 }, { numberOfLines: 1 }) : null, a.state ? t(a.state, { fontSize: TYPE.caption, color: c.muted }, { numberOfLines: 1 }) : null)), { key: "a" + i })) : card(t("Nothing happening right now.", { color: c.muted })),
          this.props.onClassic ? h(Control, { key: "classic", id: "you-history", label: "Recent activity and wishlist", run: this.props.onClassic, style: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg, borderRadius: RAD.large, backgroundColor: c.surface } }, t("Recent activity and wishlist", { fontWeight: "600" }), h(Icon, { name: "ArrowSmallRightIcon", size: 18 })) : null
        ];
        return h(Page, { title: "You", right: ib("SettingsIcon", "Settings", "settings", null, "profile-settings") },
          h(RN.View, { style: { borderRadius: RAD.sheet, overflow: "hidden", backgroundColor: c.surface, marginBottom: SPACE.lg } },
            banner ? h(RN.Image, { source: { uri: banner }, resizeMode: "cover", style: { height: 120, width: "100%" } }) : h(RN.View, { style: { height: 120, backgroundColor: accent } }),
            h(RN.View, { style: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg } },
              h(RN.View, { style: { flexDirection: "row", alignItems: "flex-end", marginTop: -44 } },
                h(RN.View, { style: { borderRadius: 50, borderWidth: 4, borderColor: c.surface } }, h(RN.View, { style: { borderRadius: 46, borderWidth: 3, borderColor: ring } }, h(Avatar, { name, uri: imageUrl(u, "user"), size: 80 }))),
                h(Control, { id: "you-status", label: "Set status", run: accountSheet, style: { flex: 1, marginLeft: SPACE.md, marginBottom: SPACE.sm, alignItems: "flex-start", paddingHorizontal: SPACE.md, borderRadius: RAD.medium, backgroundColor: c.elevated } }, t(custom ? ((custom.emoji?.name && !custom.emoji.id ? custom.emoji.name + " " : "") + (custom.state || "")) : "Set a status", { fontSize: TYPE.caption, fontStyle: custom ? "normal" : "italic", color: custom ? c.ink : c.muted }, { numberOfLines: 2 }))),
              h(Control, { id: "you-account", label: "Switch account or status", run: accountSheet, style: { flexDirection: "row", justifyContent: "flex-start", marginTop: SPACE.md, minHeight: 36 } }, t(name, { fontSize: TYPE.section, fontWeight: "800", letterSpacing: -0.4 }, { numberOfLines: 1 }), t("  \\u25BE", { color: c.muted, fontSize: TYPE.body })),
              h(RN.View, { style: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" } }, t(u?.username || "", { color: c.muted }), data.pronouns ? t("  \\u00B7  " + data.pronouns, { color: c.muted }) : null,
                badges.length ? h(RN.View, { style: { flexDirection: "row", marginLeft: SPACE.sm, paddingHorizontal: 6, paddingVertical: 3, borderRadius: RAD.small - 4, backgroundColor: c.elevated } }, ...badges.slice(0, 10).map(b => h(RN.Image, { key: b.id, accessibilityLabel: b.description, source: { uri: "https://cdn.discordapp.com/badge-icons/" + b.icon + ".png" }, style: { width: 18, height: 18, marginHorizontal: 2 } }))) : null),
              h(RN.View, { style: { flexDirection: "row", marginTop: SPACE.lg } },
                button("Edit Profile", "edit-profile", null, { flex: 1, backgroundColor: c.accent, marginRight: SPACE.sm }, "edit-profile"),
                button("Avatar & Banner", "settings", "profile", { flex: 1 }, "avatar-settings")))),
          h(RN.View, { style: { flexDirection: "row", marginHorizontal: -3, marginBottom: SPACE.lg } }, tile("QuestsIcon", "Quests", () => deepLink("/quest-home"), "quests"), tile("ShopIcon", "Shop", () => deepLink("/shop"), "shop"), tile("NitroWheelIcon", "Nitro", () => deepLink("/store"), "nitro"), tile("SettingsIcon", "Settings", () => send("settings"), "settings")),
          h(RN.View, { style: { flexDirection: "row", padding: 4, borderRadius: RAD.round, backgroundColor: c.surface, marginBottom: SPACE.lg } }, ...seg),
          ...(this.state.tab === "main" ? main : activity));
      }
    }
    class EditProfile extends React.Component {`);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.js'), code);
fs.copyFileSync(path.join(base, 'LICENSE'), path.join(out, 'LICENSE'));
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
  name: 'Discord: Reimagined (0.2 Preview)', version: '0.2.0-alpha.35',
  description: '0.2 features with acknowledged route presentation, modal fallback and preserved original navigation. Device verification pending.',
  authors: [{ name: 'expensiverest' }], main: 'index.js', hash: digest(code), distra: { spec: 1 }
}, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'README.md'), `# Discord: Reimagined 0.2.0-alpha.35

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

Appearance > Reimagined inside native screens (beta) redesigns Discord's own Messages, Notifications and server rail in place: DM rows become taller floating cards with larger avatars and an accent edge when unread (the cell height is enlarged through Discord's own getMessagesItemChannelSizes so the list stays measured correctly), notifications become cards with Reimagined section headers, and the server rail becomes a floating panel with pill separators. It also replaces the You tab with a Reimagined You page: banner, presence ring, custom status and account switcher, badges, Edit Profile, Quests/Shop/Nitro/Settings, Orbs, member since, connections, friends, note and current activity, plus a button that shows Discord's own You page in place for activity history and wishlist (the YouBar and native navigation stay). Appearance > Hide Quests dock above the YouBar (on by default) removes the floating Quests dock; it needs an app restart to take effect and falls back to the original screen on any error. Preferences > Scan whole app (tour) visits the sibling screens of the screen you are on (names that look parameter-dependent are skipped, and a route that crashed is remembered and skipped next time), records a component census, then returns; copy the settings blueprint afterwards. Appearance > Restyle Discord settings (beta) restyles Discord's own settings lists in place (a fade-and-rise entrance; Discord's own card styling is left untouched) by patching the design-system TableRowGroup. It is off by default, needs no tweak, and switches itself off if a restyled list fails to render. The settings search bar (the design hub's SearchField) is wrapped in a rounded frame with an accent hairline (unclipped, so the focus ring stays whole). Appearance > Roomier settings rows (beta) restyles each TableRow (taller, translucent icon tiles, accent-tinted selected radio rows); the group skin adds a rounded hairline-bordered card with small-caps section titles. Appearance > Record settings blueprint, then Copy settings blueprint, captures a text-free structural sample (component names, prop keys, numeric styles) of the rows and groups on each screen you visit so the skin can be designed from real data. Check the compatibility report for NativeSkinTableRowGroup and NativeSkinTableRow.

## Validation

Presenter tests and synthetic plugin lifecycle integration checks run in the Reimagined Repair workflow before publication. No physical iOS/Hermes/Yoga test or real Discord service action is claimed. See scripts/reimagined/ for the reproducible build and tests.

The installer SHA-256 covers the exact source bytes. Runtime has no remote code loader. GPL-3.0-only.
`);
console.log(JSON.stringify({ version: '0.2.0-alpha.35', sourceSHA256: digest(code), output: out }));
