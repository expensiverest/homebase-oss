# Discord: Reimagined 0.2.0-alpha.38

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

Appearance > Reimagined inside native screens (beta) redesigns Discord's own Messages, Notifications and server navigation in place. Servers become a horizontally scrolling strip across the top (Home/DMs, guild icons with selected and unread indicators and mention badges, folders that expand inline, Add a Server; tap uses Discord's own guild navigation, long press opens Discord's guild sheet; Appearance > Server strip instead of the rail turns it off and restores the rail; the strip can sit at the Top, down the Left or Right side as a vertical column, or Above the YouBar, and the setting applies live). Messages rows are laid out from scratch inside Discord's own row: squircle avatar with presence, bold name with time, a one-line preview (last message, attachment, activity or custom status) and an unread or mention pill, on rounded floating cards. Appearance > Hide scroll bars (on by default) removes scroll indicators everywhere. The You page embeds Discord's own profile pieces (trial offer, upsells, Orbs widget, current activity, About Me, connections, friends, note) with Main, Board, Activity and Wishlist tabs, falling back to Reimagined cards if a piece is unavailable. Conversations (DMs and server channels) are redesigned around Discord's native message list: the chat surface takes the Reimagined canvas, the composer is rebuilt from Discord's own pieces as a two-tier card (the message field across the full width, with attach, apps, gift, expressions and send on a tool row beneath it), and the DM and channel header titles sit in a pill. The server screen gets a guild banner with rounded lower corners and text, voice and thread channels as inset rounded pills (the selected one a tinted card) inside Discord's measured row heights; Discord's server sheet gets an inset rounded banner, a centred identity block and inset content. The messages pane rounds only the corners next to the strip (left, right, both under a top strip, none above the YouBar). Side strips stop at the top of the YouBar with a rounded lower corner, and their selection pills sit flush with the outer edge facing inward (mirrored on the right). Above the YouBar the strip floats as a rounded card at the YouBar's own width, clear of the avatar. On the You page, Edit Profile and Avatar & Banner open Discord's own profile editor (Settings > Profiles) for full parity, Nitro opens Discord's Nitro settings, Shop opens Discord's Shop and Quests opens Discord's Quest Home, all through the same native calls Discord's You screen uses, so Back returns to the You page. Previously: DM rows become taller floating cards with larger avatars and an accent edge when unread (the cell height is enlarged through Discord's own getMessagesItemChannelSizes so the list stays measured correctly), notifications become cards with Reimagined section headers, and the server rail becomes a floating panel with pill separators. It also replaces the You tab with a Reimagined You page: banner, presence ring, custom status and account switcher, badges, Edit Profile, Quests/Shop/Nitro/Settings, Orbs, member since, connections, friends, note and current activity, plus a button that shows Discord's own You page in place for activity history and wishlist (the YouBar and native navigation stay). Appearance > Hide Quests dock above the YouBar (on by default) removes the floating Quests dock; it needs an app restart to take effect and falls back to the original screen on any error. Preferences > Scan whole app (tour) visits the sibling screens of the screen you are on (names that look parameter-dependent are skipped, and a route that crashed is remembered and skipped next time), records a component census, then returns; copy the settings blueprint afterwards. Appearance > Restyle Discord settings (beta) restyles Discord's own settings lists in place (a fade-and-rise entrance; Discord's own card styling is left untouched) by patching the design-system TableRowGroup. It is off by default, needs no tweak, and switches itself off if a restyled list fails to render. The settings search bar (the design hub's SearchField) is wrapped in a rounded frame with an accent hairline (unclipped, so the focus ring stays whole). Appearance > Roomier settings rows (beta) restyles each TableRow (taller, translucent icon tiles, accent-tinted selected radio rows); the group skin adds a rounded hairline-bordered card with small-caps section titles. Appearance > Record settings blueprint, then Copy settings blueprint, captures a text-free structural sample (component names, prop keys, numeric styles) of the rows and groups on each screen you visit so the skin can be designed from real data. Check the compatibility report for NativeSkinTableRowGroup and NativeSkinTableRow.

## Validation

Presenter tests and synthetic plugin lifecycle integration checks run in the Reimagined Repair workflow before publication. No physical iOS/Hermes/Yoga test or real Discord service action is claimed. See scripts/reimagined/ for the reproducible build and tests.

The installer SHA-256 covers the exact source bytes. Runtime has no remote code loader. GPL-3.0-only.
