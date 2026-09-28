# Private Homebase reuse map

> **Status:** Initial audit (Phase 0)
> **Sources inspected (read-only):** the operator's private Homebase worktrees, all cloned from the same
> private repository:
>
> - the `main` worktree (tip commit `c71518b`, 2026-09-27) — the richest/current copy;
> - a `feat/claude-code-ui` worktree;
> - a `fix/chat-polish` worktree with uncommitted changes.
>
> Inspection covered `apps/hub`, `apps/claude-bridge`, `apps/web`, `packages/shared`, `apps/pc-agent`,
> tests, fixtures, `docs/`, and `deploy/`. The private repositories were not modified, and no Git
> history, credentials, machine names, personal paths, or other user-specific data were imported into
> this repository.

This map classifies what the private implementation contributes to the open-source Homebase and how each
area should fit the new provider-neutral architecture. It is organized as:

1. **Reuse with light adaptation** — already generic enough to lift with naming/parameterization changes.
2. **Reuse after refactoring** — proven behavior that must be rewritten around the new protocol.
3. **Do not port** — private infrastructure, personal data, brittle hacks, or out-of-scope features.

The private repository grew OpenCode-first, so its shared contract (`OcSession`, `OcMessage`, `OcEvent`)
is the single biggest thing **not** to carry over. Everything valuable in it should be re-expressed as
`AgentSession` / `AgentMessage` / `AgentEvent` behind the adapter contract.

---

## 1. Reuse with light adaptation

These areas are close to provider-neutral already. The new repository ports the _policy_, tests, and
discipline; names and configuration are generalized.

### 1.1 Path normalization and allowlisting

**Private source:** `apps/hub/src/projects/winpath.ts`, `apps/claude-bridge/src/paths.mjs`, and the
allowlist checks sprinkled through hub routes and bridge routes.

**What it does:** Validates that any directory handed to a provider process is absolute, normalized,
free of `..`, UNC, device-path, and reserved-character tricks, and inside one of the configured
`PROJECT_ROOTS`. Both the hub _and_ the bridge independently re-check the session's own directory, so a
guessed session id cannot escape the roots even without a query parameter. Tests cover sibling-prefix
attacks (a root named `Projects` must not match `Projects-evil`), case-insensitivity, and missing
directories.

**How it fits now:** Ported as `apps/host/src/paths.ts` (`PathAllowlist`) with the same policy, but
platform-aware (`realpath` canonicalization, case-folding only on Windows) and with symlink escapes
resolved. The Host resolves project ids to canonical paths; adapters receive `AgentProject` records or
call `context.resolveProjectPath()`, never raw client paths. The "check at every boundary" discipline is
kept: the API layer rejects unknown keys (including `path`) and the registry is the only path source.

**Kept behaviors:** canonicalize once at startup; re-check at use; deny by default; test escapes.

### 1.2 Constant-time bearer auth and the narrow service pattern

**Private source:** `apps/claude-bridge/src/bridge.mjs` (`tokenMatches`), `apps/pc-agent/agent.mjs`.

**What it does:** Dependency-free Node services that bind `127.0.0.1`, require a bearer token compared in
constant time, fail closed, and never log the token. Tokens are generated at install time and stored in
a `chmod 600` env file.

**How it fits now:** The shape is reused for the Phase 1 dev-token authenticator
(`apps/host/src/auth/auth.ts`): constant-time comparison over SHA-256 digests, failure throttling, and no
tokens in query strings. Phase 5 replaces the shared token with one-time pairing plus revocable
per-device credentials, keeping the same comparison and throttling primitives. The
"one narrow read-only helper service" pattern remains a valid pattern for future PC-side helpers, with
the credential-scraping parts explicitly out of scope (see §3).

### 1.3 SSE framing and keepalive discipline

**Private source:** hub `routes/opencode.ts` SSE endpoint and `apps/claude-bridge` SSE writer.

**What it does:** `text/event-stream` with `no-cache`, `x-accel-buffering: no`, 15-second heartbeat
comments, `id:` from durable sequence numbers, named events, and reconnect handling. The web client
reconnects on `visibilitychange` because iOS suspends background streams.

**How it fits now:** The discipline is kept, but the contract is replaced by one global normalized
stream (`GET /api/v1/events`) where _every_ event has a monotonically increasing global `sequence`
(not just durable ones), and `Last-Event-ID` / `?since=` replays the bounded buffer. A `resync` event
tells the client when the requested point was dropped. Implemented in `apps/host/src/api/sse.ts`.

