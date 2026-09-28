# Homebase protocol

> Source of truth: `packages/protocol`. This document explains the model and the rules; the Zod schemas
> are the executable specification.

## Versioning

- `HOMEBASE_PROTOCOL_VERSION` — normalized protocol version (currently `1`).
- `HOMEBASE_API_VERSION` — HTTP route prefix version (`v1`).

Adapters are expected to declare compatibility against the protocol version; a mismatch is a detection
failure, not a silent downgrade.

## Identifiers

All ids are opaque strings owned by the Host or the adapter. `providerId` is a lowercase slug
(`opencode`, `claude`, `grok`, `gemini`, `codex`, `copilot`, `mock`). Clients must never interpret ids as
paths or derive provider behavior from their shape.

## Entities

| Type                             | Purpose                                    | Notable fields                                                                                          |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `AgentProvider`                  | A registered provider and its state        | `installed`, `authenticated` (`boolean \| null` for "unknown"), `compatible`, `capabilities`, `warning` |
| `AgentProject`                   | A Homebase-owned project                   | `path` is always Host-canonical; `providersAvailable` is computed by the Host                           |
| `AgentSession`                   | A session with one provider                | `provider`, `projectId`, `state`, `model`, `mode`, `thinkingLevel`                                      |
| `AgentModel`                     | A selectable model                         | `thinkingLevels`, `defaultThinkingLevel`, context/output limits, per-model `inputCapabilities`          |
| `AgentModelRef`                  | Model selection for a session              | `provider`, `modelId`, `thinkingLevel`                                                                  |
| `AgentMode`                      | A selectable mode (for example plan/agent) | `id`, `name`, `description`                                                                             |
| `AgentMessage`                   | One user/assistant/system message          | `state` (`streaming`/`completed`/`failed`/`interrupted`), `parts`                                       |
| `AgentToolCall`                  | A tool invocation                          | `status` (`running`/`completed`/`failed`/`denied`), `input`, `output`, `error`                          |
| `AgentApprovalRequest`           | A pending approval                         | `kind`, `title`, `detail`, `options[]` with `allow_once`/`allow_always`/`deny`/`custom`                 |
| `AgentQuestionRequest`           | A pending structured question              | `questions[]` with `single_select`/`multi_select`/`text`/`confirm`                                      |
| `AgentDiff` / `AgentDiffSummary` | File changes                               | `files[]` with status and line counts, optional patch                                                   |
| `AgentUsage`                     | Usage windows                              | `windows[]` with unit (`percent`/`tokens`/`requests`/`usd`/`minutes`)                                   |

### Session states

`idle | working | waiting | failed | completed | unknown`

`unknown` exists because transcript-backed providers cannot always report the run state of a persisted
session at startup. Shared UI treats `unknown` as "no active claim" rather than showing a stale
"Working".

### Message content parts

Every part has a stable `id` so streaming deltas can address it:

- `text` — streamed with `message.delta`
- `reasoning` — streamed with `reasoning.*` events; providers without reasoning text simply never emit it
- `image` / `file` — reference an attachment id when the Host owns the bytes; `attachmentId` may be
  absent for provider-historical references, in which case clients render metadata only
- `tool_call` — wraps a full `AgentToolCall` snapshot
- `plan` — structured plan steps
- `status` — progress/status line
- `error` — normalized error content

## Capabilities

`AgentCapabilities` is the single feature-difference mechanism. Keys:

`resume`, `deleteSession`, `streaming`, `interrupt`, `steer`, `queue`, `models`, `modelSwitching`,
`thinkingLevels`, `modes`, `attachments`, `imageInput`, `tools`, `approvals`, `questions`, `plans`,
`diffs`, `usage`, `slashCommands`.

Rules:

1. Adapters declare capabilities honestly; a capability that is `true` must work end to end.
2. Shared Host/UI code branches on capabilities, never on provider identity.
3. Optional adapter methods may be absent when the capability is `false`; the Host returns
   `unsupported_capability` instead of emulating behavior.
4. Provider-specific UI is allowed only for concepts that are genuinely provider-specific and not
   expressible as a capability.

Helpers: `defineCapabilities(partial)` (everything omitted is explicitly `false`), `supports(...)`,
`enabledCapabilities(...)`.

## Normalized events

Every adapter emits from this vocabulary:

```text
provider.connected | provider.disconnected | provider.updated
session.created | session.updated | session.deleted
turn.started | turn.completed | turn.failed | turn.interrupted
message.started | message.updated | message.delta | message.completed
reasoning.started | reasoning.delta | reasoning.completed
tool.started | tool.updated | tool.completed | tool.failed
approval.requested | approval.resolved
question.requested | question.resolved
plan.updated | diff.updated | usage.updated
provider.event   (escape hatch; native payload, rarely consumed by UI)
```

Envelope (adapter-emitted):

