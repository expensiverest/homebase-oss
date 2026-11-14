# Native surface integration references

This release preserves the previously approved palette and component language. It does not copy a native Discord bundle, use account tokens directly, or introduce a separate Discord login/client.

## Inspected primary sources

- Distra `src/ui/settings/index.tsx`: the `DISTRA_CUSTOM_PAGE` route and render-component parameter. The route is used as the custom screen host so native settings can be presented above it.
- Distra `src/plugins/flavors/distra.ts`: the native plugin expression, per-plugin storage, scoped patcher and lifecycle.
- Distra `src/metro/common.ts`, `src/lib/lazy.ts`: React Native/React resolution, native navigation and lazy-wrapper unwrapping.
- Distra `src/plugins/core/voicestats/stats.ts`: RTCConnectionStore, SelectedChannelStore and MediaEngineStore state observations.
- Endcord `next/bundle/src/plugins/hooks.tsx`: message action lookup, send/edit/delete argument shapes, and the existing authenticated HTTP-module interface.
- Endcord `next/bundle/src/plugins/shared/calls.ts` and `shared/voice.ts`: voice-channel selection/disconnection, channel IDs and participant stores.
- Endcord `next/bundle/src/plugins/profileSets/index.tsx`: profile field endpoints and UserProfileStore access.
- PalmDevs `plugins/better-calls/src/patches/silentCall.tsx`: the documented observed private-call argument shape. Used as interface reference; its unlicensed implementation was not copied.
- React Native ScrollView documentation: `stickyHeaderIndices` with `stickyHeaderHiddenOnScroll`.

Distra source reference commit: `a521173d4957f2b9f15194b11c649f698d8b741d`.

The methods above are internal interfaces. Their presence and argument shapes in source do not prove behavior on the installed iOS binary. Browser fixtures match the intended interface and cannot validate native implementations.

## Boundaries

Only explicit user actions can send/edit/delete messages, save profile changes, or start/join/disconnect calls. No test messages or profile changes were sent to the user's live account during development.

Message history reads use the host's authenticated HTTP client and enforce the locally available view-permission checks first. Settings and advanced native recovery remain accessible. Saved fields are dirty-only, avoiding clearing fields not loaded into the editor. Send confirmation uses nonce identity rather than guessing from matching text.

The previous release's main file is retained; the new manifest points to next.js. No main-branch or other Homebase source files are changed.
