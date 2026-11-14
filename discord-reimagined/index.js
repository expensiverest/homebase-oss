(() => {
  "use strict";
  /* Discord: Reimagined 0.1.0-alpha.1 | GPL-3.0-only
   * Original implementation for Distra. Reference map: docs/REFERENCE_AUDIT.md.
   * No network client, message sending, token access, or global JSX interception.
   * Hallmark pre-emit critique: P4 H4 E4 S5 R5 V4 (native verification pending).
   */
  const VERSION = "0.1.0-alpha.1";
  const THEME_ID = "discord-reimagined";
  const DEFAULTS = { palette: "midnight", density: "comfortable", nativePalette: true,
    startHome: true, diagnostics: false, reduceMotion: false, layout: true,
    showPreviews: true, grid: true, accounts: {} };
  // Native sRGB equivalents of the named OKLCH tokens in tokens.css.
  const PALETTES = {
    midnight: { name: "Midnight", bg: "#141918", surface: "#1c2320", elevated: "#27302b", line: "#39443d", ink: "#f0f2e9", muted: "#a8b5aa", faint: "#8a9b8e", accent: "#bdd7b7", accentInk: "#203323", accentSoft: "#2d3b2e", danger: "#f3b9ad", clear: "transparent", shade: "rgba(10,15,12,0.6)" },
    pearl: { name: "Pearl", bg: "#f4f3ed", surface: "#fcfbf6", elevated: "#e8ece2", line: "#c8d0c4", ink: "#242d27", muted: "#536455", faint: "#637365", accent: "#3b6345", accentInk: "#f5f8ef", accentSoft: "#dce7d5", danger: "#9b3930", clear: "transparent", shade: "rgba(10,15,12,0.45)" },
    slate: { name: "Slate", bg: "#171b22", surface: "#20262e", elevated: "#2c3540", line: "#414f5d", ink: "#edf0f3", muted: "#acb8c4", faint: "#90a1b1", accent: "#b8cfe7", accentInk: "#25354a", accentSoft: "#2d3e50", danger: "#f1b5ba", clear: "transparent", shade: "rgba(10,14,20,0.6)" }
  };
  const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 };
  const TYPE = { small: 12, caption: 14, body: 16, title: 20, section: 24, display: 34 };
  const RAD = { small: 12, medium: 18, large: 24, sheet: 30, round: 999 };
  const NAV = [ { id: "home", label: "Home", icon: "HomeIcon" }, { id: "spaces", label: "Spaces", icon: "SquaresIcon" },
    { id: "messages", label: "Chats", icon: "ChatIcon" }, { id: "you", label: "You", icon: "UserCircleIcon" } ];
  const ICON_FALLBACK = { HomeIcon: "\u2302", SquaresIcon: "\u25a6", ChatIcon: "\u25a1", UserCircleIcon: "\u25cb", MagnifyingGlassIcon: "\u2315", StarIcon: "\u2606", ChevronSmallRightIcon: "\u203a", ChevronSmallLeftIcon: "\u2039", ChevronSmallDownIcon: "\u2304", XSmallIcon: "\u00d7", ArrowSquareUpRightIcon: "\u2197", SettingsIcon: "\u2699", HashIcon: "#", SpeakerIcon: "\u266a", PinIcon: "\u2022", RefreshIcon: "\u21bb" };
  let api, React, RN, h, Control, Boundary, Host;
  let live = false, owner = null, autoPresented = false, suppressAuto = false, pending = null, pendingTimer = null;
  let generation = 0, storeTimer = null, unsubscribe = [], iconCache = new Map(), targets = new WeakMap();
  let paletteQueue = Promise.resolve(), themeBackup = null, ownsTheme = false;
  const hosts = new Set(), listeners = new Set(), storeCache = {}, moduleCache = {};
  let view = { open: false, tab: "home", presentation: "full", guild: null, search: "", filter: "all", limit: 60 };
  const health = { hooks: {}, stores: {}, actions: {}, issues: [], taps: [], frames: {}, mounts: 0 };
  function attempt(fn, fallback) { try { const value = fn(); return value == null ? fallback : value; } catch (_) { return fallback; } }
  function unwrap(value) {
    let out = value;
    for (let i = 0; i < 5 && out != null; i++) {
      const resolve = attempt(() => out[Symbol.for("distra.lazy")], null);
      if (typeof resolve !== "function") break;
      const next = resolve(); if (next === out) break; out = next;
    }
    return out;
  }
  function cfg(key) { return api && api.storage[key] !== undefined ? api.storage[key] : DEFAULTS[key]; }
  function colors() { return PALETTES[cfg("palette")] || PALETTES.midnight; }
  function issue(code) {
    if (!health.issues.includes(code)) health.issues = health.issues.concat(code).slice(-20);
    attempt(() => api.logger.warn("[Reimagined] " + code));
  }
  function emit() { if (live) Array.from(listeners).forEach(fn => attempt(fn)); }
  function changed() { if (!storeTimer && live) storeTimer = setTimeout(() => { storeTimer = null; emit(); }, 80); }
  function toast(text) { attempt(() => api.toasts.showToast(text)); }
  function store(name) {
    if (!storeCache[name]) storeCache[name] = attempt(() => unwrap(api.metro.findByStoreName(name)), null);
    health.stores[name] = !!storeCache[name]; return storeCache[name];
  }
  function moduleWith(name) {
    if (!moduleCache[name]) moduleCache[name] = attempt(() => unwrap(api.metro.findByProps(name)), null);
    return moduleCache[name];
  }
  function call(object, name, args, fallback) { return attempt(() => typeof object?.[name] === "function" ? object[name](...(args || [])) : fallback, fallback); }
  function currentUser() { return call(storeCache.UserStore, "getCurrentUser", [], null); }
  function account() {
    const id = currentUser()?.id;
    // Do not combine unknown/logged-out accounts into a persisted shared bucket.
    if (!id) return { pins: [], recent: [] };
    if (!api.storage.accounts || Array.isArray(api.storage.accounts)) api.storage.accounts = {};
    if (!api.storage.accounts[id]) api.storage.accounts[id] = { pins: [], recent: [] };
    const value = api.storage.accounts[id];
    if (!Array.isArray(value.pins)) value.pins = [];
    if (!Array.isArray(value.recent)) value.recent = [];
    return value;
  }
  function isPinned(kind, id) { return account().pins.some(p => p.kind === kind && p.id === id); }
  function togglePin(kind, id, guildId) {
    const a = account(); if (!currentUser()) return;
    a.pins = isPinned(kind, id) ? a.pins.filter(p => !(p.kind === kind && p.id === id)) : a.pins.concat({ kind, id, guildId: guildId || null }).slice(-80);
    emit();
  }
  function remember(kind, id, guildId) {
    const a = account(); if (!currentUser()) return;
    a.recent = [{ kind, id, guildId: guildId || null }, ...a.recent.filter(p => !(p.kind === kind && p.id === id))].slice(0, 18);
  }
  function flattenNodes(nodes, folder, out) {
    (Array.isArray(nodes) ? nodes : []).forEach(n => {
      if (!n) return;
      if (Array.isArray(n.children)) flattenNodes(n.children, n.type === "folder" ? String(n.id || n.name || "folder") : folder, out);
      else if (n.id && n.type !== "root") out.push({ id: String(n.id), folder });
    });
    return out;
  }
  function guilds() {
    const data = call(storeCache.GuildStore, "getGuilds", [], {});
    const values = Object.values(data || {}).filter(g => g && g.id && typeof g.name === "string");
    const tree = call(storeCache.SortedGuildStore, "getGuildsTree", [], null);
    const order = flattenNodes(tree?.root?.children, null, []);
    const rank = new Map(order.map((n, i) => [n.id, i]));
    return values.sort((a, b) => (rank.get(a.id) ?? 100000) - (rank.get(b.id) ?? 100000) || a.name.localeCompare(b.name));
  }
  function userName(user) { return user?.globalName || user?.global_name || user?.username || "Unknown person"; }
  function unread(id) { return !!call(storeCache.ReadStateStore, "hasUnread", [id], false); }
  function mentions(id) { return Math.max(0, Number(call(storeCache.ReadStateStore, "getMentionCount", [id], 0)) || 0); }
  function dmList() {
    const channels = storeCache.ChannelStore;
    let ids = call(storeCache.PrivateChannelSortStore, "getPrivateChannelIds", [], null);
    if (!Array.isArray(ids)) ids = call(channels, "getSortedPrivateChannels", [], null);
    if (!Array.isArray(ids)) ids = Object.values(call(channels, "getMutablePrivateChannels", [], {}));
    if (!ids.length) ids = call(storeCache.PrivateChannelReadStateStore, "getUnreadPrivateChannelIds", [], []);
    const seen = new Set();
    return ids.map(v => typeof v === "string" ? call(channels, "getChannel", [v], null) : v?.channel || v)
      .filter(c => c && c.id && (c.type === 1 || c.type === 3) && !seen.has(c.id) && seen.add(c.id))
      .filter(c => c.type === 3 || !call(storeCache.RelationshipStore, "isBlocked", [c.recipients?.[0]], false))
      .map(c => {
        const userId = call(c, "getRecipientId", [], c.recipients?.[0]);
        const user = call(storeCache.UserStore, "getUser", [userId], null);
        const groupNames = (c.recipients || []).map(id => userName(call(storeCache.UserStore, "getUser", [id], null))).slice(0, 3).join(", ");
        const cached = cfg("showPreviews") ? call(storeCache.MessageStore, "getMessages", [c.id], null) : null;
        const last = call(cached, "last", [], null);
        const preview = typeof last?.content === "string" ? last.content.replace(/\s+/g, " ").slice(0, 140) : c.type === 3 ? "Group conversation" : "Direct message";
        return { id: c.id, name: c.name || (c.type === 3 ? groupNames || "Group conversation" : userName(user)), channel: c, user, preview, unread: unread(c.id), mentions: mentions(c.id) };
      });
  }
  function channelList(guildId) {
    // Read only channels permitted by Discord, never rely on cache presence as authorization.
    const grouped = call(storeCache.GuildChannelStore, "getChannels", [guildId], null);
    const permission = storeCache.PermissionStore;
    const constants = attempt(() => unwrap(api.common.constants), null);
    const viewPermission = constants?.Permissions?.VIEW_CHANNEL;
    if (!grouped || typeof permission?.can !== "function" || viewPermission == null) return null;
    const found = new Map();
    function walk(value, depth) {
      if (!value || depth > 5) return;
      if (Array.isArray(value)) { value.forEach(v => walk(v, depth + 1)); return; }
      if (value.channel) { walk(value.channel, depth + 1); return; }
      if (typeof value === "object" && value.id && typeof value.type === "number") { found.set(value.id, value); return; }
      if (typeof value === "object") Object.values(value).forEach(v => walk(v, depth + 1));
    }
    walk(grouped, 0);
    return Array.from(found.values()).filter(c => c.guild_id === guildId && c.type !== 4 && call(permission, "can", [viewPermission, c], false))
      .sort((a, b) => (a.position || 0) - (b.position || 0));
  }
  function photo(item, kind) {
    const util = moduleCache.getUserAvatarURL;
    if (kind === "user") return call(util, "getUserAvatarURL", [item, false, 128], null);
    if (kind === "guild" && item?.icon) return "https://cdn.discordapp.com/icons/" + encodeURIComponent(item.id) + "/" + encodeURIComponent(item.icon) + ".png?size=128";
    return null;
  }
  function icon(name) {
    if (iconCache.has(name)) return iconCache.get(name);
    const aliases = { SquaresIcon: ["SquaresIcon", "AppsIcon"], HomeIcon: ["HomeIcon", "HomeActiveIcon"], MagnifyingGlassIcon: ["MagnifyingGlassIcon", "SearchIcon", "ChannelListMagnifyingGlassIcon"] };
    const names = aliases[name] || [name];
    const find = attempt(() => globalThis.vendetta?.ui?.assets?.getAssetIDByName, null);
    const found = typeof find === "function" ? names.map(n => attempt(() => find(n), null)).find(n => typeof n === "number") : null;
    if (found != null) iconCache.set(name, found); return found;
  }
  function report() {
    return { product: "Discord: Reimagined", version: VERSION, nativeVerified: false, hooks: { ...health.hooks }, stores: { ...health.stores }, actions: { ...health.actions }, mounts: health.mounts,
      issues: health.issues.slice(), taps: health.taps.slice(), frames: { ...health.frames }, palette: cfg("palette"), open: view.open, tab: view.tab };
  }
  function copyReport() {
    const clipboard = attempt(() => unwrap(api.common.clipboard), null);
    if (typeof clipboard?.setString === "function") { clipboard.setString(JSON.stringify(report(), null, 2)); toast("Compatibility report copied. No message or account data included."); }
    else toast("Clipboard is unavailable in this Discord build.");
  }
  function rootRef() { return attempt(() => unwrap(api.common.tabsNavigationRef).getRootNavigationRef(), null); }
  function finishNative() {
    if (!pending) return;
    const task = pending; pending = null; clearTimeout(pendingTimer); pendingTimer = null;
    if (!live || task.generation !== generation) return;
    try {
      const routing = moduleWith("transitionToGuild");
      if (task.kind === "dm") {
        const action = moduleWith("selectPrivateChannel");
        if (typeof action?.selectPrivateChannel !== "function") throw new Error("private-channel-action-missing");
        action.selectPrivateChannel(task.id);
      } else if (task.kind === "guild" || task.kind === "channel") {
        if (typeof routing?.transitionToGuild !== "function") throw new Error("guild-navigation-missing");
        routing.transitionToGuild(task.kind === "guild" ? task.id : task.guildId, task.kind === "channel" ? task.id : null);
      } else if (task.kind === "settings") {
        const root = rootRef();
        if (typeof root?.navigate === "function") root.navigate("settings");
        else {
          const action = moduleWith("openUserSettings");
          if (typeof action?.openUserSettings !== "function") throw new Error("settings-navigation-missing");
          action.openUserSettings();
        }
      }
      health.actions[task.kind] = "called; device outcome not asserted";
      if (task.id) remember(task.kind, task.id, task.guildId);
    } catch (error) {
      issue("navigation:" + task.kind + ":" + String(error.message || "unavailable"));
      toast("That Discord navigation action is unavailable. The original app is still accessible.");
    }
    emit();
  }
  function openNative(kind, id, guildId) {
    pending = { kind, id, guildId, generation };
    const wasOpen = view.open; view = { ...view, open: false }; emit();
    // On iOS, finish after Modal.onDismiss; fallback is cancellable and single-use.
    clearTimeout(pendingTimer); pendingTimer = setTimeout(finishNative, wasOpen ? 650 : 0);
  }
  function open(tab, presentation) {
    if (!live) return;
    pending = null; clearTimeout(pendingTimer); pendingTimer = null;
    view = { ...view, open: true, tab: tab || "home", presentation: presentation || "full", guild: null, search: "", filter: "all", limit: 60 }; emit();
  }
  function changeSetting(key, value) {
    api.storage[key] = value;
    if (key === "palette" || key === "nativePalette") syncTheme();
    emit();
  }
  function nativeTheme() {
    const c = colors(); const semantic = {};
    ["BACKGROUND_PRIMARY", "BACKGROUND_SECONDARY", "BACKGROUND_TERTIARY", "CHAT_BACKGROUND", "BG_BASE_PRIMARY", "BG_BASE_SECONDARY", "BG_BASE_TERTIARY", "BACKGROUND_BASE_LOWEST", "BACKGROUND_BASE_LOWER", "BACKGROUND_BASE_LOW", "MOBILE_BACKGROUND_BASE_PRIMARY"].forEach(k => { semantic[k] = c.bg; });
    ["BACKGROUND_FLOATING", "BACKGROUND_SECONDARY_ALT", "BG_SURFACE_OVERLAY", "BG_SURFACE_RAISED", "BACKGROUND_SURFACE_HIGH", "BACKGROUND_SURFACE_HIGHER", "BACKGROUND_SURFACE_HIGHEST", "CHANNELTEXTAREA_BACKGROUND", "PANEL_BG"].forEach(k => { semantic[k] = c.surface; });
    ["TEXT_NORMAL", "TEXT_DEFAULT", "TEXT_PRIMARY", "HEADER_PRIMARY", "INTERACTIVE_ACTIVE", "INTERACTIVE_NORMAL", "ICON_PRIMARY"].forEach(k => { semantic[k] = c.ink; });
    ["TEXT_MUTED", "HEADER_SECONDARY", "CHANNELS_DEFAULT", "TEXT_SECONDARY", "ICON_SECONDARY"].forEach(k => { semantic[k] = c.muted; });
    ["TEXT_LINK", "TEXT_BRAND", "ICON_BRAND", "CONTROL_BRAND_FOREGROUND"].forEach(k => { semantic[k] = c.accent; });
    semantic.BACKGROUND_BRAND = c.accentSoft;
    semantic.MESSAGE_MENTIONED_BACKGROUND_DEFAULT = c.accentSoft;
    return { spec: 3, type: "color", id: THEME_ID, version: VERSION, display: { name: "Reimagined / " + c.name, authors: [{ name: "Discord: Reimagined" }] },
      main: { type: cfg("palette") === "pearl" ? "light" : "dark", raw: { BRAND_500: c.accent, BRAND_360: c.accent, BLURPLE_50: c.accent }, semantic } };
  }
  function themeAPI() { return attempt(() => globalThis.vendetta?.themes, null); }
  function restoreTheme() {
    const themes = themeAPI(); const current = attempt(() => themes.getThemeFromLoader(), null);
    if (ownsTheme && current?.id === THEME_ID && typeof themes?.selectTheme === "function") {
      ownsTheme = false;
      return Promise.resolve(themes.selectTheme(themeBackup || "default")).then(() => { api.storage.themeBackup = null; }).catch(() => issue("theme-restore-failed"));
    }
    ownsTheme = false; return Promise.resolve();
  }
  function syncTheme() {
    const epoch = generation;
    paletteQueue = paletteQueue.then(async () => {
      if (!live || epoch !== generation) return;
      const themes = themeAPI();
      if (!cfg("nativePalette")) { await restoreTheme(); return; }
      if (typeof themes?.selectTheme !== "function") { issue("theme-api-missing"); return; }
      const current = attempt(() => themes.getThemeFromLoader(), null);
      if (current?.id !== THEME_ID) {
        themeBackup = current ? { id: current.id, data: current.data } : null;
        api.storage.themeBackup = themeBackup;
      } else if (!themeBackup && api.storage.themeBackup) themeBackup = api.storage.themeBackup;
      await themes.selectTheme({ id: THEME_ID, data: nativeTheme() }); ownsTheme = true;
    }).catch(() => issue("theme-apply-failed"));
    return paletteQueue;
  }
  function send(action, value) {
    if (!live) return;
    if (action === "tab") {
      if (!NAV.some(n => n.id === value)) return;
      view = { ...view, open: true, tab: value, guild: null, search: "", filter: "all", limit: 60 }; emit(); return;
    }
    if (action === "close") { view = { ...view, open: false }; pending = null; emit(); return; }
    if (action === "drawer") { open("spaces", "drawer"); return; }
    if (action === "expand") { view = { ...view, presentation: "full" }; emit(); return; }
    if (action === "search") { view = { ...view, search: String(value || ""), limit: 60 }; emit(); return; }
    if (action === "filter") { view = { ...view, filter: value, limit: 60 }; emit(); return; }
    if (action === "more") { view = { ...view, limit: view.limit + 60 }; emit(); return; }
    if (action === "guild") { view = { ...view, tab: "spaces", guild: value, search: "", filter: "all", presentation: "full", limit: 60 }; emit(); return; }
    if (action === "pin") { togglePin(value.kind, value.id, value.guildId); return; }
    if (action === "native") { openNative(value.kind, value.id, value.guildId); return; }
    if (action === "setting") { changeSetting(value.key, value.value); return; }
    if (action === "report") { copyReport(); return; }
    if (action === "retry") { scan(); emit(); return; }
    if (action === "clear") { if (currentUser()) { account().recent = []; emit(); } return; }
    if (action === "resume") { const recent = account().recent[0]; if (recent) openNative(recent.kind, recent.id, recent.guildId); else send("close"); }
  }
  function recordTap(id) {
    health.taps = [...health.taps, String(id).replace(/\d{5,}/g, "<id>")].slice(-12);
    if (cfg("diagnostics")) toast("Reimagined: " + id.split(":")[0]);
  }
  function buildUI() {
    function text(value, style, props) { return h(RN.Text, { style: [{ color: colors().ink, fontSize: TYPE.body, lineHeight: 22, fontWeight: "400" }, style], ...(props || {}) }, value); }
    function Icon(p) {
      const asset = icon(p.name), size = p.size || 22, color = p.color || colors().muted;
      return asset != null ? h(RN.Image, { source: asset, resizeMode: "contain", accessible: false, style: { width: size, height: size, tintColor: color } })
        : text(ICON_FALLBACK[p.name] || "\u2022", { fontSize: size, width: size + 2, textAlign: "center", color, lineHeight: size + 4 }, { accessible: false });
    }
    Control = class extends React.Component {
      constructor(props) { super(props); this.state = { pressed: false }; this.press = this.press.bind(this); }
      press() {
        if (this.props.disabled) return;
        recordTap(this.props.id || this.props.action || "control");
        if (this.props.run) this.props.run(); else send(this.props.action, this.props.value);
      }
      render() {
        const p = this.props, Native = RN.Pressable || RN.TouchableOpacity;
        return h(Native, { testID: p.id, accessibilityLabel: p.label, accessibilityRole: p.role || "button", accessibilityState: { disabled: !!p.disabled, selected: !!p.selected },
          disabled: !!p.disabled, onPress: this.press, onLongPress: p.longPress, hitSlop: 0,
          onPressIn: () => this.setState({ pressed: true }), onPressOut: () => this.setState({ pressed: false }),
          onLayout: p.measure ? e => { const frame = e?.nativeEvent?.layout; if (frame) health.frames[p.id] = { x: frame.x, y: frame.y, width: frame.width, height: frame.height }; } : undefined,
          style: [{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: p.disabled ? 0.4 : this.state.pressed ? 0.65 : 1 }, p.style] }, p.children);
      }
    };
    function button(label, action, value, style, id) { return h(Control, { label, action, value, id: id || action, style: [{ borderRadius: RAD.small, paddingHorizontal: SPACE.lg, backgroundColor: colors().elevated }, style] }, text(label, { fontSize: TYPE.caption, fontWeight: "600" }, { numberOfLines: 1 })); }
    function iconButton(name, label, action, value, id) { return h(Control, { label, action, value, id: id || action, style: { borderRadius: RAD.round } }, h(Icon, { name })); }
    function Avatar(p) {
      const c = colors(), size = p.size || 48, uri = p.uri;
      const initials = String(p.name || "?").trim().split(/\s+/).map(s => s.charAt(0)).slice(0, 2).join("").toUpperCase();
      return h(RN.View, { style: { width: size, height: size, borderRadius: p.square ? size * 0.28 : size / 2, backgroundColor: c.elevated, alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 } },
        uri ? h(RN.Image, { source: typeof uri === "number" ? uri : { uri }, style: { width: size, height: size }, resizeMode: "cover" }) : text(initials, { fontSize: size * 0.34, fontWeight: "600", color: c.accent, lineHeight: size }));
    }
    function Section(p) { return h(RN.View, { style: { marginTop: SPACE.xl, marginBottom: SPACE.md, flexDirection: "row", justifyContent: "space-between", alignItems: "center" } }, text(p.title, { fontSize: TYPE.title, fontWeight: "600", letterSpacing: -0.3 }), p.right || null); }
    function Empty(p) { return h(RN.View, { style: { paddingVertical: SPACE.xxxl, paddingHorizontal: SPACE.lg, alignItems: "flex-start" } }, h(Icon, { name: p.icon || "ChatIcon", size: 28, color: colors().accent }), text(p.title, { fontSize: TYPE.title, fontWeight: "600", marginTop: SPACE.md }), text(p.body, { fontSize: TYPE.caption, color: colors().muted, marginTop: SPACE.sm, marginBottom: SPACE.lg }), p.action ? button(p.cta, p.action, p.value) : null); }
    function Search(p) { return h(RN.View, { style: { flexDirection: "row", alignItems: "center", minHeight: 50, borderRadius: RAD.medium, paddingHorizontal: SPACE.lg, backgroundColor: colors().surface, borderWidth: 1, borderColor: colors().line } }, h(Icon, { name: "MagnifyingGlassIcon", size: 20 }), h(RN.TextInput, { testID: "search", accessibilityLabel: p.placeholder, placeholder: p.placeholder, placeholderTextColor: colors().faint, value: view.search, onChangeText: value => send("search", value), autoCorrect: false, autoCapitalize: "none", returnKeyType: "search", style: { flex: 1, minWidth: 0, color: colors().ink, fontSize: TYPE.caption, paddingHorizontal: SPACE.md, paddingVertical: SPACE.md } }), view.search ? iconButton("XSmallIcon", "Clear search", "search", "", "clear-search") : null); }
    function Filters(p) { return h(RN.View, { style: { flexDirection: "row", marginTop: SPACE.lg, marginBottom: SPACE.sm } }, ...p.options.map(o => h(Control, { key: o.id, id: "filter-" + o.id, action: "filter", value: o.id, label: o.name, selected: view.filter === o.id, style: { marginRight: SPACE.sm, borderRadius: RAD.round, paddingHorizontal: SPACE.lg, backgroundColor: view.filter === o.id ? colors().accentSoft : colors().clear } }, text(o.name, { fontSize: TYPE.caption, fontWeight: "600", color: view.filter === o.id ? colors().accent : colors().muted }, { numberOfLines: 1 })))); }
    function Pin(p) { const selected = isPinned(p.kind, p.id); return h(Control, { id: "pin:" + p.kind + ":" + p.id, label: (selected ? "Unpin " : "Pin ") + p.name, action: "pin", value: { kind: p.kind, id: p.id, guildId: p.guildId }, selected, style: { borderRadius: RAD.round } }, h(Icon, { name: "StarIcon", size: 18, color: selected ? colors().accent : colors().faint })); }
    function GuildCard(p) {
      const g = p.guild, c = colors();
      return h(RN.View, { style: { width: p.width, marginBottom: SPACE.md, borderRadius: RAD.large, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, overflow: "hidden" } },
        h(RN.View, { style: { flexDirection: "row", justifyContent: "space-between", paddingLeft: SPACE.lg, paddingTop: SPACE.md, paddingRight: SPACE.sm } }, h(Avatar, { name: g.name, uri: photo(g, "guild"), size: 48, square: true }), h(Pin, { kind: "guild", id: g.id, name: g.name })),
        h(Control, { id: "guild:" + g.id, label: "Open " + g.name, action: "guild", value: g.id, style: { alignItems: "flex-start", padding: SPACE.lg, minHeight: 74 } }, text(g.name, { fontSize: TYPE.body, fontWeight: "600", letterSpacing: -0.2 }, { numberOfLines: 1 }), text("Open space  \u2197", { color: c.muted, fontSize: TYPE.small, marginTop: SPACE.xs }, { numberOfLines: 1 })));
    }
    function GuildRow(p) { const g = p.guild; return h(RN.View, { style: { flexDirection: "row", alignItems: "center", paddingVertical: SPACE.sm } }, h(Control, { id: "guild:" + g.id, label: "Open " + g.name, action: "guild", value: g.id, style: { flex: 1, flexDirection: "row", justifyContent: "flex-start" } }, h(Avatar, { name: g.name, uri: photo(g, "guild"), size: 44, square: true }), text(g.name, { marginLeft: SPACE.md, flex: 1, fontWeight: "500" }, { numberOfLines: 1 })), h(Pin, { kind: "guild", id: g.id, name: g.name })); }
    function GuildGrid(p) {
      const columns = p.width >= 600 ? 3 : 2, gap = SPACE.md;
      const width = Math.floor((p.width - SPACE.xl * 2 - gap * (columns - 1)) / columns);
      return h(RN.View, { style: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" } }, ...p.guilds.map(g => h(GuildCard, { key: g.id, guild: g, width })));
    }
    function MessageRow(p) {
      const d = p.dm, c = colors();
      return h(RN.View, { style: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: c.line } },
        h(Control, { id: "dm:" + d.id, label: "Open conversation with " + d.name, action: "native", value: { kind: "dm", id: d.id }, style: { flex: 1, flexDirection: "row", justifyContent: "flex-start", paddingVertical: cfg("density") === "compact" ? SPACE.md : SPACE.lg } },
          h(Avatar, { name: d.name, uri: d.user ? photo(d.user, "user") : null, size: 46 }),
          h(RN.View, { style: { flex: 1, minWidth: 0, marginLeft: SPACE.md } },
            h(RN.View, { style: { flexDirection: "row", alignItems: "center" } }, text(d.name, { flex: 1, fontWeight: d.unread ? "700" : "500" }, { numberOfLines: 1 }), d.unread ? h(RN.View, { style: { width: 7, height: 7, borderRadius: RAD.round, backgroundColor: c.accent, marginLeft: SPACE.sm } }) : null),
            text(d.preview, { color: c.muted, fontSize: TYPE.caption, marginTop: SPACE.xs }, { numberOfLines: 1 }))),
        h(Pin, { kind: "dm", id: d.id, name: d.name }));
    }
    function Heading(p) { return h(RN.View, { style: { paddingTop: SPACE.sm, paddingBottom: SPACE.xl } }, text(p.title, { fontSize: TYPE.display, lineHeight: 40, fontWeight: "700", letterSpacing: -1 }), p.subtitle ? text(p.subtitle, { color: colors().muted, fontSize: TYPE.caption, marginTop: SPACE.sm }) : null); }
    function More(p) { return p.total > view.limit ? button("Show more", "more", null, { marginTop: SPACE.lg }, "show-more") : null; }
    function Home(p) {
      const name = userName(currentUser()).split(/\s+/)[0], pinned = p.guilds.filter(g => isPinned("guild", g.id));
      const q = view.search.trim().toLowerCase();
      const gs = q ? p.guilds.filter(g => g.name.toLowerCase().includes(q)).slice(0, 12) : (pinned.length ? pinned : p.guilds).slice(0, 4);
      const ds = q ? p.dms.filter(d => d.name.toLowerCase().includes(q)) : p.dms.slice(0, 6);
      const last = account().recent[0];
      const lastName = last?.kind === "dm" ? p.dms.find(d => d.id === last.id)?.name : last?.kind === "guild" ? p.guilds.find(g => g.id === last.id)?.name : last?.kind === "channel" ? call(storeCache.ChannelStore, "getChannel", [last.id], null)?.name : null;
      return h(RN.View, null, h(Heading, { title: "A little more you.", subtitle: name === "Unknown" ? "Your people. Your spaces. Less noise." : "Welcome back, " + name + ". Make yourself at home." }),
        h(Search, { placeholder: "Find a person or a space" }),
        !q && lastName ? h(Control, { id: "resume-recent", label: "Continue in " + lastName, action: "resume", style: { flexDirection: "row", justifyContent: "space-between", marginTop: SPACE.lg, padding: SPACE.lg, backgroundColor: colors().accentSoft, borderRadius: RAD.medium } }, h(RN.View, { style: { flex: 1, minWidth: 0 } }, text("PICK UP WHERE YOU LEFT OFF", { fontSize: 10, letterSpacing: 1, color: colors().muted, fontWeight: "600" }), text(lastName, { fontSize: TYPE.body, fontWeight: "600", marginTop: SPACE.xs }, { numberOfLines: 1 })), h(Icon, { name: "ArrowSquareUpRightIcon", color: colors().accent })) : null,
        h(Section, { title: q ? "Matching spaces" : pinned.length ? "Your favorites" : "Your spaces", right: button("All spaces", "tab", "spaces", { backgroundColor: colors().clear, paddingHorizontal: SPACE.sm }, "home-all-spaces") }),
        gs.length ? h(GuildGrid, { guilds: gs, width: p.width }) : h(Empty, { icon: "StarIcon", title: q ? "No matching spaces" : "Keep your favorites close.", body: q ? "Try another name." : "Pin a space from the library to make this your own.", action: "tab", value: "spaces", cta: "Explore your spaces" }),
        h(Section, { title: q ? "Matching conversations" : "Your conversations", right: button("View all", "tab", "messages", { backgroundColor: colors().clear, paddingHorizontal: SPACE.sm }, "home-all-messages") }),
        ...ds.slice(0, view.limit).map(d => h(MessageRow, { key: d.id, dm: d })),
        ds.length ? null : h(Empty, { title: "Nothing here yet", body: "Conversations appear when Discord has loaded your DM list." }));
    }
    function Spaces(p) {
      const q = view.search.trim().toLowerCase();
      const items = p.guilds.filter(g => (!q || g.name.toLowerCase().includes(q)) && (view.filter !== "pinned" || isPinned("guild", g.id)));
      return h(RN.View, null, h(Heading, { title: "Your spaces.", subtitle: p.guilds.length + " spaces. One place to find them." }), h(Search, { placeholder: "Find a space" }),
        h(RN.View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" } }, h(Filters, { options: [{ id: "all", name: "All spaces" }, { id: "pinned", name: "Pinned" }] }), iconButton("SquaresIcon", cfg("grid") ? "Use list layout" : "Use grid layout", "setting", { key: "grid", value: !cfg("grid") }, "toggle-grid")),
        cfg("grid") ? h(GuildGrid, { guilds: items.slice(0, view.limit), width: p.width }) : h(RN.View, null, ...items.slice(0, view.limit).map(g => h(GuildRow, { key: g.id, guild: g }))),
        items.length ? h(More, { total: items.length }) : h(Empty, { title: "No spaces to show", body: view.filter === "pinned" ? "Use the star on a space to pin it here." : "Try another search or return to Discord to finish loading your servers.", action: "filter", value: "all", cta: "Show all spaces" }));
    }
    function Channels(p) {
      const g = p.guilds.find(x => x.id === view.guild), list = g ? channelList(g.id) : null;
      if (!g) return h(Empty, { title: "Space unavailable", body: "This server is no longer in Discord's loaded server list.", action: "tab", value: "spaces", cta: "Back to spaces" });
      const q = view.search.trim().toLowerCase(), items = list?.filter(c => !q || String(c.name || "").toLowerCase().includes(q));
      return h(RN.View, null,
        h(Control, { id: "back-spaces", label: "Back to spaces", action: "tab", value: "spaces", style: { flexDirection: "row", justifyContent: "flex-start", alignSelf: "flex-start", marginBottom: SPACE.lg } }, h(Icon, { name: "ChevronSmallLeftIcon" }), text("Spaces", { color: colors().muted, fontSize: TYPE.caption })),
        h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginBottom: SPACE.lg } }, h(Avatar, { name: g.name, uri: photo(g, "guild"), size: 64, square: true }), h(RN.View, { style: { flex: 1, minWidth: 0, marginLeft: SPACE.lg } }, text(g.name, { fontSize: TYPE.section, lineHeight: 30, letterSpacing: -0.6, fontWeight: "700" }), text("A space for your people.", { fontSize: TYPE.caption, color: colors().muted, marginTop: SPACE.xs }))),
        button("Open in Discord", "native", { kind: "guild", id: g.id }, { alignSelf: "flex-start", marginBottom: SPACE.xl }, "open-native-guild"),
        h(Search, { placeholder: "Find a channel" }), h(Section, { title: "Channels" }),
        list === null ? h(Empty, { icon: "HashIcon", title: "Use Discord's channel list", body: "This build didn't expose a permission-checked channel list. Hidden channels are never shown here.", action: "native", value: { kind: "guild", id: g.id }, cta: "Open channel list" }) :
          h(RN.View, null, ...items.slice(0, view.limit).map(ch => h(RN.View, { key: ch.id, style: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors().line } },
            h(Control, { id: "channel:" + ch.id, label: "Open channel " + ch.name, action: "native", value: { kind: "channel", id: ch.id, guildId: g.id }, style: { flexDirection: "row", justifyContent: "flex-start", flex: 1, paddingVertical: SPACE.lg } }, h(Icon, { name: [2, 13].includes(ch.type) ? "SpeakerIcon" : "HashIcon", color: unread(ch.id) ? colors().accent : colors().faint }), text(String(ch.name || "channel").replace(/-/g, " "), { marginLeft: SPACE.md, flex: 1, fontWeight: unread(ch.id) ? "700" : "400" }, { numberOfLines: 1 })), h(Pin, { kind: "channel", id: ch.id, guildId: g.id, name: ch.name }))), !items.length ? h(Empty, { title: "No matching channels", body: "Try another channel name." }) : h(More, { total: items.length })));
    }
    function Messages(p) {
      const q = view.search.trim().toLowerCase();
      const items = p.dms.filter(d => (!q || d.name.toLowerCase().includes(q)) && (view.filter !== "unread" || d.unread) && (view.filter !== "pinned" || isPinned("dm", d.id)));
      return h(RN.View, null, h(Heading, { title: "Good conversations.", subtitle: "People first. Everything else can wait." }), h(Search, { placeholder: "Find a conversation" }),
        h(Filters, { options: [{ id: "all", name: "All" }, { id: "unread", name: "Unread" }, { id: "pinned", name: "Pinned" }] }),
        ...items.slice(0, view.limit).map(d => h(MessageRow, { key: d.id, dm: d })), items.length ? h(More, { total: items.length }) : h(Empty, { title: view.filter === "unread" ? "You're all caught up." : "No conversations here", body: view.filter === "pinned" ? "Pin a conversation using its star." : "Only DMs already loaded by Discord appear here.", action: "filter", value: "all", cta: "Show all conversations" }));
    }
    function Toggle(p) { return h(RN.View, { style: { flexDirection: "row", alignItems: "center", paddingVertical: SPACE.md, borderBottomWidth: 1, borderBottomColor: colors().line } }, h(RN.View, { style: { flex: 1, minWidth: 0, paddingRight: SPACE.lg } }, text(p.label, { fontSize: TYPE.body, fontWeight: "500" }), p.detail ? text(p.detail, { fontSize: TYPE.small, lineHeight: 18, color: colors().muted, marginTop: SPACE.xs }) : null), h(RN.Switch, { testID: "setting-" + p.name, accessibilityLabel: p.label, value: !!cfg(p.name), trackColor: { false: colors().line, true: colors().accent }, thumbColor: colors().surface, onValueChange: value => changeSetting(p.name, !!value) })); }
    function You() {
      const user = currentUser(), c = colors();
      return h(RN.View, null, h(Heading, { title: "Make it yours.", subtitle: "A quieter Discord, on your terms." }),
        h(RN.View, { style: { flexDirection: "row", alignItems: "center", paddingBottom: SPACE.sm } }, h(Avatar, { name: userName(user), uri: user ? photo(user, "user") : null, size: 64 }), h(RN.View, { style: { flex: 1, marginLeft: SPACE.lg } }, text(userName(user), { fontSize: TYPE.title, fontWeight: "600" }), text(user?.username ? "@" + user.username : "Discord account", { color: c.muted, fontSize: TYPE.caption }))),
        h(Section, { title: "Atmosphere" }),
        h(RN.View, { style: { flexDirection: "row", justifyContent: "space-between" } }, ...Object.entries(PALETTES).map(([id, p]) => h(Control, { key: id, id: "palette-" + id, label: p.name + " palette", action: "setting", value: { key: "palette", value: id }, selected: cfg("palette") === id, style: { flex: 1, marginRight: id === "slate" ? 0 : SPACE.sm, padding: SPACE.md, borderRadius: RAD.medium, borderWidth: cfg("palette") === id ? 2 : 1, borderColor: cfg("palette") === id ? c.accent : c.line, backgroundColor: p.bg } }, h(RN.View, { style: { flexDirection: "row", marginBottom: SPACE.sm } }, ...[p.surface, p.accent, p.ink].map((color, i) => h(RN.View, { key: i, style: { width: 16, height: 16, borderRadius: 8, marginRight: 3, backgroundColor: color } }))), text(p.name, { color: p.ink, fontSize: TYPE.small, fontWeight: "600" }, { numberOfLines: 1 })))),
        h(Toggle, { name: "nativePalette", label: "Coordinate Discord colors", detail: "Applies a matching theme to native screens. Your previous theme is restored when this is turned off." }),
        h(Toggle, { name: "startHome", label: "Start in Reimagined", detail: "Open Home when the navigation dock mounts after launch." }),
        h(Toggle, { name: "layout", label: "Replace the You Bar", detail: "Turn off to restore Discord's original bar without losing your pins." }),
        h(Toggle, { name: "showPreviews", label: "Conversation previews", detail: "Shows messages already cached by Discord. Never saved by this plugin." }),
        h(Toggle, { name: "reduceMotion", label: "Reduce motion", detail: "System reduced-motion settings are also respected." }),
        h(RN.View, { style: { flexDirection: "row", marginTop: SPACE.lg } }, button(cfg("density") === "compact" ? "Comfortable rows" : "Compact rows", "setting", { key: "density", value: cfg("density") === "compact" ? "comfortable" : "compact" }, { flex: 1 }, "density")),
        h(Section, { title: "Keep control" }), button("Open Discord settings", "native", { kind: "settings" }, { backgroundColor: c.accentSoft, marginBottom: SPACE.md }, "discord-settings"),
        button("Copy compatibility report", "report", null, { marginBottom: SPACE.md }, "copy-report"), h(Toggle, { name: "diagnostics", label: "Show tap diagnostics", detail: "Names each control you tap. Does not include server names or messages." }),
        text("Discord: Reimagined  " + VERSION, { color: c.muted, fontSize: TYPE.small, marginTop: SPACE.xl }),
        text("An experimental navigation and appearance layer. Discord still renders messages, calls, media, and account settings.", { color: c.muted, fontSize: TYPE.small, lineHeight: 18, marginTop: SPACE.sm }),
        health.issues.length ? text("Compatibility notes: " + health.issues.join(", "), { color: c.danger, fontSize: TYPE.small, marginTop: SPACE.md, lineHeight: 18 }) : null);
    }
    function Dock(p) {
      const c = colors();
      return h(RN.View, { testID: "reimagined-dock", style: { width: "100%", paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.sm, backgroundColor: c.bg } },
        h(RN.View, { style: { flexDirection: "row", alignItems: "center", padding: SPACE.xs, borderRadius: RAD.large, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line } },
          ...NAV.map(n => h(Control, { key: n.id, id: "tab-" + n.id, label: n.label, role: "tab", action: "tab", value: n.id, selected: view.open && view.tab === n.id, measure: true,
            longPress: n.id === "spaces" ? () => send("drawer") : undefined,
            style: { flex: 1, minWidth: 0, minHeight: 54, borderRadius: RAD.medium, flexDirection: "column", backgroundColor: view.open && view.tab === n.id ? c.accentSoft : c.clear } },
            h(Icon, { name: n.icon, color: view.open && view.tab === n.id ? c.accent : c.muted, size: 21 }), text(n.label, { fontSize: TYPE.small, lineHeight: 17, fontWeight: "600", color: view.open && view.tab === n.id ? c.accent : c.muted, marginTop: 2 }, { numberOfLines: 1 })))));
    }
    function Shell(p) {
      const c = colors(), gs = guilds(), ds = dmList();
      const contentProps = { guilds: gs, dms: ds, width: p.width };
      const Content = view.guild ? Channels : view.tab === "spaces" ? Spaces : view.tab === "messages" ? Messages : view.tab === "you" ? You : Home;
      return h(RN.View, { testID: "reimagined-shell", style: { flex: 1, minHeight: 0, backgroundColor: c.bg } },
        view.presentation === "drawer" ? h(RN.View, { style: { alignItems: "center", paddingTop: SPACE.sm } }, h(RN.View, { style: { width: 32, height: 4, borderRadius: RAD.round, backgroundColor: c.line } })) : null,
        h(RN.View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACE.xl, paddingTop: SPACE.md, paddingBottom: SPACE.lg } },
          text("reimagined", { fontSize: 18, letterSpacing: -0.5, fontWeight: "600", color: c.accent }),
          h(Control, { id: "back-to-discord", label: "Back to Discord", action: "close", style: { flexDirection: "row", borderRadius: RAD.round, paddingLeft: SPACE.md, borderWidth: 1, borderColor: c.line } }, text("Discord", { fontSize: TYPE.small, color: c.muted }, { numberOfLines: 1 }), h(Icon, { name: "ChevronSmallDownIcon", size: 20 }))),
        h(RN.ScrollView, { testID: "scene-scroll", keyboardShouldPersistTaps: "handled", showsVerticalScrollIndicator: false, style: { flex: 1, minHeight: 0 }, contentContainerStyle: { paddingHorizontal: SPACE.xl, paddingBottom: SPACE.xxl, width: "100%", maxWidth: 820, alignSelf: "center" } }, h(Content, contentProps)),
        view.presentation === "drawer" ? button("Open full library", "expand", null, { marginHorizontal: SPACE.xl, marginBottom: SPACE.md }, "expand-library") : null,
        h(Dock));
    }
    Boundary = class extends React.Component {
      constructor(props) { super(props); this.state = { failed: false }; }
      componentDidCatch() { issue("surface-render-failed"); this.setState({ failed: true }); }
      render() { return this.state.failed ? h(RN.View, { style: { backgroundColor: colors().bg, padding: SPACE.xl } }, text("Reimagined couldn't render this screen.", { color: colors().ink }), button("Return to Discord", "close", null, { marginTop: SPACE.lg }, "error-escape"), button("Copy report", "report", null, { marginTop: SPACE.sm }, "error-report")) : this.props.children; }
    };
    Host = class extends React.Component {
      constructor(props) { super(props); this.state = { tick: 0, width: attempt(() => RN.Dimensions.get("window").width, 390), reduce: false }; this.refresh = () => this.setState(s => ({ tick: s.tick + 1 })); }
      componentDidMount() {
        hosts.add(this); health.mounts = hosts.size; if (!owner || this.props.mode === "settings") owner = this;
        listeners.add(this.refresh);
        const dims = attempt(() => RN.Dimensions.addEventListener("change", ({ window }) => this.setState({ width: window.width })), null);
        const reduce = attempt(() => RN.AccessibilityInfo.addEventListener("reduceMotionChanged", value => this.setState({ reduce: !!value })), null);
        this.cleanups = [() => dims?.remove?.(), () => reduce?.remove?.()];
        Promise.resolve(attempt(() => RN.AccessibilityInfo.isReduceMotionEnabled(), false)).then(value => { if (hosts.has(this)) this.setState({ reduce: !!value }); });
        if (this.props.mode !== "settings" && cfg("startHome") && !autoPresented && !suppressAuto && currentUser()) { autoPresented = true; open("home"); }
        else emit();
      }
      componentWillUnmount() {
        hosts.delete(this); listeners.delete(this.refresh); (this.cleanups || []).forEach(fn => attempt(fn)); health.mounts = hosts.size;
        if (owner === this) owner = Array.from(hosts)[0] || null;
        // Let React finish unmounting before notifying a replacement presenter.
        Promise.resolve().then(emit);
      }
      render() {
        if (!live) return this.props.original || null;
        const c = colors(), mode = this.props.mode;
        const inline = mode === "settings" ? h(RN.ScrollView, { contentContainerStyle: { padding: SPACE.xl, paddingBottom: SPACE.xxl } }, button("Open Discord: Reimagined", "tab", "home", { marginBottom: SPACE.xl, backgroundColor: c.accentSoft }, "open-reimagined"), h(You), text("Hook status: " + Object.entries(health.hooks).map(([k, v]) => k + "=" + v).join(", "), { fontSize: TYPE.small, color: c.muted, marginTop: SPACE.lg }), button("Retry compatibility lookup", "retry", null, { marginTop: SPACE.md }, "retry-hooks"))
          : cfg("layout") ? mode === "launcher" ? h(Control, { id: "reimagined-launcher", label: "Open Reimagined", action: "tab", value: "home", style: { width: 44, height: 44, borderRadius: RAD.small, backgroundColor: c.accentSoft } }, h(Icon, { name: "SquaresIcon", color: c.accent })) : h(Dock) : this.props.original;
        const visible = view.open && owner === this;
        const drawer = view.presentation === "drawer";
        const Safe = RN.SafeAreaView || RN.View;
        return h(RN.View, { style: { width: "100%", flex: mode === "settings" ? 1 : undefined, backgroundColor: c.bg } },
          h(Boundary, { key: "inline:" + mode }, inline),
          h(RN.Modal, { visible, transparent: drawer, presentationStyle: drawer ? "overFullScreen" : "fullScreen", animationType: cfg("reduceMotion") || this.state.reduce ? "none" : drawer ? "slide" : "fade", onRequestClose: () => send("close"), onDismiss: finishNative },
            h(RN.View, { style: { flex: 1, justifyContent: "flex-end", backgroundColor: drawer ? c.shade : c.bg } },
              drawer ? h(Control, { id: "drawer-backdrop", label: "Close server drawer", action: "close", style: { flex: 1 } }) : null,
              h(Safe, { style: { flex: drawer ? undefined : 1, height: drawer ? "82%" : undefined, backgroundColor: c.bg, borderTopLeftRadius: drawer ? RAD.sheet : 0, borderTopRightRadius: drawer ? RAD.sheet : 0, overflow: "hidden" } },
                h(Boundary, { key: "shell:" + view.open }, h(Shell, { width: Math.min(this.state.width, 820) }))))));
      }
    };
  }
  function renderTarget(raw, name) {
    const choices = [raw?.[name], raw?.default, raw];
    for (let i = 0; i < choices.length; i++) {
      let node = unwrap(choices[i]); if (!node) continue;
      if (typeof node === "function" && node.prototype?.render) return [node.prototype, "render"];
      if (typeof node === "function") {
        if (raw?.[name] === node) return [raw, name];
        if (raw?.default === node) return [raw, "default"];
      }
      for (let depth = 0; node && depth < 5; depth++) {
        if (typeof node.type === "function") return [node, "type"];
        if (typeof node.render === "function") return [node, "render"];
        node = node.type;
      }
    }
    return null;
  }
  function patch(raw, name, mode) {
    if (!live) return false;
    const target = attempt(() => renderTarget(raw, name), null); if (!target) return false;
    const [object, method] = target;
    const keys = targets.get(object) || new Set(); if (keys.has(method)) return true;
    try {
      // Keep the original render's hook count intact; our Host has its own React lifetime.
      api.patcher.after(method, object, (_args, output) => {
        if (!live || output == null || !currentUser()) return output;
        if (mode === "launcher" && health.hooks.YouBar === "patched") return output;
        return h(Host, { mode, original: output });
      });
      keys.add(method); targets.set(object, keys); health.hooks[name] = "patched"; return true;
    } catch (_) { issue("hook-failed:" + name); return false; }
  }
  function scan() {
    [ ["YouBar", "dock"], ["YouBarNotificationsButton", "launcher"] ].forEach(([name, mode]) => {
      if (health.hooks[name] === "patched") return;
      const raw = attempt(() => api.metro.findByFileName(name, false), null) || attempt(() => api.metro.findByTypeName(name, false), null);
      if (!patch(raw, name, mode)) health.hooks[name] = "not found; settings entry available";
    });
  }
  function subscribeStores() {
    Object.values(storeCache).forEach(s => {
      if (typeof s?.addChangeListener === "function") {
        s.addChangeListener(changed); unsubscribe.push(() => s.removeChangeListener?.(changed));
      }
    });
  }
  function SettingsComponent() { return live && Host ? h(Host, { mode: "settings" }) : null; }
  return definePlugin({
    start(pluginApi) {
      api = pluginApi; generation++; live = true; autoPresented = false; suppressAuto = false; owner = null;
      React = unwrap(api.common.React); RN = unwrap(api.common.ReactNative); h = React.createElement;
      if (!React.Component || !RN.View || !RN.Text || !RN.Modal || !(RN.Pressable || RN.TouchableOpacity)) { live = false; throw new Error("Required React Native primitives are unavailable"); }
      Object.keys(DEFAULTS).forEach(key => { if (api.storage[key] === undefined) api.storage[key] = typeof DEFAULTS[key] === "object" ? {} : DEFAULTS[key]; });
      targets = new WeakMap(); iconCache = new Map(); view = { open: false, tab: "home", presentation: "full", guild: null, search: "", filter: "all", limit: 60 };
      health.hooks = {}; health.stores = {}; health.actions = {}; health.issues = []; health.taps = []; health.frames = {};
      ["UserStore", "GuildStore", "SortedGuildStore", "ChannelStore", "GuildChannelStore", "PermissionStore", "PrivateChannelSortStore", "PrivateChannelReadStateStore", "ReadStateStore", "RelationshipStore", "MessageStore"].forEach(store);
      moduleWith("getUserAvatarURL");
      buildUI(); subscribeStores();
      [ ["YouBar", "dock"], ["YouBarNotificationsButton", "launcher"] ].forEach(([name, mode]) => {
        [api.metro.byFileName, api.metro.byTypeName].filter(fn => typeof fn === "function").forEach(makeFilter => {
          const cancel = attempt(() => api.metro.waitFor(makeFilter(name), raw => patch(raw, name, mode), { raw: true }), null);
          if (typeof cancel === "function") unsubscribe.push(cancel);
        });
      });
      scan(); syncTheme();
    },
    async stop() {
      live = false; generation++; pending = null; clearTimeout(pendingTimer); clearTimeout(storeTimer); pendingTimer = null; storeTimer = null;
      view = { ...view, open: false };
      // Notify mounted Hosts once while disabled, so any Modal is dismissed before unpatch.
      Array.from(listeners).forEach(fn => attempt(fn));
      unsubscribe.splice(0).forEach(fn => attempt(fn)); listeners.clear(); hosts.clear(); owner = null;
      await paletteQueue; await restoreTheme();
      Object.keys(storeCache).forEach(k => delete storeCache[k]); Object.keys(moduleCache).forEach(k => delete moduleCache[k]);
      iconCache.clear(); health.mounts = 0;
      // Distra removes scoped api.patcher patches after this lifecycle method resolves.
    },
    SettingsComponent,
    diagnostics: report
  });
})()
