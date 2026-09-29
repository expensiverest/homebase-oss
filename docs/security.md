# Security model

> Reporting: see [SECURITY.md](../SECURITY.md).
> Design requirements: IMPLEMENTATION_PLAN §16. Threat analysis: [threat-model.md](threat-model.md).

Homebase remotely controls software that can read files, modify repositories, and run shell commands.
Security is architecture, not polish; unsafe defaults are bugs.

## Current guarantees (Phase 5)

### Network exposure

- The Host binds to `127.0.0.1` by default.
- Device auth is the default even on loopback. `auth.mode: "none"` is an explicit development choice; non-loopback with `none` refuses startup. A loopback Host can still be exposed by a proxy, so the recommended Serve path must retain device auth.
- All `/api/*` responses are `cache-control: no-store`.
- Health is reachable without authentication but contains only status, version, uptime, and the latest
  event sequence — no project names, provider credentials, or configuration.

### Authentication and pairing

- `auth.mode: "device"` is the default. `none` and `dev-token` remain explicit development modes.
- `auth.mode: "dev-token"` requires a token of at least 32 characters, compared in constant time over
  SHA-256 digests. Tokens are sent in the `Authorization: Bearer` header only, never in query strings.
- Repeated failures per client key are throttled with `429` and `retry-after`.
- `homebase pair` uses a private machine-local 256-bit admin key to request an invitation through a loopback-only management endpoint. Admin endpoints also reject `Origin` and reverse-proxy forwarding headers, even when a proxy connects from loopback. The admin key is never sent to a browser or printed.
- Invitations are 256-bit random, last five minutes, live only in Host memory, and are consumed before asynchronous device creation. Creating another invitation invalidates the previous one. Invalid attempts have per-client throttling. The QR URL puts the one-time secret in a fragment; the browser removes it from history and POSTs it in a small, strict JSON body.
- Permanent credentials have the form `hbdev1.<public UUID>.<256-bit secret>`. The state file stores only a SHA-256 digest and metadata. Verification uses constant-time comparison. The browser receives the secret only as `__Host-homebase-device`, with `Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` and no Domain. A successful auth-status bootstrap refreshes this one-year browser lifetime; server-side revocation remains authoritative. Browsers or users may remove cookies earlier. JS never reads it.
- `GET /api/v1/auth/status` reveals only mode, paired state, and current-device metadata. The private devices API lists safe metadata, renames, and revokes. A current-device revoke clears the cookie. Any revoke terminates that device's SSE stream and blocks subsequent REST, attachment, session, action, and child-session calls.
- `HOMEBASE_STATE_DIR` overrides `~/.homebase`. State is schema-versioned JSON written through a private temporary file and atomic rename; corrupt or future-version state fails startup closed. POSIX files use mode 0600 and the directory 0700. Windows file ACLs are inherited from the account's profile/selected directory; operators should choose a private directory on shared Windows machines.
- The Host throttles failed authentication and pairing (10 failures per client and a high global invalid-pairing ceiling). Valid credentials are checked before per-client lockout so a bad request through Serve's shared loopback address cannot lock out a paired device. Expensive agent-command throttling remains a later hardening item.
- Cookie mutations check `Origin` when present against the browser-visible origin, reject cross-site Fetch Metadata, and require `X-Homebase-Client: 1`. To support local Tailscale Serve, `X-Forwarded-Proto` and `X-Forwarded-Host` reconstruct that origin only when the actual socket peer is loopback; malformed or incomplete trusted forwarding headers fail closed. Direct non-loopback clients cannot redefine their origin with forwarded headers. No permissive CORS is enabled. Local admin requests use a separate header and reject browser Origin and proxy forwarding headers.

### Project paths

This is the most important boundary in the product:

- Project roots are Host configuration (`projectRoots`), canonicalized once at startup with `realpath`.
- A registered project's path can only come from the Host project registry; project ids are derived from
  canonical paths.
- Client input schemas are strict and contain no `path`, `cwd`, or `directory` field; unknown keys are
  rejected (covered by tests).
- Every path handed to an adapter is either an `AgentProject` record produced by the registry or the
  result of `context.resolveProjectPath(projectId)`, which re-checks the canonical path against the
  allowlist.
- Symlink escapes are resolved before comparison; sibling-prefix attacks are rejected.

### Credentials

- Provider credentials and CLI logins live on the Host machine only. The phone never authenticates to a
  provider.
- Provider configuration (`providers.<id>.config`) is passed to adapter factories server-side and is
  never returned by the API.