### 1.4 Hono application skeleton

**Private source:** `apps/hub/src/app.ts`, `apps/hub/src/static.ts`.

**What it does:** Small typed Hono app with security headers, `cache-control: no-store` on API routes,
JSON 404 fallbacks, a single `onError` that returns `{ error }`, and later SPA serving with a
path-traversal guard.

**How it fits now:** The skeleton is reused in `apps/host/src/api/app.ts` (request ids, no-store,
`x-content-type-options`, body limit, stable error envelope, catch-all 404). Static PWA serving +
traversal guard is deferred to Phase 4 and will be ported from `static.ts`.

### 1.5 Structured error normalization

**Private source:** `OpencodeError`, `ClaudeBridgeError`, `PcAgentError`, route-level `onError` maps.

**What it does:** Provider/transport errors become `{ status, tag/code, message }` and are mapped at the
route boundary; raw provider errors are not handed to the UI.

**How it fits now:** Kept as architecture, not copied: one stable `AgentErrorCode` vocabulary in
`@homebase/protocol` and one `HostError`/`normalizeError` path in `apps/host/src/errors.ts`. Adapters
throw `AdapterError`; the Host sanitizes and maps to HTTP. Provider-native tags stay inside adapters.

### 1.6 Configuration validation patterns

**Private source:** `apps/hub/src/env.ts`.

**What it does:** Zod schema with defaults, aggregated issue reporting, placeholder filtering, env-file
loading, and a `/api/config` response that exposes only non-secret fields.

**How it fits now:** Reworked as `apps/host/src/config/config.ts`: JSON config file + env overrides,
`ConfigError` with an issue list, `configSummary()` for logs that provably excludes secrets, and a
release-blocking security invariant — a non-loopback bind with `auth.mode = "none"` refuses to start.
Providers get validated per-provider config passed only to adapter factories.

### 1.7 Test methodology

**Private sources:** hub `test/agent.test.ts` (fake `fetch` route tables), bridge `test/*.mjs` (fake
CLI + two scrubbed real stream captures), web unit reducers, Playwright suite.

**What it does:** Hermetic tests at the adapter boundary (injected `fetch`, injected `EventSource`
factory, fake CLI process), captured fixtures for stream shapes, and a mobile state matrix that checks
every screen in every scenario × theme, including reduced motion, 130% text, and touch targets.

**How it fits now:** Directly adopted. The new repository has mock-based protocol/host tests, a
compliance suite that runs live only when explicitly enabled, and will reuse the fake-CLI and
fixture-replay approach when the Claude adapter is ported in Phase 3. The rule "prefer captured fixtures
over paid live runs, use live runs to check assumptions" comes from this codebase's documented lessons
(unit tests were green through five real Claude CLI behavior bugs).

### 1.8 Design system foundation

**Private source:** `apps/web/src/styles/tokens.css`, `index.css`, design-direction doc.

**What it does:** Token-only Tailwind theme (default color/type scales cleared), WCAG-checked contrast
test that parses the token file, reduced-motion overrides, iOS safe-area utilities, 44px touch token, PWA
manifest, theme persistence, no-service-worker stance so private API data is never cached.

**How it fits now:** Lift in Phase 4 with a renamed brand palette and no private motifs (home-pulse,
machine links). Keep the token discipline, contrast unit test, reduced-motion behavior, safe-area CSS,
and "no service worker cache for session data" requirement from IMPLEMENTATION_PLAN §15.

### 1.9 Documented provider-quirk methodology

**Private source:** `docs/claude-code-notes.md`, `docs/phase-3..5-notes.md`, bridge contract comments.

**What it does:** Records verified provider behavior (flags, stream quirks, id shapes, failure modes)
next to the implementation, distinguishes "doc-derived" from "live-verified", and lists gaps between
documented and actual behavior.

**How it fits now:** Adopted as a requirement: provider quirks live next to the adapter, compatibility
notes go in `docs/compatibility.md`, and Phase 3 ports the Claude notes' _findings_ (not the personal
narrative) into adapter documentation.

---

## 2. Reuse after refactoring

These are proven implementations whose behavior should survive, but whose types, module boundaries, and
transport assumptions must change to fit the provider-neutral architecture.

### 2.1 The `Oc*` canonical model → protocol entities

**Private source:** `packages/shared/src/opencode.ts` (554 lines) plus `src/claude.ts` (which aliases it).

