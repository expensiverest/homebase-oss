# Discord: Reimagined

**0.1.0-alpha.1 - an original Distra navigation and appearance plugin.**

This is not another YouBar+ fork. It builds a custom Home, server library, conversation list, preferences screen and server drawer using its own React Native controls. Discord retains responsibility for messages, calls, uploads, media and account settings.

**Test status:** 25 browser checks passed against the production React component tree through a React Native-to-browser adapter, plus three Node contract checks. This is **not** verification on iOS, Hermes, Yoga or a live Discord account. Native module integration remains experimental. See [TESTING.md](TESTING.md).

## Install

Disable **YouBar+ for Distra**, other YouBar+ forks, and **Server Drawer** before enabling this plugin. Do not run two navigation replacements together.

In **Settings > Distra > Plugins > Install from URL**, paste:

```text
https://raw.githubusercontent.com/expensiverest/homebase-oss/distra-youbar-plus-port/discord-reimagined/
```

Enable the plugin and fully restart Discord. If auto-detection is wrong, choose the **Distra** plugin type.

The plugin attempts to replace the whole `YouBar`. If that component is unavailable, it attempts a single launcher in `YouBarNotificationsButton`. If neither hook resolves, open **Discord: Reimagined > Settings > Open Discord: Reimagined**. Missing hooks are shown in the compatibility report rather than disguised as a successful installation.

## The experience

- **Home:** favorites or your first spaces, people/space search, recent conversation resume and direct-message rows.
- **Spaces:** searchable grid/list, local pinning, permission-checked channel browsing, and native server/channel handoff.
- **Chats:** All / Unread / Pinned filters, optional cached-message previews and direct conversation navigation.
- **You:** Midnight, Pearl and Slate palettes, native color coordination, compact rows, reduced motion and diagnostics.
- **Server drawer:** long-press Spaces to open the compact bottom drawer; expand into the full library.
- **Your data:** pins and recent navigation references stay in plugin storage, separated by account. Message bodies are never persisted by this plugin.

The Home/Spaces/Chats/You tabs change local view state. They do not share the old YouBar+ route callbacks or clone Discord's notification button containers. Each control owns its action through a component instance.

## What is deliberately not replaced

Discord's native message list/composer, calls, video, attachment viewers, full profile editor and account settings remain native. Opening a conversation dismisses the custom surface before handing off to Discord. Matching colors can extend to native screens through Distra's theme API, but this is not a complete rewrite of those screens.

This plugin does not inject desktop CSS, bypass permissions, add a custom network client, read account tokens or patch every React element. It does not import every community plugin as a dependency. Compatibility with arbitrary simultaneous plugins has not been certified.

## Recovery

Tap **Discord** at the top right to return to the original app. The **Replace the You Bar** setting restores the original bar while retaining pins. Disabling/uninstalling the plugin removes its scoped patches. A theme is restored only while this plugin still owns the active theme, so a theme chosen elsewhere is not overwritten.

If the UI fails: disable this plugin in Distra, restart, and use the original app. Distra safe mode remains the last-resort recovery path. Keep the original client available while testing alpha builds.

## Diagnostics

**You > Copy compatibility report** includes resolved hooks/stores, action results, tab frames and recent control identifiers. Numeric account/channel IDs are redacted; names and message text are not included. **Show tap diagnostics** identifies controls without disabling navigation. Read the report before posting it publicly.

## Source and checks

`index.js` is the complete, readable plugin source. No build step or runtime package download is required. The manifest uses Distra's native expression format and includes the source SHA-256.

```sh
node --check index.js
node --test tests/contract.test.cjs
```

The browser test record is in TESTING.md. Browser screenshots use fictional data and a browser adapter, not an iPhone emulator. The installed plugin uses Discord's own React and React Native.

## References and license

See [docs/REFERENCE_AUDIT.md](docs/REFERENCE_AUDIT.md) for the catalog survey, inspected source paths, design decisions and unverified areas. GPL-3.0-only; see [LICENSE](LICENSE). The Distra and ServerDrawer authors are credited as interface/reference sources, not endorsers of this independent plugin. This project is not affiliated with Discord.
