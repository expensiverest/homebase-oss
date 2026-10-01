# Security model

> Reporting: see [SECURITY.md](../SECURITY.md).
> Design requirements: IMPLEMENTATION_PLAN §16. Threat analysis: [threat-model.md](threat-model.md).

Homebase remotely controls software that can read files, modify repositories, and run shell commands.
Security is architecture, not polish; unsafe defaults are bugs.

## Current guarantees (Phase 5 + 5.5)

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

### Local configuration and the CLI

- The user-scoped config (`${HOMEBASE_STATE_DIR:-~/.homebase}/config.json`) is written atomically: unique temp file in
  the same directory, `fsync`, rename over the target, temp cleanup on failure. POSIX files are `0600` and the state
  directory `0700`; Windows inherits the account's profile/selected-directory ACLs (same limitation as state files).
- A legacy `./homebase.config.json` is validated with the full schema and security invariants before being copied
  into the user config; the legacy file is never deleted.
- Project roots can only be changed by the local `homebase projects add/remove` CLI, which canonicalizes with
  `realpath`, requires an existing directory, de-duplicates with platform case rules, validates the complete
  resulting configuration, and persists atomically. There is no REST endpoint or web field that accepts a
  root filesystem path; `AgentProject.path` still comes only from the Host registry. File browsing accepts
  only a relative path inside an existing project id.
- Project-root changes apply at the next Host start; they are not hot-swapped under active sessions.

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
- **OpenCode managed servers are Homebase-owned and loopback-only.** In `auto`/`managed` mode Homebase spawns
  `opencode serve --hostname 127.0.0.1` with a random 256-bit in-memory password (`OPENCODE_PASSWORD` /
  `OPENCODE_SERVER_PASSWORD`). The password is never logged, persisted, returned to the browser, or exposed through
  Tailscale; only the authenticated Homebase Host is remotely reachable. Homebase never reads OpenCode daemon
  password files, edits service configuration, or kills a server it did not spawn. Shutdown terminates the complete
  process tree Homebase created (Windows `taskkill /PID <pid> /T`, escalating to `/T /F`), so npm `.cmd` wrappers
  cannot orphan the real server; external/shared servers are never passed to that path.
- **Grok credentials stay with Grok.** The adapter accepts only executable/timeout configuration (strict schema);
  API keys, OAuth tokens, refresh tokens, emails, and browser sessions are rejected as unknown fields. Non-interactive
  auth methods are preferred; interactive login is never started from Homebase. Grok's child environment is inherited,
  so a user-managed `XAI_API_KEY` reaches Grok without Homebase copying or storing it.
- **ACP processes are spawned without a shell** (`shell: false`, argv as an array; the only platform exception is the
  dependency-free Windows `.cmd`/`.bat` shim wrapper described in `packages/adapter-sdk/src/exec.ts`, which still
  passes argv as an array and never interpolates user content). stdout is protocol-only; stderr is bounded (default
  64 KiB) for local diagnostics and is never returned to the PWA. The ACP client advertises no `fs/*` or `terminal/*`
  capabilities, so a provider cannot use Homebase as a file or shell execution surface. Shutdown uses the shared
  owned-process-tree terminator: stdin EOF for ACP first, then SIGTERM → SIGKILL on POSIX or `taskkill /T` → `/T /F`
  on Windows, only ever against children Homebase spawned.
- **Provider crashes cannot leave a session "Working".** Transport exit rejects outstanding requests, cancels pending
  permission bridges, and fails active turns; provider refresh can reconnect.

### Read-only project files (Phase 6.1)

**Pairing grants read access to files inside configured projects through the Homebase UI.** Projects may
contain credentials or other sensitive files. Homebase does not hide arbitrary secret filenames or claim
that its preview limit is a confidentiality filter. Select roots and pair devices accordingly.

File APIs resolve a registered project id on the Host, reject absolute/drive/UNC/NUL/traversal/encoded
paths and malformed separators, and compare the final realpath against that specific canonical project.
Symlinks and Windows junctions/reparse aliases cannot expand the boundary. Escaped/broken entries are
unavailable without disclosing their targets. The reader re-resolves after opening, compares file identity,
uses no-follow/nonblocking flags where supported, and reads only regular files. Same-OS-user filesystem
replacement is outside Homebase's protection model; arbitrary concurrent hostile filesystem writes are
not a sandboxed capability. The project allowlist remains authoritative.

Listings iterate at most 500 entries without recursion and hide `.git` metadata. Text previews are bounded
at 1 MiB and raster images at 10 MiB. Devices, pipes, sockets, binary/invalid UTF-8, SVG and PDF are not
previewed. Verified PNG/JPEG/WebP/GIF bytes use authenticated object URLs revoked on unmount. HTML is
escaped source; Markdown uses the existing safe renderer with raw HTML disabled, unsafe links blocked,
and remote images not fetched. Project content is never loaded in an iframe or executed.

Normal device authentication, shutdown guards, and `Cache-Control: no-store` apply to all file routes.
The service worker never caches `/api/*`. Contents are not logged, persisted in browser storage, included
in diagnostics, or put into project activity metadata. In-memory query/highlight state clears on auth loss;
the phone also limits displayed lines/characters and skips highlighting large source blocks.

### Attachment storage

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

## Setup and user-service boundary (Phase 6)

Setup uses validated raw config and existing canonical project mutations. It never copies shell credentials
into configuration or service files. Definitions store exact executable/entry/config/state paths and sanitized
absolute PATH only; CLI provider authentication remains provider-owned. Services run as the current user through
Task Scheduler, LaunchAgent, or systemd user units. No sudo, LocalSystem, automatic login, Funnel, or public
update download is introduced.

`GET /api/v1/admin/status` returns operational counts/config/provider status only. `POST /api/v1/admin/shutdown`
flushes 202 before requesting runtime disposal. Both reuse Phase 5 checks: actual loopback peer, private key,
no Origin, and no forwarded headers. They are absent from the PWA and reject paired credentials and Serve.

OS commands use bounded argv execution. Windows hidden startup uses a fixed encoded PowerShell/.NET process
launcher; paths are encoded data, argv uses the tested Windows quote helper, and user strings never become
PowerShell expressions. Native fallback captures only children of the exact action, then rechecks creation
identity before tree termination. POSIX definitions escape XML/systemd values without shell wrappers.
Commands refuse mismatched/unowned definitions; corrupt metadata does not authorize destructive repair.
Private POSIX state/metadata remain 0700/0600; Windows depends on current-user profile ACLs.

Purge requires confirmation plus an exact ownership marker and rejects symlinks, shallow paths, root/home/repo
and project ancestors, and unexpected contents. Default uninstall leaves state, providers/auth, projects, and
Serve untouched. Operational logs rotate at 1 MiB plus one backup. Doctor performs no repair or provider
initialization. Same-user executable/PATH/state replacement is outside meaningful protection; doctor checks
missing/stale paths and PATH differences. Network updating/signing awaits a public release channel.

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