**What it does:** The private app's de-facto canonical chat model: sessions, a message union (user,
assistant, agent-switched, model-switched, idle, other), assistant parts (text, reasoning, tool), a
four-state tool union, permission requests, form fields (string/number/boolean/multiselect/external with
conditions), diffs, and a ~45-name event vocabulary with SSE framing.

**Why it is valuable:** It is already a provider _abstraction_ in practice — the Claude integration
reuses it wholesale via type aliases and works. Its field-level semantics encode hard-won behavior:
tool calls are first-class parts with lifecycle states; messages merge across provider frames; the event
vocabulary separates durable from non-durable state.

**How it must change:**

- Rename to the protocol vocabulary (`AgentSession`, `AgentMessage`, `AgentContentPart`, `AgentEvent`)
  and drop all `Oc*` names from shared code (IMPLEMENTATION_PLAN rule 5).
- Remove provider leakage: `OcSession.location.directory` and `projectID`-as-OpenCode-id become
  `projectId` owned by Homebase; the `provider` field becomes explicit instead of inferred from id shape
  (`ses_…` vs UUID).
- Replace the ~45 OpenCode event names with the normalized 28-event vocabulary. The private pattern of
  `CcEventType = Extract<OcEventType, …>` becomes an adapter-internal mapping, not a shared type.
- Keep the tool four-state idea but express it as `AgentToolCall.status` (`running` / `completed` /
  `failed` / `denied`), and keep the `denied` distinction (private code marks phone-denied tool results;
  the UI depends on it).
- Permissions/forms generalize to `AgentApprovalRequest` (with options/kinds) and `AgentQuestion`
  (single/multi select, text, confirm). The private rich field union (numbers, booleans, external links,
  `when` conditions) is extra capability: if a provider needs it, it should be added to the question
  vocabulary deliberately, not carried as provider plumbing.
- Timestamps standardize on ISO 8601 strings (private code mixes epoch ms and ISO).

**Where it landed:** `packages/protocol` — schemas and inferred types for entities, capabilities,
content, events, errors, and strict Host inputs.

### 2.2 Hub OpenCode client → OpenCode adapter (Phase 2)

**Private source:** `apps/hub/src/adapters/opencode.ts` (325 lines).

**What it does:** The only file that knows OpenCode's HTTP API: Basic auth as `opencode:<password>`,
`location[directory]=` deep-object query encoding, request timeouts, `_tag` error parsing, model/agent/
command catalogs, session list with `parentID=null` and a last-page cursor quirk, messages paging,
prompt with inline data-URL files, model/agent switching, interrupt, diff, inbox, forms/permissions,
`view {idle}`, and an SSE async generator with a minimal parser.

**Why it is valuable:** It encodes verified OpenCode v2.0.6 behavior including drift from its OpenAPI
spec, and it proves the "one file owns all provider knowledge" rule.

**How it must change:** Split into a provider package (`packages/adapter-opencode`, Phase 2):

- transport: URL/auth/error/timeout handling, location encoding, cursor quirks;
- mapper: `Up*` payloads → `AgentSession` / `AgentMessage` / `AgentToolCall` / `AgentEvent`;
- capabilities: declare what OpenCode truly supports (streaming, approvals, questions where available,
  diffs, attachments as inline data URLs, models/agents as modes) and _not_ what it doesn't;
- the git/PowerShell helpers (`branches`, `switchBranch`) move out of the adapter; "run a command on the
  host" is not an agent capability. Host-side git/project features belong to the Host/project layer, not
  an agent adapter.
- events: emit normalized events on the Host bus instead of the private `OcEvent` envelope; the
  `sessionOf` one-level nesting hack disappears because the adapter constructs the envelope itself.
- rejection tracking (`denied` tool results) moves into the adapter as normalization state.

### 2.3 Hub provider routes → provider-neutral Host API

**Private source:** `apps/hub/src/routes/opencode.ts`, `routes/claude.ts`, `routes/extras.ts`.

**What it does:** REST surface with per-route allowlisting, limit clamping (1–100 sessions, 1–200
messages), attachment validation (≤10 files, MIME allowlist, 20 MiB), slash-command name validation,
branch-name shell safety, and contract-shaped responses.