- Adapters must never include credentials in detection output, events, errors, or logs; the compliance
  suite checks detection output for credential-looking fields.
- `redactSecrets()` in the adapter SDK is a best-effort safety net for logs (API keys, bearer tokens,
  private keys, `KEY=value` patterns). It is not a license to log secrets.
- **Claude Code auth output is redacted by construction.** `claude auth status` returns email, org
  id/name, subscription type, and paths; the adapter parses it and keeps only the `loggedIn` boolean.
  Raw auth output is never stored, logged, returned, or placed in events. The compliance suite
  recursively rejects sensitive detection fields and email-like values.
- **Claude sessions keep strict MCP isolation.** Each Homebase-driven `claude` process is launched
  with an explicit Homebase-only MCP config and `--strict-mcp-config`, so personal connectors
  (Gmail/Drive/Calendar/…) are never loaded into an unattended Homebase session. Live verification
  confirmed `init.mcp_servers` contains only the Homebase server.
- **Claude "always allow" rules are session-scoped and in-memory.** Homebase never writes
  `.claude/settings*.json` or any provider settings file to implement the mobile button.
- **No Claude bypass modes.** `bypassPermissions` and `dontAsk` cannot be selected through Homebase.

### Attachments

- Bytes are uploaded to the Host (`POST /api/v1/attachments`), stored in memory only, and addressed by
  random ids. Clients never send or receive filesystem paths.
- Initial allowlist: `text/plain`, `text/markdown`, and raster images (`png`, `jpeg`, `gif`, `webp`)
  with magic-byte verification; NUL bytes are rejected in text files.
- Limits: 20 MiB per file, 10 files per upload, 64 MiB total store with LRU eviction, 6-hour TTL, and a
  route-specific 25 MiB request cap (the global JSON body limit stays 1 MiB).
- Adapters receive bytes only through `AdapterContext.resolveAttachment(id)`; a provider adapter converts
  them to its own representation internally (for example data URLs for OpenCode).
- Attachment responses are `no-store`; nothing is written to disk, so nothing persists indefinitely.

### API hardening in place

- 1 MiB request body limit; strict JSON validation with stable `invalid_request` errors.
- Zod schema limits on message text (200k chars) and attachment references (20).
- Stable error envelope; unknown errors become `internal` with a generic message while details are
  logged server-side only.
- No third-party scripts, analytics, or CDNs anywhere in the stack.

## Remaining hardening

- Generic per-device limits for costly agent operations and further hostile-content regression coverage.
- A fixture privacy audit and automated secret scan remain CI responsibilities.

## Remote access guidance

- Use private **Tailscale Serve** over HTTPS. Do not use Funnel, port forwarding, or a public relay. See [remote-access.md](remote-access.md).
- Tailscale (or an equivalent private overlay) is transport privacy, not a substitute for authentication:
  device pairing is still required before remote control is allowed.

## Web client (Phase 4)

- The browser receives provider-neutral data only: no provider credentials, no native payloads, no
  provider-owned error strings. Model output is rendered as Markdown without raw HTML; Shiki highlights code
  from escaped source text, and remote images inside model output are not fetched.
- Paired credentials live only in HttpOnly cookies and flow automatically to same-origin REST and fetch-based SSE. The old bearer injection point is limited to explicit dev-token compatibility. No permanent token enters browser storage or URL.
- WebKit copies website cookies, but not arbitrary local storage, when a Home Screen app is created on iOS/iPadOS 17.2 and later. This supports Safari → PWA pairing handoff; earlier versions may require pairing inside the installed app.
- Production responses set a strict CSP with `script-src 'self'` and no inline or eval scripts, plus nosniff, no-referrer, frame denial, Permissions Policy, COOP, CORP, and HSTS. `style-src 'unsafe-inline'` remains for current React inline styles and dynamic layout values. The pre-paint theme script is a same-origin file.
- Attachment bytes are fetched with the same credentials and exposed through object URLs that are revoked on
  unmount. Attachment text is never persisted locally, and the query cache is memory-only.
- The service worker caches app-shell assets only. `/api/*`, the event stream, transcripts, approvals,
  questions, attachments, and usage are never cached; going offline reports that Homebase cannot reach the
  Host instead of showing stale private data.
- HTTP static serving of the built PWA denies path traversal outside `apps/web/dist`, never SPA-falls back for
  `/api/*` or extension paths, and keeps `no-store` on API responses.
