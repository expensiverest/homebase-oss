# Security model

> Reporting: see [SECURITY.md](../SECURITY.md).
> Design requirements: IMPLEMENTATION_PLAN §16. Threat analysis: [threat-model.md](threat-model.md).

Homebase remotely controls software that can read files, modify repositories, and run shell commands.
Security is architecture, not polish; unsafe defaults are bugs.

## Current guarantees (Phase 0/1)

### Network exposure

- The Host binds to `127.0.0.1` by default.
- Configuration validation **refuses to start** when `host.bindAddress` is not loopback and
  `auth.mode` is `"none"`. A non-loopback bind requires an explicit `dev-token` today and device
  authentication after Phase 5.
- All `/api/*` responses are `cache-control: no-store`.
- Health is reachable without authentication but contains only status, version, uptime, and the latest
  event sequence — no project names, provider credentials, or configuration.

### Authentication (Phase 1 placeholder)

- `auth.mode: "none"` is only safe because of the loopback invariant above.
- `auth.mode: "dev-token"` requires a token of at least 32 characters, compared in constant time over
  SHA-256 digests. Tokens are sent in the `Authorization: Bearer` header only, never in query strings.
- Repeated failures per client key are throttled with `429` and `retry-after`.
- Phase 5 replaces the shared token with `homebase pair`: a short-lived single-use pairing credential
  exchanged for a revocable per-device credential (device id, name, created/last-seen, revoked).

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

## Planned (Phases 4–5, release-blocking)

- Pairing with QR flow, one-time credentials, and device revocation.
- Strict CSP for the PWA; Markdown sanitization that never renders raw agent HTML; tool output escaping.
- Rate limiting for pairing, auth failures, and expensive actions.
- Security headers on the served PWA.
- Fixture privacy audit and secret scan in CI.

## Remote access guidance

- Use a private network such as **Tailscale**. Do not port-forward Homebase to the public internet and
  do not enable a public relay.
- Tailscale (or an equivalent private overlay) is transport privacy, not a substitute for authentication:
  device pairing is still required before remote control is allowed.

## Web client (Phase 4)

- The browser receives provider-neutral data only: no provider credentials, no native payloads, no
  provider-owned error strings. Model output is rendered as Markdown without raw HTML; Shiki highlights code
  from escaped source text, and remote images inside model output are not fetched.
- Credentials, when Phase 5 adds them, flow through one transport injection point shared by REST and SSE. The
  client never places tokens in URLs or query strings; native `EventSource` is deliberately unused because it
  cannot send an `Authorization` header.
- Attachment bytes are fetched with the same credentials and exposed through object URLs that are revoked on
  unmount. Attachment text is never persisted locally, and the query cache is memory-only.
- The service worker caches app-shell assets only. `/api/*`, the event stream, transcripts, approvals,
  questions, attachments, and usage are never cached; going offline reports that Homebase cannot reach the
  Host instead of showing stale private data.
- HTTP static serving of the built PWA denies path traversal outside `apps/web/dist`, never SPA-falls back for
  `/api/*` or extension paths, and keeps `no-store` on API responses.
