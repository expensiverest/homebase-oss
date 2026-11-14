# Validation: 0.2.0-alpha.2

Entry point SHA-256: `7e5622561b19b34be8c17fd888261fd6d8e6867b28056ceaa3f305ba0f109954`

GitHub Actions run: https://github.com/expensiverest/homebase-oss/actions/runs/43574199052

35/35 Node checks passed (23 presentation-state tests and 12 synthetic plugin lifecycle/packaging checks). The downloaded artifact was also tested locally with the same 35 passing checks. No browser coordinate-click run, physical iPhone test, Hermes test, Yoga test or live Discord account action was performed for this repair.

## Covered failure paths

- Unhandled navigation that returns without throwing.
- Missing custom-page route, including bounded waiting for an unready root.
- Nested route parameters when the target actually exists in the observed navigator state.
- Thrown navigation errors.
- Mounted but unfocused scenes and zero-size scenes: neither counts as successful presentation.
- Late/stale route acknowledgements after fallback selection.
- Modal onShow acknowledgement and a timeout if the modal never appears.
- Missing Modal support or missing presenter host leaves original navigation intact.
- Settings handoff only after onDismiss, at most once.
- Failed dismissal does not open a second native screen underneath an undismissed modal.
- Restore Discord disables automatic replacement and leaves original controls present.
- Stop cancels pending timers/settings actions.
- The actual generated plugin is evaluated with explicitly synthetic React/React Native lifecycle objects.
- The original 0.2 message/profile/voice service segment is unchanged byte-for-byte.
- Manifest entry point, version and exact source hash agree.

## Install and native smoke test

Disable the existing Discord: Reimagined plugin before enabling Discord: Reimagined (0.2 Preview). Do not delete the old installation or clear app data.

Restart Discord. The redesign should open automatically with Open Home on launch enabled. Otherwise use the Reimagined launcher or its plugin settings entry. Test Home, Servers, Messages, You, a conversation, Settings and Restore Discord. Preserve a draft while testing the Settings transition.

On a supported native route, Settings is requested above the redesign. In modal fallback, Reimagined is dismissed first; Settings will not show the redesigned screen underneath. Screen state/drafts stay in memory while the plugin runs. This is a documented fallback limitation.

The stable `discord-reimagined/manifest.json` remains the recovered 0.1.0-alpha.1 build. This repair is in the separate `discord-reimagined-preview/` folder.