```json
{
  "type": "tool.started",
  "provider": "opencode",
  "projectId": "prj_ab12cd34ef56",
  "sessionId": "ses_...",
  "occurredAt": "2026-01-01T00:00:00.000Z",
  "data": { "toolCall": { "id": "tool_1", "name": "shell", "status": "running" } }
}
```

`occurredAt` is optional on adapter events; the Host stamps host time when publishing.

### Semantics

- `message.started` carries the full message skeleton. `message.updated` carries a full snapshot when
  parts change without a pure text append (for example a tool part appearing mid-turn); clients upsert
  by message id. `message.delta` appends text to the addressed `partId`; deltas for unknown parts should
  be ignored by clients. `message.completed` carries the final message snapshot and is authoritative.
- `tool.*` events carry full `AgentToolCall` snapshots; clients replace by tool id. `tool.failed` with
  `status: "denied"` is a user rejection, not a provider error.
- `turn.started`/`turn.completed`/`turn.interrupted`/`turn.failed` define the run lifecycle;
  `turn.failed` carries a normalized `AgentError`.
- Sessions should settle out of `working` on a terminal turn event; adapters must not leave a session
  permanently "working" after a process/transport failure.
- `provider.event` is an explicit escape hatch for data that has no normalized representation yet. Shared
  UI must not depend on it.

### Host sequencing and SSE

The Host assigns a global, monotonically increasing `sequence` and an `id` to every published event:

```json
{ "id": "evt_19242", "sequence": 19242, "type": "...", "provider": "...", "data": {} }
```

`GET /api/v1/events` streams `text/event-stream` with `id: <sequence>` and `event: <type>`. Reconnect:

- send `Last-Event-ID: <sequence>` (or `?since=<sequence>`) to replay buffered events;
- a `ready` event announces `{ latestSequence, protocolVersion }` on connect;
- if the requested point is older than the replay buffer, the Host sends `resync` with
  `{ droppedBefore, latestSequence }` and the client must refetch state instead of assuming continuity;
- `: heartbeat` comments arrive every 15 seconds.

Clients must treat the stream as resumable, not permanent: iOS suspends background connections.

## Pagination

List operations that can grow unbounded use an opaque page shape:

```ts
interface PageRequest {
  cursor?: string | null;
  limit?: number | null;
}
interface AgentPage<T> {
  items: T[];
  nextCursor: string | null;
  previousCursor: string | null;
}
```

Rules:

- Cursors are opaque strings owned by the adapter; clients round-trip them untouched.
- `listSessions(project, page?)` and `listMessages(sessionId, page?)` return pages.
- Items keep provider order across pages; both default to newest-first, so `nextCursor` walks into
  older history (`previousCursor` is only meaningful for single-provider listings and is `null` in the
  Host's merged session view).
- The Host clamps limits (sessions 1–100 default 50; messages 1–200 default 50) before calling
  adapters, and merges multi-provider session pages behind one Host-owned cursor.
- Historical messages fetched through `listMessages` are authoritative when reopening a session; live
  events are the incremental overlay.

## Attachments

Bytes never travel through the protocol. The flow is:

1. `POST /api/v1/attachments` (multipart) uploads bytes to the Host-owned store and returns
   `AgentAttachmentRef[]` (`id`, `kind`, `name`, `mimeType`, `sizeBytes`).
2. Clients reference refs by id in `SendMessageInput.attachments`.
3. Adapters resolve ids through `AdapterContext.resolveAttachment(id)`, which yields Host-owned bytes
   only — never a filesystem path.
4. `GET /api/v1/attachments/:id` serves the bytes back for rendering (authenticated, `no-store`).

Host storage is ephemeral: bounded per file (20 MiB), per upload (10 files), and per store
(64 MiB LRU), with a 6-hour TTL; nothing is written to disk.

## Host inputs (strict)

`CreateSessionInput`, `SendMessageInput`, `ApprovalResult`, `QuestionAnswer`, `SetModelInput`,
`SetModeInput` are `strictObject`s: unknown fields are rejected. There is deliberately no `path`, `cwd`,
or `directory` field anywhere. Working directories are resolved by the Host project registry; clients can
only reference `projectId`.

## Errors

Adapter errors are normalized to:

```json
{ "code": "provider_unavailable", "message": "...", "provider": "claude", "retryable": true }
```

API failures use the stable envelope:

```json
{ "error": { "code": "project_not_allowed", "message": "...", "details": null, "requestId": "..." } }
```

Codes are shared between adapters and the API (`agentErrorCodeSchema`), so the client never parses
provider-native errors.

## Extending the protocol

1. Prefer a capability + existing concept over a new event where possible.
2. New events require: schema, sample in `packages/protocol/test/protocol.test.ts`, documentation here,
   and a plan revision entry if they change architecture.
3. Never add provider-native names or payloads to this package. Use `provider.event` inside the adapter
   if a provider concept genuinely has no normalized home yet.
