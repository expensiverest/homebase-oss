# Discord: Reimagined

## 0.2.0-alpha.1

A Distra-native interface with the approved graphite/sage design. This release adds custom conversation, composer, image-viewer, voice-control and profile surfaces. It is **not a complete replacement for every Discord screen** and is **not yet verified on a physical iPhone**.

### Update

Use **Distra > Plugins > Discord: Reimagined > Check for update**, confirm `0.2.0-alpha.1`, then fully close and reopen Discord. Keep YouBar+ forks and Server Drawer disabled. The installation URL is unchanged:

```text
https://raw.githubusercontent.com/expensiverest/homebase-oss/distra-youbar-plus-port/discord-reimagined/
```

The manifest now loads `next.js`. The former `index.js` is retained unchanged for rollback.

### Changes

- Headers use native hide-on-scroll-down / reveal-on-scroll-up behavior.
- Labels are **Home, Servers, Messages, You**. Promotional subtitles and eyebrow copy are removed; functional metadata and errors remain.
- Conversations open in the redesign, with a virtualized message list, custom text composer, reply/edit/delete/copy actions, basic markdown, spoilers, attachment previews, and incoming message events.
- Text send failures preserve the draft. Sending is not retried automatically. An ambiguous result remains pending until Discord confirms it.
- A new image viewer supports native zoom and sharing. Audio/video preview uses a WebView only when the host provides it; otherwise the UI offers Open File.
- A custom voice screen shows participants and actual connection state, with explicit join/start, mute, deafen and disconnect controls when the host exposes the corresponding actions. Discord's own call engine remains underneath.
- The You tab shows your profile, avatar/banner, username, pronouns, status and About Me. The custom editor saves Display Name, Pronouns and About Me. Avatar/banner editing delegates to native settings.
- The main interface now lives on Distra's native custom-page route rather than a covering React Native modal. Native settings is requested above that route, leaving the redesigned screen mounted. **Actual iOS sheet stacking still needs verification.**
- Long-press Servers for the compact server drawer. Appearance and plugin preferences are separate from the profile.

### Explicit limitations

Uploads, GIF/sticker pickers, slash commands, voice-message recording, video/screen-share UI, incoming-call presentation, forum/media-channel browsing, stage moderation, server administration, message search, and arbitrary deep-link interception remain native or unsupported by the custom surfaces. Reaction counts are displayed but the new renderer does not provide a reaction picker. Markdown/custom-emoji support is partial, not full Discord parity. Restricted-channel access checks are not bypassed.

The attachment control explains its native fallback before leaving the redesign. Controls are disabled or report an error when an internal action is missing. The plugin does not claim a successful send, profile update, or connection based solely on a visual animation.

### Data and recovery

Messages, drafts and fetched profile data are memory-only and cleared on account changes or plugin stop. Pins/history remain account-separated in plugin storage. Diagnostics contain control identifiers and capability states, not names or message content.

Disable the plugin in Distra and restart to restore native navigation. To reinstall the previously device-tested alpha, disable/remove this build and install the immutable old source URL:

```text
https://raw.githubusercontent.com/expensiverest/homebase-oss/2b665a257970fc39e308f21635a116005ad39868/discord-reimagined/
```

Do not enable both versions simultaneously.

### Validation

See [TESTING.md](TESTING.md). 24 browser integration checks passed on the exact release source through a React Native-to-DOM adapter, plus packaging/contract checks. Browser clicks, API fixtures and simulated settings sheets do not reproduce iOS, Hermes, Yoga, the keyboard, the microphone, native navigation or real Discord service behavior.

GPL-3.0-only. Original implementation; interface references are documented in [docs/NATIVE_SURFACES.md](docs/NATIVE_SURFACES.md). Not affiliated with Discord or Distra.