**How it must change:** The new Host API is provider-neutral (`/api/v1/...`) and already implemented for
the Phase 1 subset. Route-level validation policy that is provider-independent (limits, attachment MIME
and size caps, shell-safety rules) will be carried into the relevant routes when those features land.
Provider-specific routes disappear: a single session route set serves all providers, with capabilities
gating behavior via `409 unsupported_capability` instead of parallel route families.

### 2.4 Project discovery → Host project registry

**Private source:** `apps/hub/src/projects/discover.ts`.

**What it does:** Builds the project list as the union of provider-known projects and one-level scans of
configured roots; requires `.git`; filters to the allowlist; verifies existence; computes branch and
last-active metadata; caches for 10 minutes with stale fallback; recomputes "running" from provider
state; bounds concurrency and retries warm-up failures.

**Why it is valuable:** The policy — union discovery, git requirement, TTL cache, stale fallback,
running sort — is exactly what a multi-provider control plane needs, and the private code learned that
provider-known project lists contain deleted directories and that per-location calls can fail while the
server warms up.

**How it must change (architectural):** Project discovery must **not depend on a provider server**.
Private discovery calls OpenCode's FS/VCS APIs, which makes the hub unusable when the agent is down and
couples project identity to OpenCode. The new `apps/host/src/projects/project-registry.ts` scans the
filesystem directly, canonicalizes paths at startup, derives stable ids from canonical paths, reads git
metadata through the local `git` binary (injectable for tests), and never asks a provider where a
project lives. Provider "known projects" are not needed at all: the Host is the source of truth. TTL
refresh and stale marking can return in a later phase if scan cost demands it.

### 2.5 Event hub → global event bus + adapter emission

**Private source:** `apps/hub/src/events.ts`.

**What it does:** One upstream provider event connection, reconnecting with backoff, pausing while the
machine is offline, per-session listener fanout plus a global listener, stream status broadcast, and
durable-sequence de-duplication. It also pairs permission rejections with tool failures to mark denied
tool calls.

**How it must change:** Inverted ownership. The Host bus
(`apps/host/src/events/event-bus.ts`) owns sequencing, buffering, replay, and fanout; adapters emit
normalized events through `AdapterContext.emit`. There is no per-provider upstream connection in the
Host core — each adapter owns its own transport and reconnect logic. Provider-specific pairing logic
(denied tools) belongs to the adapter. This removes the private `sessionOf` nesting hack and gives every
event (including deltas) a durable global sequence, which the private design explicitly lacked.

### 2.6 Claude bridge lifecycle → Claude adapter session controller (Phase 3)

**Private source:** `apps/claude-bridge/src/session.mjs`.

**What it does:** One `claude` process per session with a small state machine: created → running (first
prompt spawns with `--session-id`) → idle (10-minute timer) → resumed (`--resume` after kill). Prompts go
through stdin `stream-json`; model/mode switches restart the process with waiters; interrupt is a stdin
control request (never SIGTERM); approvals are brokered through a stdio MCP server; failures emit
`execution.failed` with the last stderr line, and pending approvals fail with the run.

**Why it is valuable:** This is battle-tested process behavior, including the obscure details (SIGTERM
corrupts sessions; the process never exits while stdin is open; concurrency races on double switches were
fixed and tested).

**How it must change:**

- It becomes internal implementation of `packages/adapter-claude`, not a separately deployed bridge
  service with its own HTTP API. The public side of the adapter is the `AgentAdapter` contract; the
  bridge's bearer-token HTTP hop disappears, which also removes its duplicated allowlist.
- Extract a provider driver interface (argv builder, control channel, frame mapper, history reader,
  approval channel, usage source) so the lifecycle controller is generic and the Claude-specific parts
  are data.
- Fix the known robustness gaps found in the audit: a spawn `error` (ENOENT) must be terminal and must
  emit a failure event; `claude auth status` must actually gate launches so the documented
  `claude_not_logged_in` state exists; status codes must match the contract (409 vs 503 drift).
- Never enable bypass-permission modes; keep the strict MCP configuration (`--strict-mcp-config`) and
  keep "always" rules in memory rather than writing provider settings.

### 2.7 Claude stream mapper → adapter event normalization (Phase 3)

**Private source:** `apps/claude-bridge/src/frames.mjs`.

**What it does:** Pure state machine mapping Claude's `stream-json` frames to messages/parts/events:
merges multiple `assistant` frames sharing a `message.id`; binds `tool_result` by `tool_use_id`;
classifies interrupted runs (`terminal_reason` prefix `aborted_` checked _before_ `is_error`, because
interrupted results still carry `subtype:"success"`); extracts usage and thinking-token counts; never
emits reasoning text because Claude does not deliver it; ignores unknown frames.

