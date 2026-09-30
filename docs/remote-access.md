# Private remote access

Homebase's recommended remote path is phone → private Tailscale tailnet HTTPS → Tailscale Serve → `127.0.0.1:8787` on the Host. Homebase device pairing is required in addition to tailnet membership. Serve is private to the tailnet; Funnel is public and must not be used for Homebase. Do not port-forward Homebase.

1. Install and sign in to Tailscale on the computer and phone. Check `tailscale status` on the computer.
2. Run `npm install`, then `npm run setup` in the source checkout. The wizard builds/links, selects roots, detects providers, and installs a user background Host. Rerun `homebase setup` to review/repair; existing devices are preserved.
3. Setup offers private Serve when connected and structured configuration is clearly empty and safe. It runs `tailscale serve --bg http://127.0.0.1:8787` (or your fixed port), then verifies the exact mapping. Correct Serve is preserved; conflicting, ambiguous, or Funnel state blocks automatic mutation. Setup never runs `tailscale up` or enables Funnel.
4. Run `homebase pair`. It reads the machine-local admin key, asks the running Host for a five-minute invitation, and prints a QR code and URL. It detects the Serve URL only when structured status clearly identifies a single private HTTPS endpoint proxying this Host. Otherwise pass `homebase pair --url https://machine.tailnet.ts.net`.
5. Scan the QR on the phone, name the device, and pair. The browser receives a Secure, HttpOnly, SameSite=Strict cookie. The URL fragment is removed from browser history before redemption.
6. On iPhone/iPad, use Share → Add to Home Screen. WebKit documents browser-cookie copy at creation on iOS/iPadOS 17.2 and later; earlier versions may need pairing again from the installed app. Other local storage is not copied.
7. Use Homebase → Devices to rename or revoke. If the phone is lost, run `homebase devices` and `homebase revoke <device-id>` on the computer. Revocation closes an active SSE stream and rejects further requests.
8. Inspect `tailscale serve status` before removal. For an HTTPS root dedicated to Homebase, use `tailscale serve --https=443 off`; do not reset unrelated configuration. Homebase uninstall leaves Serve unchanged.

Setup offers existing pairing when the Host is healthy, device auth is enabled, and private HTTPS is available.
Without HTTPS it preserves secure cookies and tells you to pair later. Explicit development auth is preserved,
and remote configuration is skipped. Tailscale identity headers never authenticate Homebase.
`homebase pair --url` accepts a clean HTTPS origin; use a private overlay endpoint you control. Same-OS-user
compromise can read local state and is outside the meaningful protection boundary.

Start troubleshooting with `homebase doctor` and `homebase service status`. Foreground `homebase`, manual
`tailscale serve --bg http://127.0.0.1:8787`, and `homebase pair` remain available. See [service operations](service.md).
The normal path is setup → background Host → private Serve → pairing QR, without a terminal during daily use.

Current command behavior is documented by [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) and [Tailscale Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel). The cookie handoff is documented in [WebKit's Safari 17.2 notes](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).
