# YouBar+ for Distra

**Experimental Distra-native port** of [Valenced YouBar+](https://github.com/Valenced/valenced-community-plugins/tree/main/plugins/youbar-plus), originally by Purple_Ξye™, using a startup-safe approach informed by [Rosie's archived Revenge fork](https://github.com/everestmcarthur/revenge-plugins/tree/main/plugins/you-bar-plus).

**Target:** Distra's `distra.spec: 1` plugin API, using Distra 0.1.1 / Discord 348.0 source code. **v0.3.0:** confirmed by an iPhone tester: v0.2.0 fixed the settings crash and showed all three icons, but DMs and Settings taps still navigated to Favorites. This version changes hit-testing and adds tap diagnostics. **v0.3.0 is not yet confirmed on an iPhone.**

## Install in Distra

1. Disable/uninstall all other YouBar+ forks to prevent conflicts.
2. Open Discord > Settings > Distra > Plugins > **Install from URL**.
3. Paste this exact URL (including the final slash):

```text
https://raw.githubusercontent.com/expensiverest/homebase-oss/distra-youbar-plus-port/distra-youbar-plus/
```

4. Install and enable the plugin, then fully restart Discord.
5. Open **YouBar+ for Distra > Settings** and select which shortcuts to show.

It is a Distra-native `manifest.json` + `index.js` plugin. **Do not paste the GitHub tree URL, a Valenced plugin ID, or the direct index.js URL.**

## Features

- **Direct Messages**, **Settings**, and **Favorites** buttons (all enabled on first upgrade; changes can be saved individually).
- Preserve Discord's original notifications control.
- Live on/off switches for each extra button. Settings now resolves React memo components directly instead of passing lazy callable proxies.
- Startup handling via Distra's `metro.waitFor` so the target can load after plugin startup.
- Dedicated, fixed-width (40px) React Native Pressables for every shortcut, with non-interactive native IconButton visuals; no reused notification-button containers.
- Optional **Tap diagnostics (no navigation)** setting: a tap shows the detected shortcut label in a toast instead of navigating. This helps isolate native overlap from navigation problems.
- Safe fallback when the current Discord version's rendering structure is unexpected.
- **Compatibility** status and manual **Retry patch** in the plugin settings.
- Stops cleanly by relying on Distra's scoped patcher cleanup.

## Updating from previous versions

The existing installation URL is unchanged. From **Settings > Distra > Plugins > YouBar+ for Distra**, choose **Check for update**, then disable and enable the plugin or restart Discord. Confirm it shows **v0.3.0** before testing. If the old version persists, uninstall this plugin and reinstall it using the URL below. The first v0.2.0 launch enables Favorites once, since its setting was inaccessible in v0.1.0; afterward your choice is preserved.

## Limitations

- Passing local Node mock tests **does not prove it works in Discord 348 on iOS**. The target component, which is internal to Discord, must be present and have the expected render shape.
- The `@favorites` target is version/account dependent and may not be supported.
- Adding too many buttons can crowd the You Bar on smaller devices.
- A full Discord restart is advised after initial installation.
- If Discord's internal component changed, the patch can silently do nothing rather than modify unrelated UI. Use the plugin's Compatibility status and restart.

## Running tests

```sh
node --test tests/port.test.cjs
```

The 14 mock tests cover manifest-compatible evaluation, button insertion, independent navigation, delayed module loading, React memo settings rendering, fallback when design components are missing, v0.1.0 migration, and preserving the original notifications control.

## Credit / License

Adapted from Valenced community YouBar+ by Purple_Ξye™ under **GPL-3.0-only**. Source architecture and startup workaround also informed by Rosie's archived Revenge fork. The [upstream repository](https://github.com/Valenced/valenced-community-plugins) and [Distra](https://github.com/OMetaVR/Distra) are not affiliated with this port. See [LICENSE](LICENSE).

Unofficial Discord client modifications may violate Discord's terms. Use at your own risk.

## Troubleshooting tap routing (v0.3.0)

If one or more buttons still open Favorites, open this plugin's **Settings**, enable **Tap diagnostics (no navigation)**, and then tap DMs, Settings and Favorites. Each tap should show a brief toast identifying the physical touch target. Report which labels appear. Turn the switch back off to restore navigation.