**How it must change:** It becomes the Claude adapter's normalizer, emitting `AgentEvent`s. Keep every
quirk and the "ignore unknowns, never throw" philosophy; document version sensitivity in
`docs/compatibility.md`. The `denied` marking stays, driven by the adapter's approval channel.

### 2.8 Claude transcript reader → adapter history (Phase 3)

**Private source:** `apps/claude-bridge/src/transcript.mjs`.

**What it does:** Reads `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` into sessions and messages:
skips unknown/unparseable entries, drops `isSidechain` and `isMeta`, merges assistant entries by id,
attaches tool results, infers interrupted outcomes, synthesizes the idle marker, computes token totals,
lists only sessions from the headless entrypoint that produced a real answer, and hides signed-out
`<synthetic>` models.

**Why it is valuable:** It gives the UI history for sessions Homebase never drove, which is a real
product need.

**How it must change:** It is the highest version-drift risk in the private codebase: it depends on an
internal, changing file format (7+ entry types, some undocumented). Port it behind an adapter-owned
history interface with strict tolerance (never throw, skip unknowns), an explicit
`HOMEBASE_TEST_CLAUDE=1` live check, and a compatibility note. Do not promise transcript fidelity;
map to normalized messages and let unavailable data be absent.

### 2.9 Claude permissions and MCP broker → adapter approvals (Phase 3)

**Private source:** `apps/claude-bridge/src/permissions.mjs`, `src/mcp-approve.mjs`.

**What it does:** Maps tool calls to approval requests with resource extraction per tool (`Bash` →
command, `Edit` → file path, `WebFetch` → URL, ...), wildcard "always" rule matching with
separator-aware boundaries, and turns `AskUserQuestion` into the form model. The stdio MCP server blocks
Claude's permission prompt until the phone answers, denies on bridge failure so Claude never hangs, and
passes `updatedInput` on allow (a pre-2.1.207 requirement).

**How it must change:** The _semantics_ port: approval kinds/options, once vs always (session-scoped
memory only), deny messages reaching the model, deny-on-communication-failure, question mapping to
`AgentQuestion`, and `.always` matching. The MCP stdio glue is Claude-specific and stays inside the
adapter. Question mapping should target the neutral question model; if richer form fields are needed,
they are added to the protocol deliberately.

### 2.10 Provider descriptor (Claude aliases/modes/effort) → adapter metadata

**Private source:** `apps/claude-bridge/src/contract.mjs`, `packages/shared/src/claude.ts`.

**What it does:** Model aliases (`opus`/`sonnet`/`haiku`/`fable`), dated-name folding, modes as
permission modes (`default`→CLI `manual`, excludes bypass modes), effort levels with per-model
exceptions, and display-name formatting.

**How it must change:** Becomes a descriptor object inside `packages/adapter-claude` feeding
`AgentModel` (with `thinkingLevels`) and `AgentMode` lists. No shared code may import Claude constants;
capabilities describe support, and the CLI's `default` vs `manual` naming is adapter-internal.

### 2.11 Web chat UI → provider-neutral PWA (Phase 4)

**Private source:** `apps/web` (76 source files), especially `components/chat/*`, `components/ui/*`,
`lib/{timeline,overlay,cards,forms,smoothText,diff,models,chatScroll}.ts`, `styles/*`.

**What it does and why it is valuable:**

- Components are already **nearly provider-neutral**: provider-coupled types live in `lib/*` and the
  `mock/`, and components consume derived view models (`ViewPart`, `TimelineItem`). This makes the
  refactor a type swap rather than a rewrite.
- The chat experience is the product differentiator: smooth streamed text that trails and catches up,
  folding of completed work into "Worked for N" summaries with the final answer promoted, grouped tool
  rows with denied/failed states, reasoning disclosures, waiting/approval status lines, and elapsed-time
  working indicators.
- Approval and question cards are first-class: queueing, peeking stack, "Always" explanation,
  auto-advance after answering, dismiss behavior, typed validation, and 44px touch targets.
- Composer behavior: per-session drafts, slash commands, attachment caps with model-capability gating,
  image previews, tap-to-queue / hold-to-steer with keyboard equivalents, iOS `visualViewport` keyboard
  handling, and safe-area padding.
