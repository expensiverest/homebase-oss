# Homebase architecture

> **Status:** Phases 0-4 implemented: protocol, adapter SDK, Host core, OpenCode and Claude Code adapters,
> and the Phase 4 mobile web client. This document describes what exists in the repository today and the
> intended end-state from [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md).

## Overview

Homebase is a local-first, mobile-first control plane for AI coding agents running on the user's own
computer. The Host runs on the development machine; the PWA runs on the phone and never talks to a
provider process directly.

```text
┌──────────────────────────────────────────────┐
│                Homebase PWA                  │
│   Attention · Projects · Activity · Settings │
└──────────────────────┬───────────────────────┘
                       │  REST + SSE (global event stream)
                       ▼
┌──────────────────────────────────────────────┐
│              Homebase Host (Node 22+)        │
│                                              │
│  config · project registry · provider registry │
│  session routing · normalized event bus       │
│  SSE sequencing/replay · auth · diagnostics   │
└──────┬──────────┬──────────┬─────────────────┘
       │          │          │
       ▼          ▼          ▼
   adapter-*  adapter-*  adapter-*   (implement AgentAdapter)
       │          │          │
       ▼          ▼          ▼
   OpenCode    Claude      ACP / JSON-RPC / HTTP
```

The dependency direction is always:

```text
Homebase UI → normalized protocol → adapter contract → provider adapter → provider-native protocol
```

Shared code (Host logic and UI) branches on **capabilities**, never on provider identity.

## Workspace layout

```text
apps/
  host/        @homebase/host        Node HTTP/SSE control plane
  web/         @homebase/web         React/Vite PWA (Phase 4)
packages/
  protocol/    @homebase/protocol    provider-neutral entities, events, capabilities, errors
  adapter-sdk/ @homebase/adapter-sdk adapter contract, compliance suite, identity helpers, test utilities
  adapter-opencode/                  OpenCode reference adapter (native HTTP + SSE)
  adapter-claude/                    Claude Code adapter (structured CLI subprocess)
docs/
```

The web client speaks only to the Host. Grok/Gemini (ACP) and later providers are added in their phases.

## Packages

### `@homebase/protocol`

The foundation. Provider-neutral Zod schemas and inferred TypeScript types for:

- providers, projects, sessions, models, modes, thinking levels (`src/entities.ts`)
- message content parts: text, reasoning, image, file, tool call, plan, status, error (`src/content.ts`)
- approvals, questions, diffs, usage (`src/content.ts`)
- capabilities (`src/capabilities.ts`)
- the normalized event vocabulary (`src/events.ts`)
- stable error codes and the API error envelope (`src/errors.ts`)
- strict client inputs with no path fields (`src/inputs.ts`)

Rules:

- No `Oc*` names, no provider payload shapes, no transcript formats.
- Everything must be JSON-serializable.
- Unsupported capabilities stay unsupported; adapters must not fake parity.

### `@homebase/adapter-sdk`

- `AgentAdapter` — the contract every provider implements (`src/adapter.ts`).
- `AdapterContext` — the only environment adapters see: host version, validated per-provider config,
  logger, `resolveProjectPath` (canonical, allowlisted), and `emit` (the normalized event sink).
- `AdapterError` + `toAgentError` — provider-neutral failure normalization (`src/errors.ts`).
- `createConsoleLogger` / `redactSecrets` — logging with best-effort credential redaction
  (`src/logger.ts`).
- `defineAdapterComplianceSuite` — a capability-aware Vitest suite every adapter runs
  (`src/compliance.ts`).
- `@homebase/adapter-sdk/testing` — `createTestAdapterContext` and the deterministic `MockAdapter`.

## Host

`apps/host` is the Phase 1 control plane. It wires:

