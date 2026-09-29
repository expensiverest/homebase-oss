# Private remote access

Homebase's recommended remote path is phone → private Tailscale tailnet HTTPS → Tailscale Serve → `127.0.0.1:8787` on the Host. Homebase device pairing is required in addition to tailnet membership. Serve is private to the tailnet; Funnel is public and must not be used for Homebase. Do not port-forward Homebase.

1. Install and sign in to Tailscale on the computer and phone. Check `tailscale status` on the computer.
2. Build Homebase (`npm run build`) and start `homebase`. Device auth and the loopback bind are the defaults.
3. Run `tailscale serve --bg 8787`. This proxies the local HTTP service through the computer's private HTTPS tailnet hostname. Check `tailscale serve status` and `tailscale serve status --json`.
4. Run `homebase pair`. It reads the machine-local admin key, asks the running Host for a five-minute invitation, and prints a QR code and URL. It detects the Serve URL only when structured status clearly identifies a single private HTTPS endpoint proxying this Host. Otherwise pass `homebase pair --url https://machine.tailnet.ts.net`.
5. Scan the QR on the phone, name the device, and pair. The browser receives a Secure, HttpOnly, SameSite=Strict cookie. The URL fragment is removed from browser history before redemption.
6. On iPhone/iPad, use Share → Add to Home Screen. WebKit documents browser-cookie copy at creation on iOS/iPadOS 17.2 and later; earlier versions may need pairing again from the installed app. Other local storage is not copied.
7. Use Homebase → Devices to rename or revoke. If the phone is lost, run `homebase devices` and `homebase revoke <device-id>` on the computer. Revocation closes an active SSE stream and rejects further requests.
8. To turn Serve off, consult `tailscale serve status` and run `tailscale serve reset` if this computer's Serve configuration is dedicated to Homebase. Reset affects all Serve endpoints on that node.

The CLI never configures Serve automatically. It does not use Tailscale identity headers for Homebase authentication. `homebase pair --url` accepts a clean HTTPS origin; use a private overlay endpoint that you control. A malicious same-OS-user process can read the local Homebase state directory and is outside this phase's meaningful protection boundary.

Current command behavior is documented by [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) and [Tailscale Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel). The cookie handoff is documented in [WebKit's Safari 17.2 notes](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).