- Diff sheet, model/thinking picker with search/favorites/recents, and the token-driven design system are
  all portable.

**How it must change:** Keep the view model and components; refactor the `lib/` layer to consume
`@homebase/protocol` types and one Host client:

- `lib/harness.ts` session-id-shape provider sniffing is deleted (the protocol has an explicit
  `provider` field on sessions/events).
- `lib/overlay.ts` consumes `AgentEvent` (with `sequence` for de-dup) and folds into neutral message
  parts.
- `lib/timeline.ts` consumes `AgentMessage`/`AgentContentPart`; provider tool-label/icon tables become an
  adapter-owned presentation map keyed by capability/tool metadata rather than hard-coded Claude/OpenCode
  names.
- `lib/cards.ts` consumes `AgentApprovalRequest`/`AgentQuestion`.
- `lib/events.ts` connects to the single global `/api/v1/events` stream and tracks `sequence` for
  reconnect; `sync`-refetch is replaced by explicit replay/resync semantics.
- Queue/steer and attachments become capability-gated (they already mostly are, via provider checks that
  should become capabilities).

Do not port the private navigation wholesale (overview/home-pulse, settings) — IMPLEMENTATION_PLAN §14
defines Attention / Projects / Activity / Settings surfaces.

### 2.12 Mock architecture and scenario matrix

**Private source:** `apps/web/src/mock/*`, `HUB_MOCK` mode, shared fixtures' scripted runs.

**What it does:** Scenario switcher (`normal`, `degraded`, `pc-offline`, ...), injected `fetch` and
`EventSource` factories, scripted traced runs that replay events and fold messages so refetch agrees with
the stream, plus fixtures for approvals, forms, diffs, and scale catalogs.

**How it fits now:** The **pattern** ports: deterministic mock adapters, injectable event sources,
traced scenario scripts, and a UI scenario switcher for Phase 4. The private contents do not port
(personal projects, machine states, infra scenarios). The repository's `MockAdapter` in
`@homebase/adapter-sdk/testing` is the provider-side equivalent of the private mock agent; the web
scenario layer will consume neutral protocol fixtures.

### 2.13 Web transport/reconnect behavior

**Private source:** `apps/web/src/lib/{api,events,queries}.ts`.

**What it does:** TanStack Query for server state, a Zustand overlay for live events, reconnect on
`visibilitychange`, refetch on `sync`, stale banners rather than blank screens, and an `ApiError` with
status/code/field.

**How it must change:** Keep the state split and reconnect discipline; replace the API client with one
that speaks `{ error: { code } }` and tracks global event sequences. The private lesson that iOS kills
background streams and clients must resync on resume is a requirement, not a nicety.

### 2.14 Playwright state coverage

**Private source:** `apps/web/e2e/*`, `playwright.config.ts`, `e2e/helpers.ts`.

**What it does:** A mobile device profile (iOS viewport, touch, reduced motion), console-error and
horizontal-overflow helpers, screens × scenarios × themes screenshots, and behavior specs for
permissions, questions, streaming, queue/steer, attachments, reconnect, deleted sessions, and touch
targets.

**How it fits now:** Port the harness and the matrix; write expectations against neutral fixtures. The
state list in IMPLEMENTATION_PLAN §20.5 is essentially the private matrix minus homelab scenarios.

---

## 3. Do not port

### 3.1 Private infrastructure and monitoring (out of scope)