| Module                                | Responsibility                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/config/config.ts`                | JSON file + env loading, Zod validation, security invariants, secret-free summaries                            |
| `src/paths.ts`                        | `PathAllowlist`: realpath canonicalization, containment checks, loopback detection                             |
| `src/projects/project-registry.ts`    | Filesystem discovery of git repositories under configured roots, stable project ids, canonical path resolution |
| `src/providers/provider-registry.ts`  | Adapter registration, initialization, detection, capabilities, availability, capability assertions             |
| `src/events/event-bus.ts`             | Global monotonic sequence numbers, bounded replay buffer, fanout                                               |
| `src/sessions/session-service.ts`     | Session routing to adapters, in-memory index, pending approval/question routing                                |
| `src/auth/auth.ts`                    | Dev-token authentication with constant-time comparison and failure throttling                                  |
| `src/attachments/attachment-store.ts` | Ephemeral Host-owned attachment bytes (upload, TTL/LRU, MIME and magic-byte checks)                            |
| `src/api/app.ts`                      | REST API, stable errors, auth middleware, body limits, no-store, catalogs, attachments                         |
| `src/api/sse.ts`                      | `GET /api/v1/events`: replay via `Last-Event-ID`/`?since=`, `ready`/`resync` control events                    |
| `src/api/app.ts` (actions/refresh)    | `GET /api/v1/sessions/:id/actions` pending read model; `POST /api/v1/providers/refresh` re-detects providers   |
| `src/static.ts`                       | Serves the built web client with SPA fallback, cache policy, and traversal protection                          |
| `src/server.ts`                       | Runtime wiring; `createDefaultRegistrations()` provides the mock and OpenCode providers                        |

### Request and event flow

1. The client calls REST (`POST /api/v1/sessions`, `POST /api/v1/sessions/:id/messages`, approvals,
   questions, model/mode changes).
2. The Host resolves the project id to a canonical, allowlisted path and passes the `AgentProject` to the
   adapter.
3. The adapter talks to the provider (HTTP, SSE, stdio, JSON-RPC, ...) and emits normalized events
   through `AdapterContext.emit`.
4. `EventBus` stamps a global sequence and fans out.
5. `GET /api/v1/events` streams events with `id: <sequence>`; reconnecting clients send
   `Last-Event-ID` and receive the buffered window. When the requested point has been dropped, the Host
   sends `resync` so the client refetches instead of pretending to catch up.
6. `SessionService` mirrors `session.*` and `turn.*` events into its index and routes pending
   approvals/questions back to the right adapter by request id.

### Capability gating

`ProviderRegistry.requireCapability(providerId, key)` is the single gate for optional operations. Routes
that hit an unsupported capability fail with `409 unsupported_capability` and a stable error code rather
than emulating the feature. The mock adapter deliberately declares `slashCommands: false` so the
unsupported path is exercised in tests.

## Security-relevant design decisions

- **Bind**: default `127.0.0.1`; a non-loopback bind with `auth.mode = "none"` refuses to start.
- **Projects**: clients can only send project ids. `AgentProject.path` is produced by the Host registry
  and re-canonicalized before use. Unknown keys in input schemas are rejected, including `path`.
- **Credentials**: provider config is passed to adapters server-side only; it is never returned by the
  API and never logged by the Host.
- **Caching**: all `/api/*` responses are `cache-control: no-store`.
- **Limits**: request bodies are capped (1 MiB at the API layer); prompt text and attachment counts have
  schema limits.
- **Auth**: Phase 1 offers `none` (loopback-only deployments) and `dev-token`; Phase 5 adds pairing with
  revocable per-device credentials as required by the plan.

See [security.md](security.md) and [threat-model.md](threat-model.md).

## Deliberate deviations from the plan text

The plan is the authority; where implementation refined it, the change is recorded in the plan's revision
log and here:

1. **Adapter event delivery is `context.emit`.** The plan's §9 sketch shows
   `adapter.subscribe(handler)`. The final contract inverts it: the Host owns sequencing and fanout, and
   adapters emit into a Host-provided sink. This removes duplicated listener plumbing from every adapter.
2. **Adapter methods receive `AgentProject`.** `listSessions`/`createSession`/`listModels`/`listModes`
   take the project record (or rely on `resolveProjectPath`/`findProjectByPath` for session-scoped
   operations), so adapters never resolve paths themselves.
3. **`AgentSession.state` includes `unknown`.** Transcript-backed providers cannot always report the run
   state of a persisted session; `unknown` prevents lying with a stale `idle`/`working` state.
4. **The mock adapter is SDK test tooling.** It lives in `@homebase/adapter-sdk/testing` so the compliance
   suite, Host tests, and future adapter authors share one reference implementation; the Host registers
   it by default and it can be disabled with `providers.mock.enabled = false`.
5. **Every event is sequenced, not only durable ones.** The plan asks for global monotonic sequencing;
   applying it to deltas as well makes reconnect replay uniform.
6. **History and queue are first-class contract members (Phase 2).** `listMessages` and `queue` were
   added when the first real adapter exposed the gaps; session listing became page-based because the
   OpenCode server is naturally cursor-paginated.
7. **`message.updated` exists.** Tool parts appear mid-turn, and text deltas alone cannot announce new
   parts; the snapshot event keeps clients coherent without provider-specific event names.
8. **Attachments are Host-owned bytes.** `POST /api/v1/attachments` + `AdapterContext.resolveAttachment`
   replaced any notion of adapters reading client paths; storage is in-memory with TTL/LRU cleanup.
9. **Public ids are provider-scoped (Phase 3).** Sessions, approvals, and questions use
   `hb1~<provider>~<base64url(native)>`; the Host routes deterministically and no longer probes
   adapters to discover session ownership. Native ids never cross the adapter boundary.
10. **Claude Code runs as a direct child process (Phase 3).** No HTTP bridge: the adapter spawns the
    user's `claude` CLI with stream-json, uses control requests for interrupt/model/mode, and keeps a
    loopback-only approval channel for the MCP permission-prompt tool. Credentials stay with the CLI.

## Web client (Phase 4)

`apps/web` is a provider-neutral React 19 PWA. It holds server state in TanStack Query, reducer state for the
global live overlay in Zustand, and one fetch-based SSE connection (`GET /api/v1/events`) that reconnects with
`?since=<sequence>`, handles `ready`/`resync`, and reconnects on `visibilitychange`. Events invalidate queries;
they are never applied twice because every event carries a global sequence.

The Host serves the production build from `apps/web/dist` (`src/static.ts`): `/api/*` stays API, hashed assets
are immutable, the shell revalidates, deep links fall back to `index.html`, and the service worker caches only
app-shell assets, never `/api/*`. See [web-client.md](web-client.md) for the full client architecture, mock
scenarios, and PWA caching policy.

## Current status

| Phase                                          | Status                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0 — Repository and specification foundation    | Complete                                                                                       |
| 1 — Host core                                  | Implemented (config, registries, bus, SSE, REST, auth placeholder, health)                     |
| 2 — OpenCode reference adapter                 | Complete (protocol/SDK corrections, Host attachments/catalogs/history, adapter + live checks)  |
| 3 — Claude adapter and multi-provider identity | Complete (provider-scoped ids, deterministic routing, Claude adapter + fake CLI/live suites)   |
| 4 — PWA (mobile web client)                    | Complete (Projects/Sessions/Chat, global event client, capabilities, mock E2E, static serving) |
| 5 — Security and pairing                       | Planned (auth placeholder exists)                                                              |
