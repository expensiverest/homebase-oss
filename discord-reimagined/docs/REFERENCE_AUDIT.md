# Reference audit

## Scope and evidence

Reference snapshot: `OMetaVR/Distra@a521173d4957f2b9f15194b11c649f698d8b741d`.

The public catalog was surveyed across all its categories: **87 bundled Vendetta-family entries, 7 legacy Enmity entries, 16 external recommendations**, and the **26 first-party core entries**. These are catalog counts, not a claim of 136 distinct, tested, compatible plugins. Some entries overlap; the catalog explicitly labels old Enmity plugins and known failures. No claim is made that every public fork has been found or installed.

The source-level review concentrated on components that matter for this redesign. Unrelated audio, moderation, command, media and novelty plugins were catalog references only. This is not an integration of their source or a complete security audit.

## Primary sources

Distra paths are relative to https://github.com/OMetaVR/Distra/tree/a521173d4957f2b9f15194b11c649f698d8b741d

| Source | Design consequence |
| --- | --- |
| `builtin-plugins/README.md` and `src/plugins/core/index.ts` | Separate catalog-reported support from runtime verification. |
| `builtin-plugins/sources/kmmiio99o__vd-plugins/plugins/ServerDrawer/src/index.tsx` | Do not copy its entire coordinated Quest Dock and rail patch stack. |
| `ServerDrawer/src/components/ServerDrawerSheet.tsx` in that source tree | Read native server order; dismiss our modal before native handoff. |
| `ServerDrawer/src/components/DmTile.tsx` | Use selectPrivateChannel(id) for a specific DM, not a shared Favorites action. |
| `ServerDrawer/src/patches/hideGuildsBar.tsx` | Handle nested memo/forwardRef wrappers; avoid global JSX interception and rail deletion. |
| `src/compat/themes.ts` | Coordinate colors and restore only a theme owned by this plugin. |
| `builtin-themes/distra/distra-night.json` | Emit compatible spec-3 theme data, not desktop CSS. |
| `src/ui/settings/index.tsx` | Preserve a Distra plugin settings entry as a recovery/access path. |
| `src/plugins/flavors/distra.ts`, `src/lib/patcher.ts`, `src/metro/index.ts`, `src/lib/lazy.ts` | Native expression format, scoped cleanup, module waiters and resolving actual React exports. These APIs were inspected during preceding port work. |
| `src/plugins/core/pindms/index.tsx` | Prefer a separate DM browser over rewriting Discord's native virtualized list. Inspected during preceding port work. |

Original YouBar+ source, inspected during preceding port work:
https://github.com/Valenced/valenced-community-plugins/tree/main/plugins/youbar-plus

Framework references:
https://reactnative.dev/docs/pressable
https://reactnative.dev/docs/modal
https://react.dev/reference/react/forwardRef

## What the device feedback established

The user reported that all three v0.3.0 shortcut taps displayed "Favorites" even in diagnostic mode. This establishes that the wrong callback was observed before navigation. It does **not** establish a verified root cause such as overlapping hit boxes. Earlier changes must not be described as confirmed fixes.

The new implementation avoids the old construction: no copied notification subtree, no loop-captured navigation function attached to imported icon components, and no extra React hooks inserted into Discord's render function. Four local tabs use our own component instances. The original render's hooks execute before a scoped after-patch substitutes the dock.

## Interoperability policy

Disable ServerDrawer, YouBar+ and competing navigation replacements. PinDMs, custom folder icons and native typing indicators may still affect native screens, but their UI is not automatically reproduced inside the custom browser. This plugin owns its own pins. Existing icon packs should affect resolved Discord image assets; missing icons use a simple fallback. A concurrent automatic theme-switching plugin may compete with native color coordination, so disable one theme owner.

## Not verified

No iPhone/Distra runtime execution, native touch hit-testing, Hermes evaluation, VoiceOver session, live-account enumeration, large-account profiling, call coexistence, keyboard/safe-area behavior, or exhaustive third-party combination matrix was available. Browser tests do not replace those checks. Native conversation and media screens deliberately remain part of the experience.
