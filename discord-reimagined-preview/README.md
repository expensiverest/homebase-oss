# Discord: Reimagined 0.2.0-alpha.22

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
