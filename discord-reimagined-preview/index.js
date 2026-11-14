(() => {
  "use strict";
  /* Discord: Reimagined - 0.2.0-alpha.21 - GPL-3.0-only
   * Additive successor to index.js (0.1.0-alpha.1, retained for rollback).
   * Native operations stay inside Discord's authenticated modules. No token access.
   * Hallmark: existing graphite/sage system preserved; no new display chrome.
   */
  const VERSION = "0.2.0-alpha.21", THEME_ID = "discord-reimagined";
  const DEFAULTS = { palette: "blurple", density: "comfortable", nativePalette: true,
    startHome: true, diagnostics: false, reduceMotion: false, layout: true,
    showPreviews: true, grid: true, nativeSkin: false, nativeSkinRows: false, nativeScreens: false, blueprint: false, accounts: {} };
  const PALETTES = {
    blurple: { name: "Blurple", bg: "#17181f", surface: "#20222b", elevated: "#2b2d38", line: "#3a3d4b", ink: "#f2f3f8", muted: "#b0b4c4", faint: "#9296a9", accent: "#b4bcff", accentInk: "#1d2160", accentSoft: "#30346a", danger: "#f5a9b3", clear: "transparent", shade: "rgba(8,9,14,0.62)" },
    midnight: { name: "Midnight", bg: "#141918", surface: "#1c2320", elevated: "#27302b", line: "#39443d", ink: "#f0f2e9", muted: "#a8b5aa", faint: "#8a9b8e", accent: "#bdd7b7", accentInk: "#203323", accentSoft: "#2d3b2e", danger: "#f3b9ad", clear: "transparent", shade: "rgba(10,15,12,0.6)" },
    pearl: { name: "Pearl", bg: "#f4f3ed", surface: "#fcfbf6", elevated: "#e8ece2", line: "#c8d0c4", ink: "#242d27", muted: "#536455", faint: "#637365", accent: "#3b6345", accentInk: "#f5f8ef", accentSoft: "#dce7d5", danger: "#9b3930", clear: "transparent", shade: "rgba(10,15,12,0.45)" },
    slate: { name: "Slate", bg: "#171b22", surface: "#20262e", elevated: "#2c3540", line: "#414f5d", ink: "#edf0f3", muted: "#acb8c4", faint: "#90a1b1", accent: "#b8cfe7", accentInk: "#25354a", accentSoft: "#2d3e50", danger: "#f1b5ba", clear: "transparent", shade: "rgba(10,14,20,0.6)" }
  };
  const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 };
  const TYPE = { small: 12, caption: 14, body: 16, title: 20, section: 24, display: 34 };
  const RAD = { small: 12, medium: 18, large: 24, sheet: 30, round: 999 };
  const animated = () => !!RN.Animated && !cfg("reduceMotion");
  const NAV = [ { id: "home", label: "Home", icon: "HomeIcon" }, { id: "servers", label: "Servers", icon: "SquaresIcon" },
    { id: "messages", label: "Messages", icon: "ChatIcon" }, { id: "you", label: "You", icon: "UserCircleIcon" } ];
  const GLYPHS = { HomeIcon: "\u2302", SquaresIcon: "\u25a6", ChatIcon: "\u25a1", UserCircleIcon: "\u25cb", SearchIcon: "\u2315", StarIcon: "\u2606", BackIcon: "\u2039", CloseIcon: "\u00d7", SettingsIcon: "\u2699", HashIcon: "#", VoiceIcon: "\u266a", SendIcon: "\u2191", MoreIcon: "\u2026", PlusIcon: "+", ImageIcon: "\u25a7", MuteIcon: "M", DeafIcon: "D", VideoIcon: "\u25b7" };
  let api, React, RN, h, Control, Scene, DockHost, Boundary, Page;
  let presenter = null, modalOwner = null, activeSceneNavigation = null, presentationInstance = "";
  const presentationHosts = new Set();
  const makePresenter = function createPresenter(env) {
  let mode = 'idle', ticket = 0, requested = false, closed = false;
  let timer = null, afterDismiss = null;
  const later = env.setTimeout || setTimeout;
  const cancel = env.clearTimeout || clearTimeout;
  const delay = env.timeout || 1400;
  const notify = () => { if (!closed) env.changed(); };
  function clear() { if (timer !== null) cancel(timer); timer = null; }
  function schedule(fn, ms) { clear(); timer = later(() => { timer = null; if (!closed) fn(); }, ms); }
  function fail(code) {
    clear(); requested = false; mode = 'idle'; afterDismiss = null;
    env.issue(code); notify();
  }
  function fallback(id, code) {
    if (closed || !requested || id !== ticket) return;
    env.issue(code); clear();
    if (!env.canModal()) return fail('presenter:no-fallback-host');
    mode = 'modal-opening'; notify();
    schedule(() => { if (id === ticket && mode === 'modal-opening') fail('presenter:modal-not-shown'); }, delay);
  }
  function tryRoute(id, attempt) {
    if (closed || !requested || id !== ticket) return;
    const nav = env.root();
    if (!nav || (typeof nav.isReady === 'function' && !nav.isReady())) {
      if (attempt < 4) return schedule(() => tryRoute(id, attempt + 1), 150);
      return fallback(id, 'presenter:navigator-not-ready');
    }
    // Only use a route actually declared by an observed navigator. No guessed
    // nested navigation. Unmounted/lazy settings routes use the proven Modal path.
    const path = env.routePath(nav);
    if (!path || !path.length || typeof nav.navigate !== 'function') return fallback(id, 'presenter:route-not-registered');
    mode = 'route-opening';
    // Arm BEFORE navigate: a renderer may acknowledge synchronously in a test.
    schedule(() => { if (id === ticket && mode === 'route-opening') fallback(id, 'presenter:route-not-visible'); }, delay);
    try { env.navigate(nav, path, id); }
    catch (_) { fallback(id, 'presenter:route-threw'); }
  }
  return {
    snapshot() { return { mode, ticket, requested, ready: mode === 'route' || mode === 'modal', modal: mode === 'modal-opening' || mode === 'modal' }; },
    open() {
      if (closed) return;
      if (requested && (mode === 'modal' || mode === 'modal-opening' || mode === 'route-opening' || mode === 'waiting')) return notify();
      if (requested && mode === 'route' && env.focused(ticket)) return notify();
      clear(); afterDismiss = null; requested = true; ticket++; mode = 'waiting';
      notify(); tryRoute(ticket, 0);
    },
    acceptsRoute(id) { return !closed && requested && id === ticket && (mode === 'route-opening' || mode === 'route'); },
    routeReady(id, focused, width, height) {
      if (closed || !requested || id !== ticket || mode !== 'route-opening' || !focused || !(width > 0 && height > 0)) return false;
      clear(); mode = 'route'; notify(); return true;
    },
    modalShown(id) {
      if (closed || !requested || id !== ticket || mode !== 'modal-opening') return false;
      clear(); mode = 'modal'; notify(); return true;
    },
    routeUnmounted(id) {
      if (closed || id !== ticket || !['route', 'route-opening'].includes(mode)) return;
      clear(); requested = false; mode = 'idle'; notify();
    },
    hostLost() {
      if (['modal', 'modal-opening'].includes(mode) && !env.canModal()) fail('presenter:modal-host-unmounted');
    },
    dismiss(action, leaveRoute) {
      if (closed) return;
      clear(); const previous = mode, previousTicket = ticket; requested = false;
      if (previous === 'modal' || previous === 'modal-opening') {
        mode = 'dismissing'; afterDismiss = typeof action === 'function' ? action : null; notify();
        // Never open native Settings beneath an undismissed iOS Modal.
        schedule(() => { if (mode === 'dismissing') fail('presenter:dismiss-not-confirmed'); }, delay);
      } else {
        mode = 'idle'; ticket++; afterDismiss = null;
        if (leaveRoute && (previous === 'route' || previous === 'route-opening')) env.leaveRoute(previousTicket);
        notify(); if (typeof action === 'function' && !closed) action();
      }
    },
    modalDismissed(id) {
      if (closed || id !== ticket || mode !== 'dismissing') return;
      clear(); const action = afterDismiss; afterDismiss = null; mode = 'idle'; ticket++; notify();
      if (action && !closed) action();
    },
    stop() {
      if (closed) return;
      clear(); const previous = mode, previousTicket = ticket;
      requested = false; afterDismiss = null; mode = 'stopped'; ticket++; closed = true;
      if (previous === 'route' || previous === 'route-opening') env.leaveRoute(previousTicket);
    }
  };
};
  let live = false, epoch = 0, accountId = null, autoPresented = false, sceneCount = 0, routeOpening = false;
  let storeTimer = null, stops = [], targets = new WeakMap(), themeBackup = null, ownsTheme = false, themeQueue = Promise.resolve();
  const listeners = new Set(), stores = {}, modules = {}, assets = new Map();
  // Sensitive content is session-memory only. It is wiped on stop/account change.
  const conversations = new Map(), drafts = new Map(), profiles = new Map();
  let state = { tab: "home", screen: "main", guild: null, channel: null, profile: null, media: null,
    search: "", filter: "all", limit: 60, drawer: false, menu: null, history: [] };
  const health = { hooks: {}, stores: {}, capabilities: {}, issues: [], taps: [], frames: {} };
  const safe = (fn, fallback) => { try { const v = fn(); return v == null ? fallback : v; } catch (_) { return fallback; } };
  function unwrap(v) { for (let i = 0; v != null && i < 5; i++) { const f = safe(() => v[Symbol.for("distra.lazy")], null); if (typeof f !== "function") break; const next = f(); if (next === v) break; v = next; } return v; }
  const cfg = k => api?.storage[k] !== undefined ? api.storage[k] : DEFAULTS[k];
  const colors = () => PALETTES[cfg("palette")] || PALETTES.midnight;
  function emit() { if (live) Array.from(listeners).forEach(f => safe(f)); }
  function issue(code) { if (!health.issues.includes(code)) health.issues = health.issues.concat(code).slice(-24); safe(() => api.logger.warn("Reimagined: " + code)); }
  function toast(s) { safe(() => api.toasts.showToast(s)); }
  function store(name) { if (!stores[name]) stores[name] = safe(() => unwrap(api.metro.findByStoreName(name)), null); health.stores[name] = !!stores[name]; return stores[name]; }
  function mod(...keys) { const id = keys.join("|"); if (!modules[id]) modules[id] = safe(() => unwrap(api.metro.findByProps(...keys)), null); return modules[id]; }
  function call(o, method, args, fallback) { return safe(() => typeof o?.[method] === "function" ? o[method](...(args || [])) : fallback, fallback); }
  const me = () => call(stores.UserStore, "getCurrentUser", [], null);
  const root = () => safe(() => unwrap(api.common.tabsNavigationRef).getRootNavigationRef(), null);
  const userName = u => u?.globalName || u?.global_name || u?.username || "Unknown User";
  const channel = id => call(stores.ChannelStore, "getChannel", [id], null);
  const user = id => call(stores.UserStore, "getUser", [id], null);
  const unread = id => !!call(stores.ReadStateStore, "hasUnread", [id], false);
  const mentionCount = id => Math.max(0, Number(call(stores.ReadStateStore, "getMentionCount", [id], 0)) || 0);
  const isPrivate = c => c?.type === 1 || c?.type === 3;
  function checkAccount() {
    const id = me()?.id || null;
    if (id !== accountId) { if (presenter) presenter.dismiss(null, true); accountId = id; epoch++; conversations.clear(); drafts.clear(); profiles.clear(); state = { ...state, screen: "main", tab: "home", channel: null, guild: null, media: null, profile: null, menu: null, history: [], search: "" }; }
  }
  function changed() { checkAccount(); if (!storeTimer && live) storeTimer = setTimeout(() => { storeTimer = null; emit(); }, 60); }
  function account() {
    if (!accountId) return { pins: [], recent: [] };
    if (!api.storage.accounts || Array.isArray(api.storage.accounts)) api.storage.accounts = {};
    if (!api.storage.accounts[accountId]) api.storage.accounts[accountId] = { pins: [], recent: [] };
    const a = api.storage.accounts[accountId]; if (!Array.isArray(a.pins)) a.pins = []; if (!Array.isArray(a.recent)) a.recent = []; return a;
  }
  const pinned = (kind, id) => account().pins.some(p => p.kind === kind && p.id === id);
  function pin(kind, id, guildId) { if (!accountId) return; const a = account(); a.pins = pinned(kind, id) ? a.pins.filter(p => !(p.kind === kind && p.id === id)) : a.pins.concat({ kind, id, guildId: guildId || null }).slice(-80); emit(); }
  function remember(kind, id, guildId) { if (!accountId) return; const a = account(); a.recent = [{ kind, id, guildId: guildId || null }, ...a.recent.filter(p => !(p.kind === kind && p.id === id))].slice(0, 18); }
  function guilds() {
    const list = Object.values(call(stores.GuildStore, "getGuilds", [], {})).filter(g => g?.id && typeof g.name === "string");
    const ids = []; const walk = nodes => (Array.isArray(nodes) ? nodes : []).forEach(n => Array.isArray(n?.children) ? walk(n.children) : n?.id && ids.push(String(n.id)));
    walk(call(stores.SortedGuildStore, "getGuildsTree", [], null)?.root?.children);
    const rank = new Map(ids.map((id, i) => [id, i]));
    return list.sort((a, b) => (rank.get(a.id) ?? 100000) - (rank.get(b.id) ?? 100000) || a.name.localeCompare(b.name));
  }
  function listDms() {
    let items = call(stores.PrivateChannelSortStore, "getPrivateChannelIds", [], null);
    if (!Array.isArray(items)) items = call(stores.ChannelStore, "getSortedPrivateChannels", [], null);
    if (!Array.isArray(items)) items = Object.values(call(stores.ChannelStore, "getMutablePrivateChannels", [], {}));
    if (!items.length) items = call(stores.PrivateChannelReadStateStore, "getUnreadPrivateChannelIds", [], []);
    const seen = new Set();
    return items.map(v => typeof v === "string" ? channel(v) : v?.channel || v).filter(c => c?.id && isPrivate(c) && !seen.has(c.id) && seen.add(c.id))
      .filter(c => c.type === 3 || !call(stores.RelationshipStore, "isBlocked", [call(c, "getRecipientId", [], c.recipients?.[0])], false))
      .map(c => { const u = user(call(c, "getRecipientId", [], c.recipients?.[0])); const cached = call(stores.MessageStore, "getMessages", [c.id], null); const last = call(cached, "last", [], null);
        return { id: c.id, channel: c, user: u, name: c.name || (c.type === 3 ? (c.recipients || []).map(id => userName(user(id))).slice(0, 3).join(", ") || "Group DM" : userName(u)), unread: unread(c.id), mentions: mentionCount(c.id), preview: cfg("showPreviews") && typeof last?.content === "string" ? last.content.replace(/\s+/g, " ").slice(0, 140) : "" }; });
  }
  function permission(name, c) {
    if (!c || !accountId) return false;
    if (isPrivate(c)) return name === "VIEW_CHANNEL" || name === "SEND_MESSAGES" || name === "CONNECT";
    const p = safe(() => unwrap(api.common.constants).Permissions?.[name], null);
    return p != null && call(stores.PermissionStore, "can", [p, c], false) === true;
  }
  function channels(guildId) {
    const groups = call(stores.GuildChannelStore, "getChannels", [guildId], null); if (!groups) return null;
    const map = new Map(); function walk(v, d) { if (!v || d > 5) return; if (Array.isArray(v)) v.forEach(x => walk(x, d + 1)); else if (v.channel) walk(v.channel, d + 1); else if (v.id && typeof v.type === "number") map.set(v.id, v); else if (typeof v === "object") Object.values(v).forEach(x => walk(x, d + 1)); } walk(groups, 0);
    return Array.from(map.values()).filter(c => c.guild_id === guildId && c.type !== 4 && permission("VIEW_CHANNEL", c)).sort((a, b) => (a.position || 0) - (b.position || 0));
  }
  function imageUrl(item, kind) {
    if (kind === "guild" && item?.icon) return "https://cdn.discordapp.com/icons/" + encodeURIComponent(item.id) + "/" + encodeURIComponent(item.icon) + ".png?size=256";
    if (kind === "banner" && item?.banner) return "https://cdn.discordapp.com/banners/" + encodeURIComponent(item.id) + "/" + encodeURIComponent(item.banner) + ".png?size=1024";
    if (kind === "user") return call(mod("getUserAvatarURL"), "getUserAvatarURL", [item, false, 256], null);
    return null;
  }
  function asset(name) { if (assets.has(name)) return assets.get(name); const aliases = { SquaresIcon: ["SquaresIcon", "AppsIcon"], SearchIcon: ["MagnifyingGlassIcon", "SearchIcon"], BackIcon: ["ChevronSmallLeftIcon"], CloseIcon: ["XSmallIcon"], VoiceIcon: ["CallIcon", "SpeakerIcon"], SendIcon: ["ArrowLargeUpIcon"], MoreIcon: ["MoreHorizontalIcon"], PlusIcon: ["PlusSmallIcon"], MuteIcon: ["MicrophoneIcon"], DeafIcon: ["HeadphonesIcon"], VideoIcon: ["VideoIcon"] }; const f = safe(() => globalThis.vendetta?.ui?.assets?.getAssetIDByName, null); const id = typeof f === "function" ? (aliases[name] || [name]).map(n => safe(() => f(n), null)).find(v => typeof v === "number") : null; if (id != null) assets.set(name, id); return id; }
  function report() { return { product: "Discord: Reimagined", version: VERSION, verification: "UI / service mocks only; native integration pending", hooks: { ...health.hooks }, stores: { ...health.stores }, capabilities: { ...health.capabilities }, issues: health.issues.slice(), taps: health.taps.slice(), frames: { ...health.frames }, screen: state.screen, presentation: presenter ? presenter.snapshot() : null }; }
  function copyReport() { const c = safe(() => unwrap(api.common.clipboard), null); if (c?.setString) { c.setString(JSON.stringify(report(), null, 2)); toast("Compatibility report copied"); } }
  function recordTap(id) { health.taps = health.taps.concat(String(id || "control").replace(/\d{5,}/g, "<id>")).slice(-12); if (cfg("diagnostics")) toast("Reimagined: " + String(id).split(":")[0]); }
  function routeState(nav) { return safe(() => nav.getRootState?.() || nav.getState?.(), null); }
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
    stopReturnWatch(); api.storage.layout = false;
    autoPresented = true;
    presenter?.dismiss(null, true); emit();
  }
  let baseRoute = null, returnTimer = null;
  const customRouteName = "DISTRA_CUSTOM_PAGE";
  const currentRouteName = () => safe(() => { const r = root(); return (r.getCurrentRoute?.() || null)?.name || null; }, null);
  function stopReturnWatch() { if (returnTimer !== null) clearTimeout(returnTimer); returnTimer = null; }
  function watchReturn() {
    stopReturnWatch();
    if (!baseRoute || !cfg("layout") || cfg("nativeScreens")) return;
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
  function nativeConversation(id) {
    const c = channel(id); if (!permission("VIEW_CHANNEL", c)) return toast("You cannot open this channel.");
    presenter.dismiss(() => {
      if (!live) return;
      watchReturn();
      try {
        if (isPrivate(c)) { const a = mod("selectPrivateChannel"); if (!a?.selectPrivateChannel) throw new Error("Unavailable"); a.selectPrivateChannel(id); }
        else { const a = mod("transitionToGuild"); if (!a?.transitionToGuild) throw new Error("Unavailable"); a.transitionToGuild(c.guild_id, id); }
      } catch (_) { toast("Use Discord's original navigation to open this conversation."); }
    }, true);
  }
  function nativeSettings(profile) {
    const invoke = () => {
      if (!live) return;
      if (!(presenter.snapshot().mode === "route")) watchReturn();
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
    stopReturnWatch(); { const n = currentRouteName(); if (n && n !== customRouteName) baseRoute = n; }
    if (tab) state = { ...state, tab, screen: "main", guild: null, channel: null, search: "", history: [], menu: null };
    presenter.open(); emit();
  }
  function push(next) { state = { ...state, ...next, menu: null, history: state.history.concat({ ...state, history: undefined, menu: null, media: null }).slice(-12) }; emit(); }
  function back() { if (state.drawer) { state.drawer = false; emit(); return; } if (state.menu) { state.menu = null; emit(); return; } const history = state.history.slice(); const last = history.pop(); if (last) state = { ...last, history }; else state = { ...state, screen: "main", channel: null, guild: null, media: null, search: "", drawer: false }; emit(); }
  function openChannel(id) {
    const c = channel(id); if (!permission("VIEW_CHANNEL", c)) return toast("You cannot view this channel.");
    if (c.nsfw) return toast("Use Discord to complete this channel's access check.");
    if ([2, 13].includes(c.type)) { push({ screen: "call", channel: id }); return; }
    if ([15, 16].includes(c.type)) { toast("Opening this forum in Discord. Use Return to Reimagined to come back."); nativeConversation(id); return; }
    remember(isPrivate(c) ? "dm" : "channel", id, c.guild_id);
    if (cfg("nativeScreens")) { nativeConversation(id); return; }
    push({ screen: "conversation", channel: id }); loadMessages(id);
  }
  function send(action, value) {
    if (!live) return;
    if (action === "tab") { if (!NAV.some(n => n.id === value)) return; if (animated()) safe(() => RN.LayoutAnimation.configureNext(RN.LayoutAnimation.Presets.easeInEaseOut)); state = { ...state, tab: value, screen: "main", guild: null, channel: null, search: "", filter: "all", history: [], drawer: false, menu: null }; present(); emit(); }
    else if (action === "server") { remember("guild", value); state.drawer = false; push({ screen: "channels", tab: "servers", guild: value, search: "" }); }
    else if (action === "channel") openChannel(value);
    else if (action === "back") back();
    else if (action === "settings") nativeSettings(value === "profile");
    else if (action === "preferences") push({ screen: "preferences" });
    else if (action === "profile") { push({ screen: "profile", profile: value }); loadProfile(value); }
    else if (action === "edit-profile") push({ screen: "edit-profile", profile: accountId });
    else if (action === "search") { state.search = String(value || ""); state.limit = 60; emit(); }
    else if (action === "filter") { state.filter = value; emit(); }
    else if (action === "drawer") { state.drawer = true; present(); emit(); }
    else if (action === "drawer-close") { state.drawer = false; emit(); }
    else if (action === "expand") { state = { ...state, drawer: false, tab: "servers", screen: "main", search: "", filter: "all" }; emit(); }
    else if (action === "pin") pin(value.kind, value.id, value.guildId);
    else if (action === "setting") { api.storage[value.key] = value.value; if (value.key === "layout" && !value.value) presenter.dismiss(null, true); if (["palette", "nativePalette"].includes(value.key)) syncTheme(); if (value.key === "nativeSkin" || value.key === "nativeSkinRows" || value.key === "blueprint" || value.key === "nativeScreens") patchNativeSkin(); emit(); }
    else if (action === "media") push({ screen: "media", media: value });
    else if (action === "report") copyReport(); else if (action === "blueprint") copyBlueprint(); else if (action === "tour") startTour();
    else if (action === "close") { presenter.dismiss(null, true); }
    else if (action === "restore") restoreOriginal();
    else if (action === "more") { state.limit += 60; emit(); }
  }
  function explain(e) { return typeof e?.body?.message === "string" ? e.body.message : typeof e?.message === "string" ? e.message : "Discord rejected this action. Try again from the original app."; }
  async function http(method, path, body, query) {
    const client = mod("getAPIBaseURL", "get"); health.capabilities.http = !!client;
    if (typeof client?.[method] !== "function") throw new Error("Discord's authenticated request module is unavailable.");
    const response = await client[method]({ url: path, body, query, oldFormErrors: true });
    if (response?.ok === false || response?.status >= 400) throw response;
    return response?.body ?? response;
  }
  function conv(id) { if (!conversations.has(id)) { if (conversations.size >= 25) conversations.delete(conversations.keys().next().value); conversations.set(id, { items: [], busy: false, error: null, hasMore: true, fetched: false, pending: null, deleted: new Set() }); } return conversations.get(id); }
  function mergeMessages(id, additions) {
    const c = conv(id), map = new Map(c.items.map(m => [m.id, m]));
    (additions || []).forEach(m => { if (m?.id && !c.deleted.has(m.id)) map.set(m.id, { ...map.get(m.id), ...m }); });
    c.items = Array.from(map.values()).sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id)).slice(-500);
    if (c.pending) { const p = c.pending; const match = c.items.find(m => String(m.nonce) === p.nonce && m.author?.id === p.author);
      if (match) { if (drafts.get(id)?.text === p.content) drafts.set(id, { text: "", reply: null, edit: null }); c.pending = null; } }
  }
  function messages(id) {
    const cached = call(stores.MessageStore, "getMessages", [id], null);
    const list = Array.isArray(cached) ? cached : call(cached, "toArray", [], cached?._array || []);
    if (Array.isArray(list)) mergeMessages(id, list);
    return conv(id).items.filter(m => !call(stores.RelationshipStore, "isBlocked", [m.author?.id], false));
  }
  async function loadMessages(id, older) {
    const c = channel(id), record = conv(id); if (!permission("VIEW_CHANNEL", c) || c?.nsfw || record.busy) return;
    const captured = epoch; record.busy = true; record.error = null; emit();
    try {
      const query = { limit: 50 }; if (older && record.items[0]) query.before = record.items[0].id;
      const data = await http("get", "/channels/" + encodeURIComponent(id) + "/messages", undefined, query);
      if (!live || epoch !== captured) return;
      if (!Array.isArray(data)) throw new Error("Discord returned an unexpected message response.");
      mergeMessages(id, data); record.fetched = true; if (older || record.items.length <= 50) record.hasMore = data.length === 50;
    } catch (e) { if (epoch === captured) { record.error = explain(e); issue("messages-read-failed"); } }
    finally { if (live && epoch === captured) { record.busy = false; emit(); } }
  }
  let nonceCounter = 0;
  async function submit(id) {
    const d = drafts.get(id), c = channel(id), record = conv(id); const content = d?.text;
    if (!content?.trim() || record.pending || !permission("SEND_MESSAGES", c)) return;
    const author = accountId, captured = epoch, nonce = String(Date.now()) + String(++nonceCounter % 1000).padStart(3, "0");
    const pending = { nonce, content, author, at: Date.now(), status: "sending" }; record.pending = pending; record.error = null; emit();
    try {
      let result;
      if (d.edit) {
        const actions = mod("sendMessage", "editMessage"); if (!actions?.editMessage) throw new Error("Discord's edit action is unavailable.");
        result = await actions.editMessage(id, d.edit, { content });
        if (result?.ok === false || result?.status >= 400) throw result;
        if (!live || epoch !== captured) return;
        drafts.set(id, { text: "", reply: null, edit: null }); record.pending = null;
        mergeMessages(id, [{ ...record.items.find(m => m.id === d.edit), id: d.edit, content, edited_timestamp: new Date().toISOString() }]);
      } else if (d.reply) {
        // Standard Discord reply schema. Mentions are explicit and reply pings are off.
        result = await http("post", "/channels/" + encodeURIComponent(id) + "/messages", { content, nonce, enforce_nonce: true, tts: false,
          allowed_mentions: { parse: [], replied_user: false }, message_reference: { message_id: d.reply.id, channel_id: id, fail_if_not_exists: false } });
      } else {
        const actions = mod("sendMessage", "editMessage");
        if (!actions?.sendMessage) throw new Error("Discord's send action is unavailable. Your draft is intact.");
        result = await actions.sendMessage(id, { content, nonce, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, undefined, {});
        if (result?.ok === false || result?.status >= 400) throw result;
      }
      if (!live || epoch !== captured) return;
      const message = result?.body ?? result;
      if (message?.id && message?.author) mergeMessages(id, [{ ...message, nonce: message.nonce ?? nonce }]);
      if (record.pending) record.pending.status = "confirming";
      await loadMessages(id); // No retry of a send; this only checks delivery.
    } catch (e) { if (live && epoch === captured) { record.pending = null; record.error = explain(e); issue("message-write-failed"); } }
    emit();
  }
  function messageEvent(event, kind) {
    const m = event?.message, id = m?.channel_id || event?.channelId || event?.channel_id;
    if (!id || !conversations.has(id)) return;
    if (kind === "delete") { const removed = event.id || event.messageId; conv(id).deleted.add(removed); conv(id).items = conv(id).items.filter(x => x.id !== removed); }
    else if (m?.id) mergeMessages(id, [m]);
    changed();
  }
  async function removeMessage(id, messageId) {
    const record = conv(id), m = record.items.find(x => x.id === messageId); if (m?.author?.id !== accountId) return;
    const captured = epoch;
    try { const actions = mod("sendMessage", "editMessage"); if (!actions?.deleteMessage) throw new Error("Delete is unavailable."); await actions.deleteMessage(id, messageId); if (epoch === captured) { record.deleted.add(messageId); record.items = record.items.filter(x => x.id !== messageId); } }
    catch (e) { if (epoch === captured) record.error = explain(e); } emit();
  }
  function profileFor(id) { return profiles.get(id) || call(stores.UserProfileStore, "getUserProfile", [id], {}) || {}; }
  async function loadProfile(id) {
    if (!id || id !== accountId) return;
    const cached = profileFor(id); if (Object.keys(cached).length) return;
    // Only our own profile is requested; the current user record remains authoritative.
    const captured = epoch;
    try { const p = await http("get", "/users/" + encodeURIComponent(id) + "/profile"); if (live && captured === epoch) { profiles.set(id, p.user_profile || p); emit(); } } catch (_) { issue("profile-read-unavailable"); }
  }
  async function saveProfile(values) {
    const captured = epoch, original = { profile: profileFor(accountId), user: me() }, completed = [];
    const dirty = new Set(values.dirty || []);
    // Save only fields the person actually edited. Unknown or unloaded fields are never cleared.
    if (dirty.has("globalName")) {
      await http("patch", "/users/@me", { global_name: values.globalName || null }); completed.push("Display Name");
    }
    if (!live || captured !== epoch) throw new Error("Account changed. Reopen your profile before editing.");
    const body = {};
    if (dirty.has("bio")) body.bio = values.bio;
    if (dirty.has("pronouns")) body.pronouns = values.pronouns;
    try { if (Object.keys(body).length) await http("patch", "/users/@me/profile", body); }
    catch (e) { throw new Error((completed.length ? completed.join(", ") + " was saved. " : "") + explain(e)); }
    if (!live || captured !== epoch) return;
    profiles.set(accountId, { ...original.profile, ...body, ...(dirty.has("globalName") ? { _displayName: values.globalName } : {}) }); emit();
  }
  function voiceId() { return call(stores.SelectedChannelStore, "getVoiceChannelId", [], null); }
  function voiceStates(id) { return Object.values(call(stores.VoiceStateStore, "getVoiceStatesForChannel", [id], {})); }
  async function voiceAction(action, id) {
    const c = channel(id);
    try {
      if (action === "join") {
        if (!permission("CONNECT", c)) throw new Error("You cannot connect to this channel.");
        if (isPrivate(c)) { const calls = mod("call", "ring", "stopRinging"); if (!calls?.call) throw new Error("The voice-call action is unavailable."); await calls.call(id, false, true, null, null); }
        else { const a = mod("selectVoiceChannel"); if (!a?.selectVoiceChannel) throw new Error("Voice-channel actions are unavailable."); await a.selectVoiceChannel(id); }
      } else if (action === "leave") { const a = mod("selectVoiceChannel", "disconnect"); if (!a?.disconnect) throw new Error("Disconnect is unavailable. Use Discord's call controls."); await a.disconnect(); }
      else { const name = action === "mute" ? "toggleSelfMute" : "toggleSelfDeaf"; const a = mod(name); if (typeof a?.[name] !== "function") throw new Error("This call control is unavailable in the installed build."); await a[name](); }
      health.capabilities["voice:" + action] = "invoked; result comes from Discord stores";
    } catch (e) { toast(explain(e)); issue("voice-" + action + "-failed"); } emit();
  }
  const validUrl = s => typeof s === "string" && /^https:\/\/[^\s<>"']+$/i.test(s);
  function openUrl(url) { if (!validUrl(url)) return toast("This URL cannot be opened."); safe(() => RN.Linking.openURL(url)); }
  function mediaOf(m) { return (Array.isArray(m.attachments) ? m.attachments : []).map(a => ({ url: a.url || a.proxy_url, name: a.filename || "Attachment", type: a.content_type || (String(a.filename).match(/\.(png|jpe?g|gif|webp)$/i) ? "image/unknown" : "application/octet-stream"), width: a.width, height: a.height, spoiler: !!a.spoiler || /^SPOILER_/.test(a.filename || "") })).filter(a => validUrl(a.url)); }
  function nativeTheme() { const c = colors(), semantic = {}; ["BACKGROUND_PRIMARY", "BACKGROUND_SECONDARY", "BACKGROUND_TERTIARY", "CHAT_BACKGROUND", "BG_BASE_PRIMARY", "BG_BASE_SECONDARY", "BG_BASE_TERTIARY", "BACKGROUND_BASE_LOWEST", "BACKGROUND_BASE_LOWER", "BACKGROUND_BASE_LOW"].forEach(k => semantic[k] = c.bg); ["BACKGROUND_FLOATING", "BACKGROUND_SECONDARY_ALT", "BG_SURFACE_OVERLAY", "BG_SURFACE_RAISED", "BACKGROUND_SURFACE_HIGH", "CHANNELTEXTAREA_BACKGROUND", "PANEL_BG"].forEach(k => semantic[k] = c.surface); ["TEXT_NORMAL", "TEXT_DEFAULT", "TEXT_PRIMARY", "HEADER_PRIMARY", "INTERACTIVE_ACTIVE", "INTERACTIVE_NORMAL", "ICON_PRIMARY"].forEach(k => semantic[k] = c.ink); ["TEXT_MUTED", "HEADER_SECONDARY", "CHANNELS_DEFAULT", "TEXT_SECONDARY", "ICON_SECONDARY"].forEach(k => semantic[k] = c.muted); ["TEXT_LINK", "TEXT_BRAND", "ICON_BRAND"].forEach(k => semantic[k] = c.accent); return { spec: 3, type: "color", id: THEME_ID, version: VERSION, display: { name: "Reimagined / " + c.name, authors: [{ name: "Discord: Reimagined" }] }, main: { type: cfg("palette") === "pearl" ? "light" : "dark", raw: { BRAND_500: c.accent, BRAND_360: c.accent }, semantic } }; }
  async function restoreTheme() { const t = safe(() => globalThis.vendetta.themes, null); if (ownsTheme && safe(() => t.getThemeFromLoader()?.id) === THEME_ID && t?.selectTheme) { await t.selectTheme(themeBackup || "default"); api.storage.themeBackup = null; } ownsTheme = false; }
  function syncTheme() { const captured = epoch; themeQueue = themeQueue.then(async () => { if (!live || captured !== epoch) return; if (!cfg("nativePalette")) return restoreTheme(); const t = safe(() => globalThis.vendetta.themes, null); if (!t?.selectTheme) return issue("theme-api-missing"); const current = safe(() => t.getThemeFromLoader(), null); if (current?.id !== THEME_ID) { themeBackup = current ? { id: current.id, data: current.data } : null; api.storage.themeBackup = themeBackup; } else themeBackup = api.storage.themeBackup || null; await t.selectTheme({ id: THEME_ID, data: nativeTheme() }); ownsTheme = true; }).catch(() => issue("theme-apply-failed")); }
  function buildUI() {
    const t = (value, style, props) => h(RN.Text, { style: [{ color: colors().ink, fontSize: TYPE.body, lineHeight: 22 }, style], ...(props || {}) }, value);
    function Icon(p) { const id = asset(p.name), size = p.size || 22, color = p.color || colors().muted; return id != null ? h(RN.Image, { source: id, resizeMode: "contain", accessible: false, style: { width: size, height: size, tintColor: color } }) : t(GLYPHS[p.name] || "\u2022", { fontSize: size, lineHeight: size + 4, width: size + 2, textAlign: "center", color }, { accessible: false }); }
    Control = class extends React.Component {
      constructor(p) { super(p); this.state = { pressed: false }; this.press = this.press.bind(this); this.scale = RN.Animated ? new RN.Animated.Value(1) : null; }
      spring(to) { if (this.scale && !cfg("reduceMotion")) safe(() => RN.Animated.spring(this.scale, { toValue: to, speed: 40, bounciness: 6, useNativeDriver: true }).start()); }
      press() { const p = this.props; if (!live || p.disabled) return; recordTap(p.id || p.action || "control"); if (p.run) p.run(); else send(p.action, p.value); }
      render() { const p = this.props; return h(RN.Animated && RN.Pressable ? (Control.animatedPressable || (Control.animatedPressable = RN.Animated.createAnimatedComponent(RN.Pressable))) : (RN.Pressable || RN.TouchableOpacity), { testID: p.id, accessibilityLabel: p.label, accessibilityRole: p.role || "button", accessibilityState: { disabled: !!p.disabled, selected: !!p.selected }, disabled: !!p.disabled,
        onPress: this.press, onLongPress: p.longPress, hitSlop: 0, onPressIn: () => { this.spring(0.95); this.setState({ pressed: true }); }, onPressOut: () => { this.spring(1); this.setState({ pressed: false }); },
        onLayout: p.measure ? e => { const f = e?.nativeEvent?.layout; if (f) health.frames[p.id] = { x: f.x, y: f.y, width: f.width, height: f.height }; } : undefined,
        style: [{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: p.disabled ? 0.4 : this.state.pressed ? 0.8 : 1, ...(this.scale && RN.Pressable ? { transform: [{ scale: this.scale }] } : null) }, p.style] }, p.children); }
    };
    const button = (label, action, value, style, id, run, disabled) => h(Control, { label, action, value, id: id || action, run, disabled, style: [{ borderRadius: RAD.small, paddingHorizontal: SPACE.lg, backgroundColor: colors().elevated }, style] }, t(label, { fontSize: TYPE.caption, fontWeight: "600" }, { numberOfLines: 1 }));
    const ib = (name, label, action, value, id, run, disabled) => h(Control, { label, action, value, id: id || action, run, disabled, style: { borderRadius: RAD.round } }, h(Icon, { name }));
    function Avatar(p) { const c = colors(), size = p.size || 48, initials = String(p.name || "?").trim().split(/\s+/).map(x => x.charAt(0)).slice(0, 2).join("").toUpperCase(); return h(RN.View, { style: { width: size, height: size, borderRadius: p.square ? size * 0.28 : size / 2, backgroundColor: c.elevated, alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 } }, p.uri ? h(RN.Image, { source: typeof p.uri === "number" ? p.uri : { uri: p.uri }, style: { width: size, height: size }, resizeMode: "cover" }) : t(initials, { fontSize: size * 0.34, fontWeight: "600", color: c.accent, lineHeight: size })); }
    function Header(p) { return h(RN.View, { testID: "scroll-header", style: { backgroundColor: colors().bg, paddingHorizontal: SPACE.xl, paddingTop: SPACE.md, paddingBottom: SPACE.lg, flexDirection: "row", alignItems: "center", minHeight: 78 } },
      p.back ? ib("BackIcon", "Back", "back", null, "scene-back") : null,
      t(p.title, { flex: 1, minWidth: 0, fontSize: p.back ? TYPE.section : TYPE.display, lineHeight: p.back ? 30 : 40, letterSpacing: -0.7, fontWeight: "700" }, { numberOfLines: 1 }),
      p.right || ib("SettingsIcon", "Settings", "settings", null, "open-settings")); }
    // The native ScrollView implements hide-on-down/reveal-on-up, including iOS bounce handling.
    // No scroll-direction timer or shared callback in the patched You Bar is involved.
    Page = class extends React.Component {
      constructor(p) { super(p); this.enter = animated() ? new RN.Animated.Value(0) : null; }
      componentDidMount() { if (this.enter) safe(() => RN.Animated.timing(this.enter, { toValue: 1, duration: 280, easing: RN.Easing?.out?.(RN.Easing.cubic), useNativeDriver: true }).start()); }
      render() { const p = this.props; return h(RN.ScrollView, { testID: p.id || "scene-scroll", style: { flex: 1, minHeight: 0, backgroundColor: colors().bg },
        stickyHeaderIndices: [0], stickyHeaderHiddenOnScroll: true, scrollEventThrottle: 16,
        keyboardShouldPersistTaps: "handled", keyboardDismissMode: "interactive", showsVerticalScrollIndicator: false,
        contentInsetAdjustmentBehavior: "never", contentContainerStyle: { paddingBottom: SPACE.xxl } },
        h(Header, { title: p.title, back: p.back, right: p.right }), h(RN.Animated && this.enter ? RN.Animated.View : RN.View, { style: [{ paddingHorizontal: SPACE.xl, width: "100%", maxWidth: 820, alignSelf: "center" }, this.enter ? { opacity: this.enter, transform: [{ translateY: this.enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] } : null] }, p.children)); }
    };
    function Section(p) { return h(RN.View, { style: { marginTop: SPACE.xl, marginBottom: SPACE.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center" } }, t(p.title, { fontSize: TYPE.title, fontWeight: "600", letterSpacing: -0.3, flexShrink: 1 }), p.right || null); }
    function Empty(p) { return h(RN.View, { style: { paddingVertical: SPACE.xxl } }, t(p.title, { fontSize: TYPE.title, fontWeight: "600" }), p.error ? t(p.error, { fontSize: TYPE.caption, color: colors().danger, marginTop: SPACE.sm }) : null, p.action ? button(p.cta, p.action, p.value, { marginTop: SPACE.lg, alignSelf: "flex-start" }) : null); }
    function Search(p) { return h(RN.View, { style: { flexDirection: "row", alignItems: "center", minHeight: 50, borderRadius: RAD.medium, paddingHorizontal: SPACE.lg, backgroundColor: colors().surface, borderWidth: 1, borderColor: colors().line } }, h(Icon, { name: "SearchIcon", size: 20 }), h(RN.TextInput, { testID: "search", accessibilityLabel: p.placeholder, placeholder: p.placeholder, placeholderTextColor: colors().faint, value: state.search, onChangeText: value => send("search", value), autoCorrect: false, autoCapitalize: "none", returnKeyType: "search", style: { flex: 1, minWidth: 0, color: colors().ink, fontSize: TYPE.caption, paddingHorizontal: SPACE.md, paddingVertical: SPACE.md } }), state.search ? ib("CloseIcon", "Clear search", "search", "", "clear-search") : null); }
    function Filters(p) { return h(RN.View, { style: { flexDirection: "row", marginVertical: SPACE.md } }, ...p.options.map(o => h(Control, { key: o.id, id: "filter-" + o.id, action: "filter", value: o.id, label: o.name, selected: state.filter === o.id, style: { marginRight: SPACE.sm, borderRadius: RAD.round, paddingHorizontal: SPACE.lg, backgroundColor: state.filter === o.id ? colors().accentSoft : colors().clear } }, t(o.name, { fontSize: TYPE.caption, fontWeight: "600", color: state.filter === o.id ? colors().accent : colors().muted }, { numberOfLines: 1 })))); }
    function Pin(p) { return h(Control, { id: "pin:" + p.kind + ":" + p.id, label: (pinned(p.kind, p.id) ? "Unpin " : "Pin ") + p.name, action: "pin", value: { kind: p.kind, id: p.id, guildId: p.guildId }, selected: pinned(p.kind, p.id), style: { borderRadius: RAD.round } }, h(Icon, { name: "StarIcon", size: 18, color: pinned(p.kind, p.id) ? colors().accent : colors().faint })); }
    function ServerCard(p) { const g = p.guild, c = colors(); return h(RN.View, { style: { width: p.width, marginBottom: SPACE.md, borderRadius: RAD.large, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, overflow: "hidden" } },
      h(RN.View, { style: { flexDirection: "row", justifyContent: "space-between", paddingLeft: SPACE.lg, paddingTop: SPACE.md, paddingRight: SPACE.sm } }, h(Avatar, { name: g.name, uri: imageUrl(g, "guild"), size: 48, square: true }), h(Pin, { kind: "guild", id: g.id, name: g.name })),
      h(Control, { id: "server:" + g.id, label: g.name, action: "server", value: g.id, style: { alignItems: "flex-start", padding: SPACE.lg, minHeight: 62 } }, t(g.name, { fontSize: TYPE.body, fontWeight: "600", letterSpacing: -0.2 }, { numberOfLines: 1 }))); }
    function ServerRow(p) { const g = p.guild; return h(RN.View, { style: { flexDirection: "row", alignItems: "center", paddingVertical: SPACE.sm } }, h(Control, { id: "server:" + g.id, label: g.name, action: "server", value: g.id, style: { flex: 1, flexDirection: "row", justifyContent: "flex-start" } }, h(Avatar, { name: g.name, uri: imageUrl(g, "guild"), size: 44, square: true }), t(g.name, { marginLeft: SPACE.md, flex: 1, fontWeight: "500" }, { numberOfLines: 1 })), h(Pin, { kind: "guild", id: g.id, name: g.name })); }
    function ServerGrid(p) { const columns = p.width >= 600 ? 3 : 2, width = Math.floor((p.width - SPACE.xl * 2 - SPACE.md * (columns - 1)) / columns); return h(RN.View, { style: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" } }, ...p.items.map(g => h(ServerCard, { key: g.id, guild: g, width }))); }
    function Badge(p) {
      const c = colors(), n = p.count;
      if (!n && !p.dot) return null;
      return h(RN.View, { accessible: false, style: n ? { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: RAD.round, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", marginLeft: SPACE.sm } : { width: 8, height: 8, borderRadius: RAD.round, backgroundColor: c.accent, marginLeft: SPACE.sm } },
        n ? t(n > 99 ? "99+" : String(n), { fontSize: 11, lineHeight: 14, fontWeight: "700", color: c.accentInk }, { accessible: false }) : null);
    }
    function DmRow(p) { const d = p.dm; return h(RN.View, { style: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors().line } },
      h(Control, { id: "dm:" + d.id, label: d.name, action: "channel", value: d.id, style: { flex: 1, flexDirection: "row", justifyContent: "flex-start", paddingVertical: cfg("density") === "compact" ? SPACE.md : SPACE.lg } }, h(Avatar, { name: d.name, uri: imageUrl(d.user, "user"), size: 46 }),
        h(RN.View, { style: { flex: 1, minWidth: 0, marginLeft: SPACE.md } }, h(RN.View, { style: { flexDirection: "row", alignItems: "center" } }, t(d.name, { flex: 1, fontWeight: d.unread ? "700" : "500" }, { numberOfLines: 1 }), h(Badge, { count: d.mentions, dot: d.unread })),
          d.preview ? t(d.preview, { color: d.unread ? colors().ink : colors().muted, fontSize: TYPE.caption, marginTop: SPACE.xs }, { numberOfLines: 1 }) : null)), h(Pin, { kind: "dm", id: d.id, name: d.name })); }
    function HomeGlance() {
      const c = colors(), hour = new Date().getHours(), name = userName(me()).split(/\s+/)[0];
      const ds = listDms(), unreadCount = ds.filter(d => d.unread).length, mentionTotal = ds.reduce((n, d) => n + d.mentions, 0);
      const recent = account().recent.map(r => { const ch = channel(r.id), dm = ds.find(d => d.id === r.id); return ch ? { id: r.id, name: dm?.name || ch.name || "Channel", user: dm?.user, dm: !!dm } : null; }).filter(Boolean).slice(0, 8);
      const summary = mentionTotal ? mentionTotal + (mentionTotal === 1 ? " mention" : " mentions") : unreadCount ? unreadCount + " unread" : "All caught up";
      return h(RN.View, { style: { marginBottom: SPACE.lg } },
        h(RN.View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACE.lg } },
          h(RN.View, { style: { flex: 1, minWidth: 0 } }, t((hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening") + (name && name !== "Unknown" ? ", " + name : ""), { fontSize: TYPE.title, lineHeight: 26, fontWeight: "600", letterSpacing: -0.3 }, { numberOfLines: 1 })),
          mentionTotal || unreadCount ? h(Control, { id: "glance-unread", label: summary, run: () => { send("tab", "messages"); send("filter", mentionTotal ? "mentions" : "unread"); }, style: { flexDirection: "row", borderRadius: RAD.round, paddingHorizontal: SPACE.md, backgroundColor: c.accentSoft } }, t(summary, { fontSize: TYPE.small, fontWeight: "600", color: c.accent })) : t(summary, { fontSize: TYPE.small, color: c.muted })),
        recent.length ? h(RN.ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false, keyboardShouldPersistTaps: "handled", testID: "jump-back-in" }, ...recent.map(r => h(Control, { key: r.id, id: "recent:" + r.id, label: r.name, action: "channel", value: r.id, style: { flexDirection: "row", marginRight: SPACE.sm, paddingLeft: SPACE.sm, paddingRight: SPACE.md, borderRadius: RAD.round, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line } }, r.dm ? h(Avatar, { name: r.name, uri: imageUrl(r.user, "user"), size: 28 }) : h(Icon, { name: "HashIcon", size: 18, color: c.faint }), t(r.name, { marginLeft: SPACE.sm, fontSize: TYPE.caption, maxWidth: 140 }, { numberOfLines: 1 })))) : null);
    }
    function Home(p) { const gs = guilds(), ds = listDms(), q = state.search.toLowerCase().trim(), favorites = gs.filter(g => pinned("guild", g.id)); const show = (q ? gs.filter(g => g.name.toLowerCase().includes(q)) : favorites.length ? favorites : gs).slice(0, 4); const dms = (q ? ds.filter(d => d.name.toLowerCase().includes(q)) : ds).slice(0, 6); return h(Page, { title: "Home" }, h(HomeGlance),
      h(Search, { placeholder: "Search" }), h(Section, { title: favorites.length && !q ? "Favorites" : "Servers", right: button("View all", "tab", "servers", { backgroundColor: colors().clear, paddingHorizontal: SPACE.sm }, "all-servers") }),
      show.length ? h(ServerGrid, { items: show, width: p.width }) : h(Empty, { title: "No servers found" }),
      h(Section, { title: "Direct Messages", right: button("View all", "tab", "messages", { backgroundColor: colors().clear, paddingHorizontal: SPACE.sm }, "all-messages") }),
      ...dms.map(d => h(DmRow, { key: d.id, dm: d })), !dms.length ? h(Empty, { title: "No messages found" }) : null); }
    function Servers(p) { const q = state.search.trim().toLowerCase(); const items = guilds().filter(g => (!q || g.name.toLowerCase().includes(q)) && (state.filter !== "pinned" || pinned("guild", g.id))); return h(Page, { title: "Servers" }, h(Search, { placeholder: "Search servers" }),
      h(RN.View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" } }, h(Filters, { options: [{ id: "all", name: "All" }, { id: "pinned", name: "Pinned" }] }), ib("SquaresIcon", cfg("grid") ? "List view" : "Grid view", "setting", { key: "grid", value: !cfg("grid") }, "toggle-grid")),
      cfg("grid") ? h(ServerGrid, { items: items.slice(0, state.limit), width: p.width }) : h(RN.View, null, ...items.slice(0, state.limit).map(g => h(ServerRow, { key: g.id, guild: g }))),
      !items.length ? h(Empty, { title: "No servers found" }) : items.length > state.limit ? button("Show more", "more") : null,
      state.drawer ? button("Expand", "expand", null, { marginTop: SPACE.lg }, "expand-drawer") : null); }
    function Channels() { const g = guilds().find(x => x.id === state.guild), list = g ? channels(g.id) : null, q = state.search.toLowerCase().trim(); return h(Page, { title: g?.name || "Server", back: true },
      h(Search, { placeholder: "Search channels" }), h(Section, { title: "Channels" }), list === null ? h(Empty, { title: "Channels unavailable", error: "Discord's permission-checked channel list is unavailable." }) :
        h(RN.View, null, ...list.filter(c => !q || c.name?.toLowerCase().includes(q)).slice(0, state.limit).map(c => h(RN.View, { key: c.id, style: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors().line } },
          h(Control, { id: "channel:" + c.id, label: c.name, action: "channel", value: c.id, style: { flex: 1, flexDirection: "row", justifyContent: "flex-start", paddingVertical: SPACE.lg } }, h(Icon, { name: [2, 13].includes(c.type) ? "VoiceIcon" : "HashIcon", color: unread(c.id) ? colors().accent : colors().faint }), t(c.name, { marginLeft: SPACE.md, flex: 1, fontWeight: unread(c.id) ? "700" : "400" }, { numberOfLines: 1 })), h(Pin, { kind: "channel", id: c.id, guildId: g.id, name: c.name }))))); }
    function Messages() { const q = state.search.toLowerCase().trim(); const ds = listDms().filter(d => (!q || d.name.toLowerCase().includes(q)) && (state.filter !== "unread" || d.unread) && (state.filter !== "mentions" || d.mentions > 0) && (state.filter !== "pinned" || pinned("dm", d.id))); return h(Page, { title: "Messages" }, h(Search, { placeholder: "Search messages" }), h(Filters, { options: [{ id: "all", name: "All" }, { id: "unread", name: "Unread" }, { id: "mentions", name: "Mentions" }, { id: "pinned", name: "Pinned" }] }),
      ...ds.slice(0, state.limit).map(d => h(DmRow, { key: d.id, dm: d })), !ds.length ? h(Empty, { title: "No messages found" }) : ds.length > state.limit ? button("Show more", "more") : null); }
    function Toggle(p) { return h(RN.View, { style: { flexDirection: "row", alignItems: "center", paddingVertical: SPACE.md, borderBottomWidth: 1, borderBottomColor: colors().line } }, t(p.label, { flex: 1, minWidth: 0, paddingRight: SPACE.lg, fontWeight: "500" }), h(RN.Switch, { testID: "setting-" + p.name, accessibilityLabel: p.label, value: !!cfg(p.name), trackColor: { false: colors().line, true: colors().accent }, thumbColor: colors().surface, onValueChange: value => send("setting", { key: p.name, value: !!value }) })); }
    function Preferences() { const c = colors(); return h(Page, { title: "Appearance", back: true },
      h(RN.View, { style: { flexDirection: "row", justifyContent: "space-between" } }, ...Object.entries(PALETTES).map(([id, p]) => h(Control, { key: id, id: "palette-" + id, label: p.name, action: "setting", value: { key: "palette", value: id }, selected: cfg("palette") === id, style: { flex: 1, marginRight: id === "slate" ? 0 : SPACE.sm, padding: SPACE.md, borderRadius: RAD.medium, borderWidth: cfg("palette") === id ? 2 : 1, borderColor: cfg("palette") === id ? c.accent : c.line, backgroundColor: p.bg } }, h(RN.View, { style: { flexDirection: "row", marginBottom: SPACE.sm } }, ...[p.surface, p.accent, p.ink].map((color, i) => h(RN.View, { key: i, style: { width: 16, height: 16, borderRadius: 8, marginRight: 3, backgroundColor: color } }))), t(p.name, { color: p.ink, fontSize: TYPE.small, fontWeight: "600" }, { numberOfLines: 1 })))),
      h(Section, { title: "Display" }), h(Toggle, { name: "nativePalette", label: "Sync Discord theme" }), h(Toggle, { name: "showPreviews", label: "Message previews" }), h(Toggle, { name: "reduceMotion", label: "Reduce motion" }), h(Toggle, { name: "startHome", label: "Open Home on launch" }), h(Toggle, { name: "layout", label: "Navigation dock" }), h(Toggle, { name: "nativeSkin", label: "Restyle Discord settings (beta)" }), h(Toggle, { name: "nativeSkinRows", label: "Roomier settings rows (beta)" }), h(Toggle, { name: "nativeScreens", label: "Reimagined inside native screens (beta)" }),
      button(cfg("density") === "compact" ? "Comfortable" : "Compact", "setting", { key: "density", value: cfg("density") === "compact" ? "comfortable" : "compact" }, { marginTop: SPACE.lg }, "density"),
      h(Section, { title: "Diagnostics" }), h(Toggle, { name: "diagnostics", label: "Tap diagnostics" }), button("Copy compatibility report", "report", null, { marginTop: SPACE.lg }, "copy-report"), h(Toggle, { name: "blueprint", label: "Record settings blueprint" }), button("Copy settings blueprint", "blueprint", null, { marginTop: SPACE.sm }, "copy-blueprint"), button("Scan whole app (tour)", "tour", null, { marginTop: SPACE.sm }, "scan-app"),
      t(VERSION, { fontSize: TYPE.small, color: c.muted, marginTop: SPACE.xl }), health.issues.length ? t(health.issues.join("\n"), { color: c.danger, marginTop: SPACE.md, fontSize: TYPE.small }) : null); }
    function Profile(p) {
      const id = p.id || accountId, u = user(id) || (id === accountId ? me() : null), data = profileFor(id), own = id === accountId;
      const banner = imageUrl({ id, banner: data.banner || u?.banner }, "banner"), displayName = data._displayName || userName(u);
      const status = call(stores.PresenceStore, "getStatus", [id], "offline");
      return h(Page, { title: own ? "You" : "Profile", back: !own || state.screen === "profile", right: own ? ib("SettingsIcon", "Settings", "settings", null, "profile-settings") : undefined },
        banner ? h(RN.Image, { source: { uri: banner }, resizeMode: "cover", style: { height: 132, width: "100%", borderRadius: RAD.large, marginBottom: SPACE.lg } }) : null,
        h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginBottom: SPACE.xl } }, h(Avatar, { name: displayName, uri: imageUrl(u, "user"), size: 84 }), h(RN.View, { style: { flex: 1, minWidth: 0, marginLeft: SPACE.lg } },
          t(displayName, { fontSize: TYPE.section, lineHeight: 30, fontWeight: "700", letterSpacing: -0.4 }), t(u?.username || "", { color: colors().muted, fontSize: TYPE.caption, marginTop: SPACE.xs }),
          data.pronouns ? t(data.pronouns, { color: colors().muted, fontSize: TYPE.caption }) : null,
          t({ online: "Online", idle: "Idle", dnd: "Do Not Disturb", offline: "Offline", invisible: "Invisible" }[status] || "Offline", { color: colors().accent, fontSize: TYPE.small, marginTop: SPACE.sm }))),
        data.bio ? h(RN.View, { style: { backgroundColor: colors().surface, borderRadius: RAD.large, padding: SPACE.lg, marginBottom: SPACE.xl } }, t("About Me", { fontWeight: "600", marginBottom: SPACE.sm }), h(MessageText, { content: data.bio })) : null,
        own ? h(RN.View, null, button("Edit Profile", "edit-profile", null, { backgroundColor: colors().accentSoft }, "edit-profile"),
          h(Section, { title: "Settings" }), button("Appearance", "preferences", null, { marginBottom: SPACE.md }, "appearance"), button("Avatar and Banner", "settings", "profile", { marginBottom: SPACE.md }, "avatar-settings"), button("Account Settings", "settings", null, { marginBottom: SPACE.md }, "account-settings")) : null);
    }
    class EditProfile extends React.Component {
      constructor(p) { super(p); const data = profileFor(accountId), u = me(); this.state = { globalName: data._displayName || u?.globalName || u?.global_name || "", bio: data.bio || "", pronouns: data.pronouns || "", dirty: [], busy: false, error: null }; this.owner = accountId; }
      async save() {
        if (this.state.busy || !this.state.dirty.length || this.owner !== accountId) return;
        this.setState({ busy: true, error: null });
        try { await saveProfile({ ...this.state }); if (live && this.owner === accountId && this.mounted) { this.setState({ busy: false }); back(); } }
        catch (e) { if (this.mounted && this.owner === accountId) this.setState({ busy: false, error: explain(e) }); }
      }
      componentDidMount() { this.mounted = true; } componentWillUnmount() { this.mounted = false; }
      render() { return h(Page, { title: "Edit Profile", back: true }, ...[{ key: "globalName", label: "Display Name" }, { key: "pronouns", label: "Pronouns" }, { key: "bio", label: "About Me", multiline: true }].map(f => h(RN.View, { key: f.key, style: { marginBottom: SPACE.xl } },
        t(f.label, { fontWeight: "600", marginBottom: SPACE.sm }), h(RN.TextInput, { testID: "profile-" + f.key, accessibilityLabel: f.label, value: this.state[f.key], editable: !this.state.busy, multiline: !!f.multiline, autoCapitalize: "none", onChangeText: value => this.setState(s => ({ [f.key]: value, dirty: Array.from(new Set(s.dirty.concat(f.key))) })), style: { color: colors().ink, fontSize: TYPE.body, borderWidth: 1, borderColor: colors().line, backgroundColor: colors().surface, padding: SPACE.lg, borderRadius: RAD.medium, minHeight: f.multiline ? 140 : 52, textAlignVertical: "top" } }))),
        this.state.error ? t(this.state.error, { color: colors().danger, marginBottom: SPACE.lg }) : null,
        button(this.state.busy ? "Saving..." : "Save Changes", null, null, { backgroundColor: colors().accentSoft }, "save-profile", () => this.save(), this.state.busy || !this.state.dirty.length)); }
    }
    class Spoiler extends React.Component { constructor(p) { super(p); this.state = { reveal: false }; } render() { return this.state.reveal ? this.props.children : h(Control, { id: "reveal-spoiler", label: "Reveal spoiler", run: () => this.setState({ reveal: true }), style: { borderRadius: RAD.small, backgroundColor: colors().elevated, padding: SPACE.md, alignSelf: "flex-start" } }, t("Spoiler", { color: colors().muted, fontSize: TYPE.caption })); } }
    function MessageText(p) {
      // Conservative text renderer: never renders message HTML, executes code, or auto-opens a link.
      const content = String(p.content || ""), blocks = content.split(/(```[\s\S]*?```)/g);
      return h(RN.View, null, ...blocks.map((part, i) => {
        if (!part) return null;
        if (part.startsWith("```")) { const raw = part.slice(3, -3), first = raw.indexOf("\n"), code = first >= 0 ? raw.slice(first + 1) : raw; return h(RN.ScrollView, { key: i, horizontal: true, style: { backgroundColor: colors().elevated, borderRadius: RAD.small, marginVertical: SPACE.sm }, contentContainerStyle: { padding: SPACE.md } }, t(code, { fontFamily: RN.Platform?.OS === "ios" ? "Menlo" : "monospace", fontSize: TYPE.caption }, { selectable: true })); }
        if (part.includes("||")) { return h(RN.View, { key: i }, ...part.split(/(\|\|[\s\S]*?\|\|)/g).map((piece, j) => piece.startsWith("||") ? h(Spoiler, { key: j }, t(piece.slice(2, -2), null, { selectable: true })) : t(piece, null, { key: j, selectable: true }))); }
        const tokens = part.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>]+|<@!?\d+>|<#[0-9]+>|<a?:[\w]+:\d+>)/g);
        return t(tokens.map((piece, j) => {
          if (piece.startsWith("**") && piece.endsWith("**")) return t(piece.slice(2, -2), { fontWeight: "700" }, { key: j });
          if (piece.startsWith("`") && piece.endsWith("`")) return t(piece.slice(1, -1), { fontFamily: RN.Platform?.OS === "ios" ? "Menlo" : "monospace", backgroundColor: colors().elevated }, { key: j });
          if (/^https?:\/\//i.test(piece)) return t(piece, { color: colors().accent }, { key: j, onPress: () => openUrl(piece), accessibilityRole: "link" });
          const mention = piece.match(/^<@!?(\d+)>$/); if (mention) return t("@" + userName(user(mention[1])), { color: colors().accent }, { key: j });
          const ch = piece.match(/^<#(\d+)>$/); if (ch) return t("#" + (channel(ch[1])?.name || "channel"), { color: colors().accent }, { key: j });
          const emoji = piece.match(/^<(a?):([\w]+):(\d+)>$/); if (emoji) return ":" + emoji[2] + ":";
          return piece;
        }), null, { key: i, selectable: true });
      }));
    }
    function Attachment(p) {
      const a = p.media, preview = a.type.startsWith("image/"); const inner = h(Control, { id: "attachment", label: a.name, action: "media", value: a, style: { alignItems: "stretch", borderRadius: RAD.medium, overflow: "hidden", backgroundColor: colors().elevated, marginTop: SPACE.sm } },
        preview ? h(RN.Image, { source: { uri: a.url }, resizeMode: "cover", style: { width: "100%", aspectRatio: Math.max(0.65, Math.min(1.8, (a.width || 4) / (a.height || 3))) } }) : h(RN.View, { style: { flexDirection: "row", padding: SPACE.lg, alignItems: "center" } }, h(Icon, { name: "ImageIcon" }), t(a.name, { marginLeft: SPACE.md, flex: 1, fontSize: TYPE.caption }, { numberOfLines: 2 })));
      return a.spoiler ? h(Spoiler, null, inner) : inner;
    }
    function MessageCard(p) {
      const m = p.message, own = m.author?.id === accountId, c = colors(), time = safe(() => new Date(m.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), ""), author = m.author || {};
      return h(RN.View, { testID: "message:" + m.id, style: { paddingHorizontal: SPACE.lg, paddingVertical: cfg("density") === "compact" ? SPACE.xs : SPACE.sm, flexDirection: "row", alignItems: "flex-start" } },
        h(Control, { id: "author:" + author.id, label: userName(author), action: "profile", value: author.id, style: { minWidth: 36, minHeight: 36, marginTop: SPACE.xs } }, h(Avatar, { name: userName(author), uri: imageUrl(author, "user"), size: 32 })),
        h(RN.View, { style: { flex: 1, minWidth: 0, marginLeft: SPACE.sm, padding: SPACE.md, borderRadius: RAD.medium, backgroundColor: own ? c.accentSoft : c.surface } },
          h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginBottom: SPACE.xs } }, t(userName(author), { fontSize: TYPE.caption, fontWeight: "700", flex: 1 }, { numberOfLines: 1 }), t(time, { fontSize: 10, color: c.faint })),
          m.referenced_message ? t(userName(m.referenced_message.author) + ": " + String(m.referenced_message.content || ""), { color: c.muted, fontSize: TYPE.small, marginBottom: SPACE.sm }, { numberOfLines: 1 }) : null,
          h(RN.Pressable || RN.TouchableOpacity, { onLongPress: () => { state.menu = { channel: p.channelId, message: m }; emit(); }, accessibilityLabel: "Message from " + userName(author) }, h(MessageText, { content: m.content })),
          ...mediaOf(m).map((a, i) => h(Attachment, { key: i, media: a })),
          ...(Array.isArray(m.embeds) ? m.embeds : []).slice(0, 6).map((e, i) => h(RN.View, { key: "embed" + i, style: { marginTop: SPACE.sm, borderLeftWidth: 2, borderLeftColor: c.accent, paddingLeft: SPACE.md } }, e.title || e.rawTitle ? t(e.title || e.rawTitle, { fontWeight: "600" }) : null, e.description || e.rawDescription ? t(e.description || e.rawDescription, { fontSize: TYPE.caption, color: c.muted }) : null)),
          m.edited_timestamp ? t("(edited)", { fontSize: 10, color: c.faint, marginTop: SPACE.xs }) : null,
          m.reactions?.length ? h(RN.View, { style: { flexDirection: "row", flexWrap: "wrap", marginTop: SPACE.sm } }, ...m.reactions.map((r, i) => t((r.emoji?.name || "Reaction") + " " + r.count, { fontSize: TYPE.small, marginRight: SPACE.sm, padding: SPACE.xs, borderRadius: RAD.small, backgroundColor: c.elevated }, { key: i }))) : null,
          h(Control, { id: "message-actions:" + m.id, label: "Message actions", run: () => { state.menu = { channel: p.channelId, message: m }; emit(); }, style: { alignSelf: "flex-end", minHeight: 32, minWidth: 44 } }, h(Icon, { name: "MoreIcon", size: 18 }))));
    }
    function MessageMenu() {
      if (!state.menu) return null; const { message: m, channel: id } = state.menu;
      const act = (kind) => { state.menu = null; if (kind === "copy") safe(() => api.common.clipboard.setString(m.content || ""));
        if (kind === "reply") drafts.set(id, { ...(drafts.get(id) || { text: "" }), reply: { id: m.id, author: userName(m.author) }, edit: null });
        if (kind === "edit") drafts.set(id, { text: m.content || "", edit: m.id, reply: null });
        if (kind === "delete") RN.Alert?.alert("Delete Message", "This cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => removeMessage(id, m.id) }]); emit(); };
      return h(RN.View, { style: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "flex-end", backgroundColor: colors().shade } },
        h(Control, { id: "menu-close", label: "Close", run: () => { state.menu = null; emit(); }, style: { flex: 1 } }),
        h(RN.View, { style: { backgroundColor: colors().surface, padding: SPACE.xl, borderTopLeftRadius: RAD.sheet, borderTopRightRadius: RAD.sheet } },
          ...["reply", "copy", ...(m.author?.id === accountId ? ["edit", "delete"] : [])].map(kind => h(RN.View, { key: kind, style: { marginBottom: SPACE.sm } }, button({ reply: "Reply", copy: "Copy Text", edit: "Edit Message", delete: "Delete Message" }[kind], null, null, null, "action-" + kind, () => act(kind))))));
    }
    class Composer extends React.Component {
      render() { const id = this.props.id, c = conv(id), d = drafts.get(id) || { text: "", reply: null, edit: null }, allowed = permission("SEND_MESSAGES", channel(id)); return h(RN.View, { testID: "message-composer", style: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.md, backgroundColor: colors().bg, borderTopWidth: 1, borderTopColor: colors().line } },
        d.reply || d.edit ? h(RN.View, { style: { flexDirection: "row", alignItems: "center" } }, t(d.edit ? "Editing message" : "Replying to " + d.reply.author, { flex: 1, color: colors().accent, fontSize: TYPE.small }), ib("CloseIcon", "Cancel", null, null, "cancel-reply", () => { drafts.set(id, { ...d, reply: null, edit: null }); emit(); })) : null,
        c.error ? t(c.error, { color: colors().danger, fontSize: TYPE.small, marginBottom: SPACE.sm }) : null,
        c.pending ? h(RN.View, { style: { flexDirection: "row", alignItems: "center" } }, t(c.pending.status === "sending" ? "Sending..." : "Awaiting Discord confirmation", { color: colors().muted, fontSize: TYPE.small, flex: 1 }), c.pending.status === "confirming" ? button("Check", null, null, null, "check-delivery", () => loadMessages(id)) : null) : null,
        h(RN.View, { style: { flexDirection: "row", alignItems: "flex-end", borderRadius: RAD.large, backgroundColor: colors().surface, borderWidth: 1, borderColor: colors().line, paddingLeft: SPACE.lg, paddingRight: SPACE.xs, paddingVertical: SPACE.xs } },
          ib("PlusIcon", "Attachments and more", null, null, "composer-more", () => RN.Alert?.alert("Attachments and more", "Uploads, GIFs, stickers, slash commands and voice messages still use Discord's composer in this alpha.", [{ text: "Cancel", style: "cancel" }, { text: "Open Discord Composer", onPress: () => nativeConversation(id) }])),
          h(RN.TextInput, { testID: "composer-text", accessibilityLabel: "Message", placeholder: allowed ? "Message " + this.props.name : "You do not have permission to send messages", placeholderTextColor: colors().faint,
            value: d.text, editable: allowed && !c.pending, multiline: true, blurOnSubmit: false, maxLength: 4000,
            onChangeText: value => { drafts.set(id, { ...d, text: value }); emit(); },
            style: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 140, paddingVertical: SPACE.md, paddingRight: SPACE.sm, fontSize: TYPE.body, lineHeight: 22, color: colors().ink } }),
          ib("SendIcon", d.edit ? "Save" : "Send", null, null, "send-message", () => submit(id), !allowed || !!c.pending || !d.text.trim()))); }
    }
    class Conversation extends React.Component {
      constructor(p) { super(p); this.initialScroll = false; this.nearBottom = true; this.lastId = null; }
      render() { const id = state.channel, c = channel(id), dm = listDms().find(d => d.id === id), name = dm?.name || (c?.name ? "#" + c.name : "Messages"), data = messages(id), record = conv(id), NativeList = RN.FlatList;
        const header = h(Header, { title: name, back: true, right: ib("VoiceIcon", "Voice Call", null, null, "open-call", () => push({ screen: "call", channel: id })) });
        const row = item => h(MessageCard, { key: item.id, message: item, channelId: id });
        const feed = NativeList ? h(NativeList, { key: id, testID: "conversation-list", ref: ref => { this.list = ref; }, data, keyExtractor: m => m.id, renderItem: ({ item }) => row(item),
          style: { flex: 1, backgroundColor: colors().bg }, stickyHeaderIndices: [0], stickyHeaderHiddenOnScroll: true, scrollEventThrottle: 16,
          ListHeaderComponent: h(RN.View, null, header),
          ListFooterComponent: record.busy ? t("Loading...", { padding: SPACE.lg, color: colors().muted }) : null,
          ListEmptyComponent: h(RN.View, { style: { padding: SPACE.xl } }, h(Empty, { title: record.busy ? "Loading messages..." : record.error ? "Messages unavailable" : "No messages yet", error: record.error })),
          onScroll: e => { const n = e?.nativeEvent; if (n?.contentSize && n?.layoutMeasurement) this.nearBottom = n.contentSize.height - n.layoutMeasurement.height - n.contentOffset.y < 100; },
          maintainVisibleContentPosition: { minIndexForVisible: 1 },
          onContentSizeChange: () => { const last = data[data.length - 1]?.id; if (data.length && (!this.initialScroll || (this.nearBottom && this.lastId !== last))) { safe(() => this.list.scrollToEnd({ animated: this.initialScroll && !cfg("reduceMotion") })); this.initialScroll = true; } this.lastId = last; },
          onRefresh: () => loadMessages(id, true), refreshing: record.busy, keyboardShouldPersistTaps: "handled", keyboardDismissMode: "interactive", removeClippedSubviews: false }) :
          h(RN.ScrollView, { testID: "conversation-list", style: { flex: 1 }, stickyHeaderIndices: [0], stickyHeaderHiddenOnScroll: true, keyboardShouldPersistTaps: "handled" }, header, record.hasMore ? button("Load earlier messages", null, null, { margin: SPACE.lg }, "load-earlier", () => loadMessages(id, true), record.busy) : null, ...data.map(row));
        return h(RN.KeyboardAvoidingView || RN.View, { style: { flex: 1 }, behavior: RN.Platform?.OS === "ios" ? "padding" : undefined, keyboardVerticalOffset: 0 }, feed, h(Composer, { id, name }), h(MessageMenu)); }
    }
    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
    function Media() {
      const a = state.media; if (!a) return h(Page, { title: "Media", back: true }, h(Empty, { title: "Attachment unavailable" }));
      const image = a.type.startsWith("image/"), playable = /^(video|audio)\//.test(a.type), W = safe(() => unwrap(mod("WebView")?.WebView), null);
      const html = playable && validUrl(a.url) ? '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; media-src https:; style-src \'unsafe-inline\'"><style>html,body{margin:0;height:100%;background:' + colors().bg + ';display:grid;place-items:center}video,audio{width:100%;max-height:100vh}</style><' + (a.type.startsWith("video/") ? "video" : "audio") + ' controls playsinline preload="metadata" src="' + escapeHtml(a.url) + '"></' + (a.type.startsWith("video/") ? "video" : "audio") + '>' : null;
      return h(RN.View, { style: { flex: 1, backgroundColor: colors().bg } }, h(Header, { title: a.name, back: true, right: ib("MoreIcon", "Share", null, null, "share-media", () => safe(() => RN.Share.share({ url: a.url }))) }),
        image ? h(RN.ScrollView, { testID: "image-viewer", style: { flex: 1 }, contentContainerStyle: { flexGrow: 1, justifyContent: "center", alignItems: "center" }, minimumZoomScale: 1, maximumZoomScale: 4, centerContent: true }, h(RN.Image, { source: { uri: a.url }, resizeMode: "contain", accessibilityLabel: a.name, style: { width: "100%", height: Math.max(240, safe(() => RN.Dimensions.get("window").height, 700) - 180) } })) :
          html && W ? h(W, { testID: "media-player", style: { flex: 1, backgroundColor: colors().bg }, source: { html }, originWhitelist: ["about:blank"], javaScriptEnabled: false, domStorageEnabled: false, allowsInlineMediaPlayback: true, mediaPlaybackRequiresUserAction: true, allowFileAccess: false, onShouldStartLoadWithRequest: r => r.url === "about:blank" }) :
            h(RN.View, { style: { padding: SPACE.xl } }, h(Empty, { title: "Preview unavailable" }), button("Open File", null, null, null, "open-file", () => openUrl(a.url))));
    }
    class CallScreen extends React.Component {
      constructor(p) { super(p); this.state = { busy: false }; }
      async run(action, id) { if (this.state.busy) return; this.setState({ busy: true }); await voiceAction(action, id); if (this.mounted) this.setState({ busy: false }); }
      componentDidMount() { this.mounted = true; } componentWillUnmount() { this.mounted = false; }
      render() { const id = state.channel || voiceId(), c = channel(id), dm = listDms().find(d => d.id === id), active = voiceId() === id, connected = active && call(stores.RTCConnectionStore, "isConnected", [], false), participants = voiceStates(id);
        const muted = call(stores.MediaEngineStore, "isSelfMute", [], null), deaf = call(stores.MediaEngineStore, "isSelfDeaf", [], null);
        return h(Page, { title: dm?.name || c?.name || "Voice Call", back: true },
          t(connected ? "Connected" : active ? "Connecting..." : "Voice Call", { color: colors().accent, fontSize: TYPE.caption, marginBottom: SPACE.xl }),
          h(RN.View, { style: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" } }, ...(participants.length ? participants : isPrivate(c) ? (c.recipients || []).map(userId => ({ userId })) : []).map((v, i) => { const u = user(v.userId || v.user_id); return h(RN.View, { key: v.userId || v.user_id || i, style: { width: "48%", minHeight: 160, alignItems: "center", justifyContent: "center", backgroundColor: colors().surface, borderRadius: RAD.large, borderWidth: 1, borderColor: colors().line, marginBottom: SPACE.md, padding: SPACE.lg } }, h(Avatar, { name: userName(u), uri: imageUrl(u, "user"), size: 72 }), t(userName(u), { fontSize: TYPE.caption, fontWeight: "600", marginTop: SPACE.md }, { numberOfLines: 1 })); })),
          h(RN.View, { style: { marginTop: SPACE.xl } }, active ? h(RN.View, null,
            h(RN.View, { style: { flexDirection: "row", marginBottom: SPACE.lg } }, button(muted === true ? "Unmute" : "Mute", null, null, { flex: 1, marginRight: SPACE.sm }, "call-mute", () => this.run("mute", id), this.state.busy || !mod("toggleSelfMute")?.toggleSelfMute), button(deaf === true ? "Undeafen" : "Deafen", null, null, { flex: 1 }, "call-deafen", () => this.run("deafen", id), this.state.busy || !mod("toggleSelfDeaf")?.toggleSelfDeaf)),
            button("Disconnect", null, null, { borderWidth: 1, borderColor: colors().danger }, "call-disconnect", () => this.run("leave", id), this.state.busy)) :
            button(this.state.busy ? "Connecting..." : isPrivate(c) ? "Start Voice Call" : "Join Voice", null, null, { backgroundColor: colors().accentSoft }, "call-join", () => this.run("join", id), this.state.busy || !permission("CONNECT", c))),
          h(Section, { title: "Video and Screen Share" }), button("Discord Call Controls", null, null, null, "native-call-controls", () => nativeConversation(id))); }
    }
    function ServerDrawer(p) {
      return h(RN.View, { testID: "server-drawer", style: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "flex-end", backgroundColor: colors().shade } },
        h(Control, { id: "drawer-dismiss", label: "Close server drawer", action: "drawer-close", style: { flex: 1 } }),
        h(RN.View, { style: { height: "72%", backgroundColor: colors().bg, borderTopLeftRadius: RAD.sheet, borderTopRightRadius: RAD.sheet, overflow: "hidden" } },
          h(Page, { title: "Servers", right: ib("CloseIcon", "Close", "drawer-close", null, "drawer-close"), id: "drawer-scroll" }, h(ServerGrid, { items: guilds(), width: p.width })),
          button("View all servers", "expand", null, { marginHorizontal: SPACE.xl, marginBottom: SPACE.lg }, "expand-drawer")));
    }
    function Dock() {
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
    SkinFrame = class extends React.Component {
      constructor(p) { super(p); this.state = { failed: false }; this.enter = animated() ? new RN.Animated.Value(0) : null; }
      componentDidMount() { if (this.enter) safe(() => RN.Animated.timing(this.enter, { toValue: 1, duration: 260, useNativeDriver: true }).start()); }
      componentDidCatch() { issue("skin-render-failed"); api.storage.nativeSkin = false; this.setState({ failed: true }); }
      render() {
        if (this.state.failed) return this.props.fallback !== undefined ? this.props.fallback : this.props.children;
        if (!this.enter) return this.props.children;
        return h(RN.Animated.View, { style: { opacity: this.enter, transform: [{ translateY: this.enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] } }, this.props.children);
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
        const c = colors(), Safe = RN.SafeAreaView || RN.View, width = Math.min(this.state.width, 820), mine = embeddedRoute === rest.route?.name, tab = mine ? state.tab : SCREEN_TAB[rest.route?.name], screen = mine ? state.screen : "main";
        const content = screen === "media" ? h(Media) : screen === "call" ? h(CallScreen) : screen === "edit-profile" ? h(EditProfile) : screen === "preferences" ? h(Preferences) : screen === "profile" ? h(Profile, { id: state.profile }) : screen === "channels" ? h(Channels) : tab === "servers" ? h(Servers, { width }) : tab === "messages" ? h(Messages) : tab === "you" ? h(Profile, { id: accountId }) : h(Home, { width });
        return h(Safe, { testID: "reimagined-native-screen", style: { flex: 1, backgroundColor: c.bg, paddingBottom: rest.overlay ? 0 : 84 } }, h(Boundary, { key: screen + ":" + tab }, h(SkinFrame, null, content)), state.drawer && mine ? h(ServerDrawer, { width }) : null);
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
        return h(React.Fragment, null, anchor, h(RN.View, { testID: "reimagined-native-overlay", pointerEvents: "box-none", style: { position: "absolute", left: -box.x, top: -box.y, width: win.width, height: top, zIndex: 50 } },
          h(NativeHost, { route: { name: route }, navigation: safe(() => root(), null), overlay: true, __reimaginedOrig: () => null })));
      }
    };
    Boundary = class extends React.Component { constructor(p) { super(p); this.state = { failed: false }; } componentDidCatch() { issue("surface-render-failed"); this.setState({ failed: true }); } render() { return this.state.failed ? h(RN.View, { style: { backgroundColor: colors().bg, padding: SPACE.xl } }, t("This screen could not be displayed."), button("Back", "back", null, { marginTop: SPACE.lg }), button("Settings", "settings", null, { marginTop: SPACE.md }), button("Copy compatibility report", "report", null, { marginTop: SPACE.md }), button("Restore Discord", "restore", null, { marginTop: SPACE.md }, "render-error-restore")) : this.props.children; } };
    Scene = class extends React.Component {
      constructor(p) { super(p); this.state = { tick: 0, width: safe(() => RN.Dimensions.get("window").width, 390) }; this.refresh = () => this.setState(s => ({ tick: s.tick + 1 })); }
      componentDidMount() { sceneCount++; routeOpening = false; if (this.props.presentation === "route") { activeSceneNavigation = this.props.navigation; this.focusOff = safe(() => this.props.navigation?.addListener?.("focus", () => this.ackRoute()), null); } listeners.add(this.refresh); this.dimensions = safe(() => RN.Dimensions.addEventListener("change", ({ window }) => this.setState({ width: window.width })), null); loadProfile(accountId); }
      componentWillUnmount() { sceneCount = Math.max(0, sceneCount - 1); listeners.delete(this.refresh); this.dimensions?.remove?.(); if (typeof this.focusOff === "function") this.focusOff(); else this.focusOff?.remove?.(); if (this.props.presentation === "route") presenter?.routeUnmounted(this.props.ticket); }
      ackRoute() { const f = this.routeFrame; if (this.props.presentation === "route" && f) presenter.routeReady(this.props.ticket, isOurRoute(this.props.ticket), f.width, f.height); }
      render() { if (!live || (this.props.presentation === "route" && !presenter.acceptsRoute(this.props.ticket))) return h(RN.View, { style: { flex: 1, padding: SPACE.xl } }, t("Return to Discord"), h(RN.Pressable || RN.TouchableOpacity, { onPress: () => leaveOwnRoute(this.props.ticket), style: { padding: SPACE.lg } }, t("Back to Discord"))); if (!me()) return h(RN.View, { style: { flex: 1, backgroundColor: colors().bg } }, h(Empty, { title: "Sign in to Discord" }));
        const Safe = RN.SafeAreaView || RN.View, width = Math.min(this.state.width, 820);
        const content = state.screen === "conversation" ? h(Conversation, { key: state.channel }) : state.screen === "media" ? h(Media) : state.screen === "call" ? h(CallScreen) : state.screen === "edit-profile" ? h(EditProfile) : state.screen === "preferences" ? h(Preferences) : state.screen === "profile" ? h(Profile, { id: state.profile }) : state.screen === "channels" ? h(Channels) : state.tab === "servers" ? h(Servers, { width }) : state.tab === "messages" ? h(Messages) : state.tab === "you" ? h(Profile, { id: accountId }) : h(Home, { width });
        return h(Safe, { testID: "reimagined-scene", onLayout: event => { this.routeFrame = event?.nativeEvent?.layout; this.ackRoute(); }, style: { flex: 1, backgroundColor: colors().bg } }, h(Boundary, { key: state.screen + ":" + (state.channel || state.tab) }, content), h(Control, { id: "restore-discord", label: "Restore Discord", action: "restore", style: { minHeight: 44, alignSelf: "center", paddingHorizontal: SPACE.md } }, t("Restore Discord", { fontSize: TYPE.small, color: colors().muted })), state.screen === "main" || state.screen === "channels" ? h(Dock) : null, state.drawer ? h(ServerDrawer, { width }) : null);
      }
    };
    DockHost = class extends React.Component {
      constructor(p) { super(p); this.state = { tick: 0 }; this.refresh = () => this.setState(s => ({ tick: s.tick + 1 })); }
      componentDidMount() {
        presentationHosts.add(this); if (!modalOwner) modalOwner = this;
        listeners.add(this.refresh);
        if (this.props.mode !== "settings" && cfg("layout") && !cfg("nativeScreens") && cfg("startHome") && !autoPresented && me()) {
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
        const launch = this.props.mode === "settings" || !me() || cfg("nativeScreens") ? null
          : cfg("layout") ? button("Reimagined", null, null, { marginHorizontal: SPACE.lg }, "reimagined-launcher", () => present())
          : button("Return to Reimagined", null, null, { marginHorizontal: SPACE.lg, backgroundColor: colors().accentSoft }, "reimagined-return", () => { api.storage.layout = true; present(); });
        const overlay = this.props.mode !== "settings" && cfg("nativeScreens") && me() && NativeOverlay ? h(NativeOverlay) : null;
        return h(React.Fragment, null, this.props.original, launch, overlay,
          RN.Modal ? h(RN.Modal, { visible: p.modal && modalOwner === this,
            presentationStyle: "fullScreen", animationType: "none",
            onShow: () => presenter.modalShown(p.ticket),
            onRequestClose: () => presenter.dismiss(null, false),
            onDismiss: () => presenter.modalDismissed(p.ticket) },
            h(Boundary, null, h(Scene, { presentation: "modal", ticket: p.ticket }))) : null);
      }
    };
    // Plugin settings remain a small entry point; profile and appearance have their own screens.
    buildUI.Settings = () => live ? h(RN.ScrollView, { contentContainerStyle: { padding: SPACE.xl } }, button("Open Discord: Reimagined", null, null, { backgroundColor: colors().accentSoft }, "open-reimagined", () => present("home")),
      button("Appearance", null, null, { marginTop: SPACE.lg }, "open-appearance", () => { state = { ...state, screen: "preferences" }; present(); }), button("Copy compatibility report", "report", null, { marginTop: SPACE.lg }, "copy-report"), t(VERSION, { marginTop: SPACE.lg, fontSize: TYPE.small, color: colors().muted })) : null;
  }
  function renderTarget(raw, name) { for (const value of [raw?.[name], raw?.default, raw]) { let node = unwrap(value); if (!node) continue; if (typeof node === "function" && node.prototype?.render) return [node.prototype, "render"]; if (typeof node === "function") { if (raw?.[name] === node) return [raw, name]; if (raw?.default === node) return [raw, "default"]; } for (let i = 0; node && i < 5; i++) { if (typeof node.type === "function") return [node, "type"]; if (typeof node.render === "function") return [node, "render"]; node = node.type; } } return null; }
  function patch(raw, name, mode) { const target = safe(() => renderTarget(raw, name), null); if (!live || !target) return false; const [object, method] = target, seen = targets.get(object) || new Set(); if (seen.has(method)) return true;
    try { api.patcher.after(method, object, (_args, output) => { if (live && cfg("blueprint")) safe(() => recordTabBar(name, _args[0])); if (!live || output == null || !me() || (mode === "launcher" && health.hooks.YouBar === "patched")) return output; return h(DockHost, { original: output, mode }); }); seen.add(method); targets.set(object, seen); health.hooks[name] = "patched"; return true; } catch (_) { issue("hook-failed:" + name); return false; } }
  let SkinFrame, NativeHost, NativeOverlay, embeddedRoute = null;
  const SCREEN_TAB = { guilds: "home", notifications: "messages", you: "you" };
  // Diagnostic: lists (in the compatibility report) which navigation-related elements Discord really creates, with their prop names.
  let navProbeCount = 0;
  function navProbe(type, props) {
    const name = typeName(type), keys = Object.keys(props);
    const hit = props.route || props.navigation || props.descriptors || props.state || /screen|scene|navigator|stack|route|tab|pager|layout/i.test(name);
    const rn = currentRouteName();
    if (rn && SCREEN_TAB[rn] && typeof type !== "string" && name.length <= 3) {
      const ek = "Elem:" + rn, cur = health.hooks[ek] || "";
      if (cur.length < 400 && !cur.includes(name + "{")) health.hooks[ek] = cur + (cur ? " " : "") + name + "{" + keys.slice(0, 6).join(",") + "}";
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
  }
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
  }
  const blueprint = { hub: null, routes: {}, samples: 0, search: [], probes: [], hubSearch: null, census: {}, tour: [], screens: {}, screenRoots: {}, tabBars: {} };
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
      if (props.route && typeof props.route.name === "string" && props.navigation && typeof type !== "string") { const list = blueprint.screenRoots[props.route.name] || (blueprint.screenRoots[props.route.name] = []), sig = name + "|" + Object.keys(props).sort().join(","); if (list.length < 4 && !list.some(x => x.sig === sig)) list.push({ sig, type: name, keys: Object.keys(props).slice(0, 14) }); }
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
    const data = { product: "Discord: Reimagined", version: VERSION, kind: "settings-blueprint", hubExports: hub ? Object.keys(hub).slice(0, 120) : null, route: currentRouteName(), routes: blueprint.routes, census: blueprint.census, screens: blueprint.screens, screenRoots: blueprint.screenRoots, tabBars: blueprint.tabBars, tour: blueprint.tour, search: blueprint.search, searchProbes: blueprint.probes, hubSearchExports: blueprint.hubSearch, patched: { group: health.hooks.NativeSkinTableRowGroup, row: health.hooks.NativeSkinTableRow } };
    if (c?.setString) { c.setString(JSON.stringify(data)); toast("Settings blueprint copied"); }
  }
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
    patchScreens();
    pass("SearchField", "nativeSkin", output => SkinFrame ? h(SkinFrame, { fallback: output }, safe(() => skinSearch(output), output)) : output);
    probeSearch();
  }
  function scan() { [["YouBar", "dock"], ["YouBarNotificationsButton", "launcher"]].forEach(([name, mode]) => { if (health.hooks[name] === "patched") return; const raw = safe(() => api.metro.findByFileName(name, false), null) || safe(() => api.metro.findByTypeName(name, false), null); if (!patch(raw, name, mode)) health.hooks[name] = "settings entry required"; }); }
  function start(pluginApi) {
    api = pluginApi; live = true; epoch++; presenter = null; modalOwner = null; activeSceneNavigation = null; presentationInstance = Date.now().toString(36) + Math.random().toString(36).slice(2); presentationHosts.clear(); accountId = null; autoPresented = false; sceneCount = 0; routeOpening = false;
    React = unwrap(api.common.React); RN = unwrap(api.common.ReactNative); h = React.createElement;
    if (!React.Component || !RN.View || !RN.Text || !(RN.Pressable || RN.TouchableOpacity)) throw new Error("Required React Native primitives are unavailable.");
    Object.keys(DEFAULTS).forEach(k => { if (api.storage[k] === undefined) api.storage[k] = typeof DEFAULTS[k] === "object" ? {} : DEFAULTS[k]; }); targets = new WeakMap();
    ["UserStore", "GuildStore", "SortedGuildStore", "ChannelStore", "GuildChannelStore", "PermissionStore", "PrivateChannelSortStore", "PrivateChannelReadStateStore", "ReadStateStore", "RelationshipStore", "MessageStore", "UserProfileStore", "PresenceStore", "SelectedChannelStore", "VoiceStateStore", "RTCConnectionStore", "MediaEngineStore"].forEach(store);
    checkAccount(); buildUI(); initPresentation();
    Object.values(stores).forEach(s => { if (s?.addChangeListener) { s.addChangeListener(changed); stops.push(() => s.removeChangeListener?.(changed)); } });
    const flux = safe(() => unwrap(api.common.FluxDispatcher), null);
    if (flux?.subscribe) [["MESSAGE_CREATE", "create"], ["MESSAGE_UPDATE", "update"], ["MESSAGE_DELETE", "delete"]].forEach(([name, kind]) => { const f = e => messageEvent(e, kind); flux.subscribe(name, f); stops.push(() => flux.unsubscribe?.(name, f)); });
    [["YouBar", "dock"], ["YouBarNotificationsButton", "launcher"]].forEach(([name, mode]) => [api.metro.byFileName, api.metro.byTypeName].filter(f => typeof f === "function").forEach(make => { const cancel = safe(() => api.metro.waitFor(make(name), raw => patch(raw, name, mode), { raw: true }), null); if (typeof cancel === "function") stops.push(cancel); }));
    health.capabilities.nativeRoute = !!root()?.navigate; health.capabilities.messageActions = !!mod("sendMessage", "editMessage"); health.capabilities.voice = !!mod("selectVoiceChannel"); health.capabilities.webView = !!mod("WebView")?.WebView;
    scan(); syncTheme(); patchNativeSkin();
  }
  async function stop() { stopTour(); stopReturnWatch(); presenter?.stop(); live = false; epoch++; clearTimeout(storeTimer); storeTimer = null; stops.splice(0).forEach(f => safe(f)); Array.from(listeners).forEach(f => safe(f)); listeners.clear(); conversations.clear(); drafts.clear(); profiles.clear(); await themeQueue; await restoreTheme(); Object.keys(stores).forEach(k => delete stores[k]); Object.keys(modules).forEach(k => delete modules[k]); assets.clear(); }
  return definePlugin({ start, stop, SettingsComponent: () => live && buildUI.Settings ? h(DockHost, { mode: "settings", original: h(buildUI.Settings) }) : null, diagnostics: report, scanApp: startTour });
})()
