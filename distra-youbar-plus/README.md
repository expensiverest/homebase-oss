# YouBar+ for Distra

**Experimental Distra-native port** of [Valenced YouBar+](https://github.com/Valenced/valenced-community-plugins/tree/main/plugins/youbar-plus), originally by Purple_Ξye™, using a startup-safe approach informed by [Rosie's archived Revenge fork](https://github.com/everestmcarthur/revenge-plugins/tree/main/plugins/you-bar-plus).

**Target:** Distra's `distra.spec: 1` plugin API, using Distra 0.1.1 / Discord 348.0 source code. **Not yet tested on a physical iPhone**.

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

- **Direct Messages**, **Settings**, and optional **Favorites** buttons.
- Preserve Discord's original notifications control.
- Live on/off switches for each extra button.
- Startup handling via Distra's `metro.waitFor` so the target can load after plugin startup.
- Safe fallback when the current Discord version's rendering structure is unexpected.
- **Compatibility** status and manual **Retry patch** in the plugin settings.
- Stops cleanly by relying on Distra's scoped patcher cleanup.

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

The tests cover manifest-compatible evaluation, button insertion and navigation, delayed module loading, settings toggles, safe fallback, and keeping the original notifications control.

## Credit / License

Adapted from Valenced community YouBar+ by Purple_Ξye™ under **GPL-3.0-only**. Source architecture and startup workaround also informed by Rosie's archived Revenge fork. The [upstream repository](https://github.com/Valenced/valenced-community-plugins) and [Distra](https://github.com/OMetaVR/Distra) are not affiliated with this port. See [LICENSE](LICENSE).

Unofficial Discord client modifications may violate Discord's terms. Use at your own risk.