- `apps/pc-agent` — Windows-only PC stats (CPU/RAM/GPU/registry quirks), Wake-on-LAN-adjacent reachability,
  and provider **usage endpoints that read saved credentials** (`auth.json`, an OpenCode SQLite login
  database) and call undocumented vendor usage endpoints. Reading saved OAuth tokens is exactly what
  IMPLEMENTATION_PLAN §13 forbids in the core; usage must come from documented provider output (for
  example Claude's `rate_limit_event`).
- Hub `src/stats/*`, `src/adapters/{systemd,docker,kuma,pcAgent,journal}.ts`, `src/pc/*`, `src/alerts/*`
  (ntfy), `src/health.ts` homelab checks, `routes/extras.ts` (clone/folder via agent shell, journal,
  PC stats), Wake-on-LAN, Uptime Kuma, Docker/systemd dashboards, healthchecks.io heartbeat.
- `packages/shared/src/{system,docker,kuma,pc,health,extras,projects}.ts` — the corresponding
  contracts.
- Web `components/overview/*`, `routes/overview.tsx` homelab surfaces, PC gates and machine links, the
  Go/Codex/Claude plan-usage cards (subscription-specific), clone/new-folder flows, logs sheet.

None of these belong to the AI development control plane.

### 3.2 Deployment and environment specifics

- The private deploy directories (a Linux host's systemd units and Docker Compose for Uptime Kuma and a
  Docker socket proxy, plus Windows install scripts): firewall rules, install scripts, and an
  `.env.example` with real remote-network hostnames,
  LAN/MAC values, personal project roots, and an ntfy topic. None of these values may appear here; the
  public repository ships a generic `homebase.config.json` story instead of a private env file.
- Private port choices and provider-bridge env naming — the public
  Host uses one configurable port and per-provider config sections.
- The private trust model (loopback + Tailscale, no hub auth) — the public Host enforces an auth
  invariant now and adds pairing in Phase 5. Tailscale remains the recommended _remote-access_ path per
  the plan, not a substitute for authentication.

### 3.3 Personal data and fixtures

- Machine names, hostnames, tailnet/LAN IPs, MAC addresses, personal GitHub org/repo URLs, personal
  filesystem paths, personal project and session titles, monitor/service names, ntfy topics, and the
  owner's name in comments/docs/tests appear throughout the private fixtures, hub/web/bridge tests, dev
  galleries, and docs. None of this may be copied. Where the _behavior_ matters (Windows path encoding,
  stream fixtures), re-create fixtures with synthetic values.
- The two scrubbed Claude stream captures are technically reusable, but must be re-audited (ids, paths,
  titles) before being copied, per IMPLEMENTATION_PLAN §20.3.
- The vendored OpenCode OpenAPI dump: do not vendor until its redistribution/licensing is verified;
  adapter tests should use hand-authored fixtures.

### 3.4 Brittle or dishonest behavior

- Session-id-shape provider detection (`ses_…` vs UUID) — replaced by an explicit provider field.
- Contract drift and dead routes (documented routes that are not implemented, status codes that do not
  match behavior, a `claude_not_logged_in` state documented but never produced). Do not carry the drift;
  either implement or remove.
- Any bypass-permission or `dontAsk` modes in product UI; the private bridge already excludes them and
  the public adapters must too.
- Internal provider formats treated as stable APIs: the Claude transcript format and OpenCode's
  provider-specific shell/git workflows. Use documented interfaces first; keep compatibility bridges
  isolated and version-aware (IMPLEMENTATION_PLAN §2.3).

---

## 4. Where each reuse area landed (or will land)

| Private area                                                 | Public destination                                      | Status                                  |
| ------------------------------------------------------------ | ------------------------------------------------------- | --------------------------------------- |
| Path normalization/allowlist                                 | `apps/host/src/paths.ts`                                | Ported (platform-aware, tested)         |
| Constant-time auth + throttling                              | `apps/host/src/auth/auth.ts`                            | Ported; pairing replaces it in Phase 5  |
| SSE framing/keepalive/replay                                 | `apps/host/src/api/sse.ts`, `src/events/event-bus.ts`   | Ported with global sequences + resync   |
| Hono skeleton/security headers                               | `apps/host/src/api/app.ts`                              | Ported                                  |
| Error normalization                                          | `@homebase/protocol` errors + `apps/host/src/errors.ts` | Ported with stable codes                |
| Config validation                                            | `apps/host/src/config/config.ts`                        | Ported with security invariants         |
| `Oc*` canonical model                                        | `packages/protocol/*`                                   | Ported as `Agent*`, renamed/neutralized |
| Adapter contract & compliance                                | `packages/adapter-sdk/*`                                | New; mock adapter runs the suite        |
| OpenCode client/routes                                       | `packages/adapter-opencode`                             | Phase 2                                 |
| Claude bridge (lifecycle/mapper/transcript/permissions)      | `packages/adapter-claude`                               | Phase 3                                 |
| Web chat components + view model                             | `apps/web`                                              | Phase 4, type swap in `lib/`            |
| Web mock/scenario architecture                               | `apps/web/src/mock` + protocol fixtures                 | Phase 4                                 |
| Playwright harness + matrix                                  | `apps/web/e2e`                                          | Phase 4                                 |
| Design tokens/a11y tests                                     | `apps/web/src/styles`                                   | Phase 4                                 |
| Homelab features, PC agent, deploy scripts, private fixtures | —                                                       | Not ported                              |
