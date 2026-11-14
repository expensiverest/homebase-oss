# Validation record - 0.2.0-alpha.1

Source SHA-256: `e508378660675a0659af7cc1276491ca7588aea7f3245a1da2c11536c75a9451`

**24/24 browser integration checks and 6/6 Node contract checks passed. Native iOS verification: not performed.**

The exact production `next.js` was executed using React 16.0.0, Chromium, an explicit React Native-to-DOM adapter, and fictional Discord stores/actions. The adapter, browser tests and fixtures are development-only; the plugin uses Discord's installed React and React Native. No real Discord account actions were performed.

## Browser results

1. Distinct navigation and Discord terminology — PASS
2. Scroll header hides down and reveals up in adapter — PASS
3. Server search and pin filter — PASS
4. Permission checked channels and custom conversation — PASS
5. Text send once and confirmed draft clear — PASS
6. Rejected send preserves draft and does not retry — PASS
7. Reply reference and no reply ping — PASS
8. Edit and confirmed delete — PASS
9. Spoiler stays hidden until tapped — PASS
10. Image viewer and share — PASS
11. Settings overlay preserves conversation draft — PASS
12. Profile settings opens native sheet over profile — PASS
13. You profile and dirty-only display name save — PASS
14. Bio and pronouns save — PASS
15. Explicit voice join, mute, deafen and disconnect — PASS
16. Account switch clears drafts — PASS
17. Server drawer dismiss and expand — PASS
18. Diagnostics excludes private text and IDs — PASS
19. Unsupported attachments transparently use fallback — PASS
20. Disable retains escape to Discord — PASS
21. Responsive scenes and touch targets 320 — PASS
22. Responsive scenes and touch targets 375 — PASS
23. Responsive scenes and touch targets 414 — PASS
24. Responsive scenes and touch targets 768 — PASS

## Limits

The scroll adapter models native sticky-header props; it does not prove iOS bounce behavior. The settings overlay is simulated; actual native route/sheet stacking is unverified. Message/profile/voice services are mocked. The tests do not establish live delivery, permission handling on the server, keyboard geometry, video playback, microphone routing, incoming-call handling or the installed Discord module shapes.

## Packaging checks

Run `node --check next.js` and `node --test tests/*.test.cjs`. These verify the native plugin expression and exact entry-point/hash. They do not prove native compatibility.

The prior TESTING record applies only to 0.1.0-alpha.1, not this release.
