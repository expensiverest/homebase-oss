# Validation record - 0.1.0-alpha.1

Source SHA-256: `c1f58d54791466bf4dad42b2f79ec2ee418854cb1c008e1c5eaf88ab6804ab81`

**25/25 browser checks and 3/3 Node contract checks passed. Native iOS verification: not performed.**

The browser run used Chromium, the production index.js component tree, React 16.0.0, a small React Native-to-DOM adapter, and explicitly fictional Discord stores. It tested actual rendered coordinate clicks rather than only invoking saved callbacks. Discord runtime exports, network behavior, Hermes and Yoga were not reproduced. The installed plugin uses Discord's React, not the preview's React 16.

## Browser checks

1. Coordinate clicks reach four distinct tab instances.
2. Server search, clearing and grid/list toggle.
3. Pins persist separately for each account.
4. Channel listing excludes permission-denied channels.
5. Modal dismissal sends native channel action exactly once.
6. DM filters exclude blocked people and route a specific conversation.
7. Recent native conversation appears as a resume shortcut.
8. Server drawer expands into the full library.
9. Theme sync restores the previous theme; previews can be disabled.
10. Compatibility report excludes names, message text and numeric identifiers.
11. Tap diagnostics identify separate controls without suppressing navigation.
12. Discord settings handoff is not a Favorites route.
13. Teardown restores original bar and preserves a separately chosen theme.
14. Settings fallback opens shell when no navigation hook exists.
15. Late-loaded You Bar is patched when available.
16. Missing permission API fails closed with native-list fallback.
17. Logged-out user retains native UI with no shared pin bucket.
18. Empty stores render honest empty states.
19. Four-screen responsive layout and nonoverlapping 44px+ tabs at 320px.
20. Four-screen responsive layout and nonoverlapping 44px+ tabs at 375px.
21. Four-screen responsive layout and nonoverlapping 44px+ tabs at 414px.
22. Four-screen responsive layout and nonoverlapping 44px+ tabs at 768px.
23. System reduced-motion change leaves navigation functional.
24. Stopping cancels a pending native navigation fallback.
25. No uncaught browser render errors.

## Node checks

- Evaluate the exact Distra native expression wrapper.
- Verify manifest version, entry point, and exact source SHA-256.
- Check absence of runtime fetch/XHR, the old Favorites route and inserted React.useReducer calls.

## Required native smoke test

Disable old YouBar+/ServerDrawer. Install and restart. Test each local tab, a server, a channel, one specific DM, Discord settings, modal dismissal, server drawer, keyboard input, theme restoration and plugin disable. Check the original app remains accessible. Copy the compatibility report if any native export or hook is missing.

Passing the browser run is not a guarantee of passing this device smoke test.
