# Discord: Reimagined 0.2.0-alpha.2

Opt-in repair of the withdrawn 0.2.0-alpha.1. Disable the stable Reimagined plugin and all other navigation plugins before enabling this one.

Install folder:

https://raw.githubusercontent.com/expensiverest/homebase-oss/distra-youbar-plus-port/discord-reimagined-preview/

The stable discord-reimagined/manifest.json is deliberately unchanged.

## Repair

Original Discord navigation is preserved. A custom native route is used only when it is declared in the observed navigation tree and its Scene confirms focus plus nonzero layout. Unready roots, missing routes, silent ignores and thrown errors fall back to a full-screen React Native Modal. A late route cannot take over the fallback. The same 0.2 conversation/composer/profile/call/media components are retained.

Restore Discord dismisses the redesign and disables automatic replacement. Settings opened from a verified native route can cover it normally. In Modal fallback, the modal must dismiss before native Settings opens; the screen state/draft is retained, but the redesign is not shown underneath that sheet. This is an explicit fallback limitation, not full sheet-stacking parity.

## Validation

Presenter tests and synthetic plugin lifecycle integration checks run in the Reimagined Repair workflow before publication. No physical iOS/Hermes/Yoga test or real Discord service action is claimed. See scripts/reimagined/ for the reproducible build and tests.

The installer SHA-256 covers the exact source bytes. Runtime has no remote code loader. GPL-3.0-only.
