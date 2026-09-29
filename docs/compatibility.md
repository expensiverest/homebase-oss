# Provider compatibility

> Policy: IMPLEMENTATION_PLAN §23. If an installed provider is newer than the latest tested version,
> warn rather than hard-fail unless a known incompatibility exists.

## Matrix

| Provider           | Integration                          | Minimum    | Latest tested | Status                       |
| ------------------ | ------------------------------------ | ---------- | ------------- | ---------------------------- |
| Mock (built-in)    | In-memory adapter                    | 0.0.1-mock | 0.0.1-mock    | Stable (development fixture) |
| OpenCode           | Native server HTTP + SSE adapter     | 2.x        | **2.0.18**    | Beta                         |
| Claude Code        | Structured CLI compatibility adapter | 2.1.x      | **2.1.268**   | Beta                         |
| Grok Build         | ACP v1 stdio transport               | 1.0.x      | **1.0.41**    | Beta                         |
| Gemini CLI         | ACP transport                        | TBD        | TBD           | Planned (Phase 7)            |
| Codex CLI          | Application-server protocol          | TBD        | TBD           | Planned (Phase 10)           |
| GitHub Copilot CLI | Official SDK / structured interface  | TBD        | TBD           | Planned (Phase 10)           |

Verification labels used below:

- **Live** — exercised against the real CLI on a real machine.
- **Fixture** — exercised against the deterministic fake agent in the repo (no provider, no network, no quota).

## OpenCode

### Tested against

- **OpenCode 2.0.18** (server API `GET /api/*`, spec `GET /openapi.json`: "opencode HttpApi",
  version 0.0.1). Live verification on Windows 11 with the user's own CLI authentication.
- API family: the experimental HttpApi surface used by the OpenCode 2.x server. Endpoints are
  **not** the same as the `opencode serve` documentation that targets a different major; the adapter
  was built from the installed server's own OpenAPI document plus live captures.

### Server modes and lifecycle (Phase 5.5)

Homebase no longer requires the user to keep `opencode serve` running in another terminal.

| `serverMode`     | Behavior                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `auto` (default) | Use a healthy configured server; otherwise detect the OpenCode CLI and start a Homebase-owned dedicated server. |
| `external`       | Never spawn OpenCode; use the configured `baseUrl`/`username`/`password` exactly as before.                     |
| `managed`        | Require the CLI and always start a Homebase-owned dedicated server.                                             |

Managed server rules:

- Command: `opencode serve --hostname 127.0.0.1 --port <managedPort>` with `managedPort: 0` by default. With
  `--port 0` the current OpenCode 2.x server binds an OS-assigned ephemeral port and prints
  `server listening on http://127.0.0.1:<port>`; Homebase learns the port from that line (source-verified, labeled
  **fixture + source**, not live).
- Authentication: Homebase generates a random 256-bit, in-memory-only password and passes it through
  `OPENCODE_PASSWORD` (with `OPENCODE_SERVER_PASSWORD` for compatibility). It is never logged, persisted, returned
  to a client, or exposed through Tailscale.
- Readiness: Homebase polls `/api/info` with the generated credentials until 200, treating 503 as "starting"; a
  bounded startup timeout and early-exit diagnostics (including port-in-use) produce a clear warning instead of a
  generic failure.
- Shutdown: only the child Homebase spawned is stopped (stdin EOF → SIGTERM → SIGKILL). Homebase never reads,
  edits, restarts, or kills the user's shared OpenCode service and never touches service files, daemon passwords,
  CORS, or ports.
- Recovery: a failed managed start is cached so reconnect loops cannot cause restart storms; an explicit provider
  refresh (or `POST /api/v1/providers/refresh`) makes one bounded new attempt.

### Detection states

| State                               | `installed` | `authenticated` | `compatible` | Warning                                     |
| ----------------------------------- | ----------- | --------------- | ------------ | ------------------------------------------- |
| Server reachable + compatible       | true        | true            | true         | —                                           |
| Server reachable, newer than tested | true        | true            | true         | "newer than the tested …"                   |
| Server reachable, auth rejected     | true        | false           | true         | credentials rejected / password missing     |
| External server unreachable         | false       | null            | false        | names the configured `baseUrl`              |
| CLI missing                         | false       | null            | false        | CLI not on PATH + baseUrl hint              |
| CLI v1 (API mismatch)               | true        | null            | false        | "predates the supported 2.x server API"     |
| CLI installed, managed start failed | true        | null            | false        | reason (port in use, exited early, timeout) |

### Configuration

```json
{
  "providers": {
    "opencode": {
      "enabled": true,
      "config": {
        "serverMode": "auto",
        "baseUrl": "http://127.0.0.1:4096",
        "username": "opencode",
        "password": "…",
        "executable": "opencode",
        "managedPort": 0,
        "startupTimeoutMs": 20000,
        "shutdownTimeoutMs": 4000,
        "requestTimeoutMs": 15000
      }
    }
  }
}
```

- `serverMode` — `auto` (default), `external`, or `managed` (see above).
- `baseUrl` — OpenCode server endpoint for `external` mode; default `http://127.0.0.1:4096`.
- `password` — optional HTTP Basic auth (`OPENCODE_SERVER_PASSWORD` on the server side). The adapter
  sends no `Authorization` header when unset, so local servers without auth work unchanged. Managed mode generates
  its own password instead.
- `executable` / `managedPort` / `startupTimeoutMs` / `shutdownTimeoutMs` — managed-server controls. `managedPort: 0`
  asks OpenCode for an OS-assigned port; a fixed port reports a clear conflict warning instead of killing anything.
- The password stays in Host configuration (or memory in managed mode); it is never logged and never returned by `detect()`.

**Migration note:** existing explicit `baseUrl`/`username`/`password` configurations keep working. With the new
default `serverMode: "auto"`, an unreachable configured server now falls back to a Homebase-managed server when the
CLI is installed. Set `serverMode: "external"` to preserve the old never-spawn behavior exactly.

### Authentication behavior

| Server state                                        | Detection result                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| Reachable, no auth required                         | `installed: true`, `authenticated: true`                                |
| Reachable, auth required, correct credentials       | `installed: true`, `authenticated: true`                                |
| Reachable, auth required, missing/wrong credentials | `installed: true`, `authenticated: false`, actionable warning           |
| Unreachable                                         | `installed: false`, `compatible: false`, warning with the base URL hint |
| Version < 2.x                                       | `compatible: false`                                                     |
| Version newer than tested                           | `compatible: true`, warning (warn, do not fail)                         |

### Capability matrix (as declared by the adapter)

| Capability               | Supported  | Notes                                                                            |
| ------------------------ | ---------- | -------------------------------------------------------------------------------- |
| streaming                | ✅         | `session.text.*`, `session.reasoning.*` deltas; full text on `ended`             |
| interrupt                | ✅         | `POST /api/session/:id/interrupt`, returns `{ interrupted }`                     |
| steer                    | ✅         | `prompt` with `delivery: "steer"` while a run is active                          |
| queue                    | ✅         | `prompt` with `delivery: "queue"`; parked until the current execution ends       |
| resume                   | ✅         | sessions persist server-side; list/get/create + continue by id                   |
| deleteSession            | ✅         | `DELETE /api/session/:id`                                                        |
| models / modelSwitching  | ✅         | `/api/model`, `session/:id/model`                                                |
| thinkingLevels           | ✅         | model `variants` map to thinking levels; per-model availability                  |
| modes                    | ✅         | primary, non-hidden agents (`build`, `plan`, …)                                  |
| attachments / imageInput | ✅         | prompt `files` with `data:` URLs built from Host attachments                     |
| tools                    | ✅         | `session.tool.*` → running/completed/failed/denied                               |
| approvals                | ✅         | `permission.asked`/`replied` plus pending-list reconciliation                    |
| questions                | ✅         | `form.created`/`replied`/`cancelled` plus pending-list reconciliation            |
| diffs                    | ✅         | `GET /api/session/:id/diff`; project-relative paths                              |
| plans                    | ❌         | no structured plan object in the 2.x API; plan mode is text                      |
| usage                    | ❌         | no documented provider-level usage windows; session tokens/cost stay on messages |
| slashCommands            | ⏸ deferred | command catalog/execution is not yet a neutral contract (Phase 2 Option A)       |

### Known quirks preserved

- The first `/api/model` call per location can return an empty catalog while plugins settle; the
  adapter retries once.
- The global `/api/event` stream carries events for every session and location; the adapter scopes
  them to sessions inside configured project roots and drops everything else.
- Session/message listing returns a `next` cursor on short (final) pages; the adapter normalizes a
  short page to `nextCursor: null`.
- `session.execution.*` (not `session.step.*`) is the turn lifecycle; a run can contain several
  assistant messages (steps), so `session.updated` state changes settle on execution events.
- `session.tool.input.started` → `input.ended` → `called` → `success|failed`; `tool.failed` does not
  necessarily mean user denial. Rejections are tracked from `permission.replied` and surfaced as
  `status: "denied"`.
- Interrupted runs produce `session.step.failed` (`error.type: "aborted"`) and then
  `session.execution.interrupted`; the partial assistant message is kept.
- Attachments are sent as `{ uri: "data:<mime>;base64,…", name }`; model input support varies per
  model (`capabilities.input` includes values like `text`, `image`, `pdf`).
- `session.instructions.updated`, `model.updated`, `provider.updated`, `project.updated`, and
  `models-dev.refreshed` are global/catalog events the adapter intentionally ignores.

### Historical donor behavior that no longer applies

| Donor observation                                       | Current status (2.0.18)                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/info` warm-up failures on first call per location | Still possible for `/api/model` (empty catalog), not for `/api/info`; adapter retries the catalog once                                                                                                                                                                                                                                                |
| `next` cursor on the last page                          | Still returned; adapter normalizes short pages                                                                                                                                                                                                                                                                                                        |
| Session list needs `parentID=null` to hide subagents    | Still true; adapter also filters `parentID` defensively. A child session is still fetchable by id and is exposed with `parentSessionId`; the `task` tool's `metadata.sessionId` becomes `AgentToolCall.childSessionId` (history path covered by tests; the live-event field is read defensively and **not yet verified against a live OpenCode run**) |
| `location[directory]=` deep-object scoping for catalogs | Unchanged for `/api/model`, `/api/agent`, `/api/command`; `/api/session` uses a plain `directory` parameter                                                                                                                                                                                                                                           |
| `_tag` error bodies                                     | Unchanged (`SessionNotFoundError`, `PermissionNotFoundError`, …)                                                                                                                                                                                                                                                                                      |
| `delivery: "steer"` is the default for plain prompts    | Unchanged; the adapter only sends `delivery` explicitly when steering or queueing                                                                                                                                                                                                                                                                     |
| Reasoning text may be present                           | Yes (model-dependent; e.g. reasoning-capable models stream `reasoning_content`)                                                                                                                                                                                                                                                                       |
| Form fields use `q0…` keys with options + `custom`      | Unchanged and verified live                                                                                                                                                                                                                                                                                                                           |

### Live tests

```bash
HOMEBASE_TEST_OPENCODE=1 \
HOMEBASE_TEST_OPENCODE_URL=http://127.0.0.1:4096 \
HOMEBASE_TEST_OPENCODE_PASSWORD=... \
npm test -w @homebase/adapter-opencode
```

Covered live: detection/version, model and mode catalogs, session create/list/get/delete, streaming
turns, history reload, resume, interrupt, and diff retrieval after a write. Approval, question,
queue/steer, and attachment flows are covered by unit/fixture tests and reconciliation paths; the
test machine's permission configuration auto-approves tools, so live approval prompts are not
triggered by default (do not weaken a user's permission settings to create them).

## Grok Build

### Transport decision: generic ACP v1 stdio, not a Grok-specific stack

Homebase drives the user's installed `grok` CLI through Agent Client Protocol v1 over stdio using the official
`@agentclientprotocol/sdk` (stable v1 entry point, 1.5.1, Apache-2.0) wrapped by `packages/transport-acp`:

```text
Homebase Host → packages/adapter-grok → packages/transport-acp → grok --no-auto-update agent stdio
```

The transport knows nothing about Grok; the adapter owns ACP→Homebase normalization. `grok` authentication stays
with Grok: Homebase stores no xAI API key, OAuth token, refresh token, account email, or browser session, and never
starts an interactive login from the phone.

### Tested against

- **Grok 1.0.41** (`grok 1.0.41 (4220f3b224a6) [alpha]`), **verified live** on Windows 11 on 2026-09-28 for version
  detection, ACP v1 `initialize`, advertised capabilities, and authentication availability — with no prompt sent and
  no subscription usage consumed.
- Session list/load, prompt streaming, reasoning, tools, plans, permissions, cancellation, crash recovery, and
  model/effort switching are **fixture-verified** against the deterministic fake ACP agent in the repo. They have
  not been exercised against the live Grok model yet.

### Command and authentication

```text
grok --no-auto-update agent stdio
```

- `--no-auto-update` is a top-level flag and must precede `agent`. Homebase also sets `GROK_DISABLE_AUTOUPDATER=1`
  in the child environment.
- Homebase never passes `--always-approve`, `--yolo`, `--dangerously-skip-permissions`, or `--permission-mode`
  bypass values. Permission prompts must reach the user.
- Non-interactive auth is preferred: if Grok advertises `cached_token` (a prior `grok login`) or `xai.api_key`
  (an inherited `XAI_API_KEY`), Homebase calls `authenticate` for that method. Interactive `grok.com`/OIDC methods
  are never started from Homebase.
- If no non-interactive method exists, detection returns `installed: true, authenticated: false` with
  "Run `grok login` on the Host."

### Configuration

```json
{
  "providers": {
    "grok": {
      "enabled": true,
      "config": {
        "executable": "grok",
        "startupTimeoutMs": 20000,
        "controlTimeoutMs": 10000,
        "shutdownTimeoutMs": 3000,
        "stderrLimitBytes": 65536
      }
    }
  }
}
```

The schema is strict: unknown fields (including anything credential-shaped) are rejected. Homebase inherits the
normal process environment, so a user-managed `XAI_API_KEY` reaches Grok directly without Homebase storing it.

### Capability matrix (as declared by the adapter)

| Capability              | Supported | Notes                                                                                            |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| streaming               | ✅        | `session/update` text and thought chunks become normalized message/reasoning events              |
| interrupt               | ✅        | `session/cancel`; the prompt settles with `cancelled` and pending permissions are cancelled      |
| steer                   | ❌        | ACP exposes no documented structured steer                                                       |
| queue                   | ❌        | No local queue is faked                                                                          |
| resume                  | ✅        | `session/load` replays history; `session/resume` when advertised                                 |
| deleteSession           | ✅/❌     | Only when the agent advertises `sessionCapabilities.delete` (Grok 1.0.41 does **not**)           |
| models / modelSwitching | ✅        | From `initialize` `_meta.modelState.availableModels`; switching uses `session/set_config_option` |
| thinkingLevels          | ✅        | `_meta.reasoningEfforts` become per-model levels; the effort option is applied per session       |
| modes                   | ✅/❌     | Only when a mode catalog is advertised (`_meta.modes`); otherwise the picker is hidden           |
| attachments             | ❌        | No documented non-image attachment path                                                          |
| imageInput              | ✅/❌     | Only when `promptCapabilities.image` is advertised (Grok 1.0.41 reports `false`)                 |
| tools                   | ✅        | `tool_call`/`tool_call_update` map to started/updated/completed/failed with safe input/output    |
| approvals               | ✅        | `session/request_permission` becomes an approval card; all four option kinds are preserved       |
| questions               | ❌        | No standard ACP question mechanism is surfaced in Phase 5.5                                      |
| plans                   | ✅        | Standard ACP `plan` entries map to `AgentPlan`                                                   |
| diffs                   | ❌        | No provider-native diff primitive                                                                |
| usage                   | ❌        | No documented subscription-window primitive; nothing is scraped from the TUI                     |
| slashCommands           | ❌        | Deferred with the other providers                                                                |

### Known quirks and assumptions

- **Live-verified shapes:** `initialize` returns `protocolVersion: 1`, auth methods
  (`cached_token`, `grok.com`, plus `defaultAuthMethodId` in `_meta`), `loadSession: true`,
  `sessionCapabilities: { list, resume, close }` (no `delete`), and `_meta.modelState.availableModels` with
  per-model `_meta.reasoningEfforts` and `totalContextTokens`.
- **Model metadata is an extension surface.** The catalog parser is defensive: unrecognized shapes yield an empty
  catalog and capabilities stay false rather than inventing entries.
- **`session/list` is requested with the project's canonical `cwd`** and results are re-checked through
  `findProjectByPath`, so Grok sessions outside configured project roots are never exposed to the browser.
- **History is replayed, not double-emitted.** Updates received while `session/load` is in flight build history
  only; they are not emitted as live deltas or a new turn.
- **Unknown ACP update kinds and unknown agent extension requests are ignored/rejected safely** and cannot crash
  the transport.

### Live tests

```bash
HOMEBASE_TEST_GROK=1 npm test -w @homebase/adapter-grok
```

The live suite performs **no model prompts**: it checks `grok --version`, ACP process startup, `initialize`,
advertised capabilities, and authentication availability only. A real prompt test would be a separate, explicitly
opt-in step.

## Claude Code

### Transport decision: direct CLI subprocess, not the Agent SDK

Homebase drives the **user's already-installed `claude` CLI** through its documented structured
`stream-json` interface:

```text
Homebase Host → packages/adapter-claude → claude child process (stream-json on stdio)
```

Why not the Agent SDK: the SDK spawns the same CLI, but bundling it implies a Homebase-owned
Anthropic integration surface. Homebase's product rule is that provider credentials and
authentication stay owned by the locally installed tools. The adapter therefore uses the raw CLI,
ships no Anthropic SDK, implements no Claude login, and never reads or copies Claude credentials.
`--bare` is deliberately **not** used because it bypasses the user's normal OAuth/subscription
login (it requires an API key/helper and skips the user's local Claude environment).

### Tested against

- **Claude Code 2.1.268** (`2.1.268 (Claude Code)`), verified live on Windows 11 on 2026-09-28 with
  the user's own signed-in CLI.
- Integration surface: `-p --input-format stream-json --output-format stream-json --verbose
--include-partial-messages`, the `initialize`/`interrupt`/`set_model`/`set_permission_mode`/
  `apply_flag_settings`/`get_usage` control requests, and `--permission-prompt-tool` with a private
  MCP server for approvals/questions.

### Configuration

```json
{
  "providers": {
    "claude": {
      "enabled": true,
      "config": {
        "executable": "claude",
        "idleTimeoutMs": 600000,
        "startupTimeoutMs": 20000,
        "controlTimeoutMs": 10000,
        "approvalTimeoutMs": 3600000
      }
    }
  }
}
```

No API key, OAuth token, email, org id, or credential path is required or accepted. When `claude`
is missing or signed out the Host still starts and the provider reports a useful warning.

### Authentication behavior and privacy

- Detection runs `claude --version` and `claude auth status`, parses the JSON, and keeps **only** the
  boolean `loggedIn`. The raw payload contains `email`, `orgId`, `orgName`, `subscriptionType`,
  `authMethod`, and paths — none of it is stored, logged, returned, or placed in events.
- The compliance suite recursively rejects sensitive detection fields and email-like values; a
  regression test with a fake auth response proves nothing escapes.
- Signed-out Claude Code never crashes Host startup; `authenticated: false` with an actionable
  warning is returned.

### Capability matrix (as declared by the adapter)

| Capability              | Supported  | Notes                                                                                                                |
| ----------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| streaming               | ✅         | partial text deltas + authoritative assistant frames                                                                 |
| interrupt               | ✅         | stdin `control_request {subtype:"interrupt"}`; receipt gated by `interrupt_receipt_v1`; SIGINT is only a fallback    |
| steer                   | ✅         | user message with `priority: "now"` (verified live: redirects the active turn)                                       |
| queue                   | ✅         | user message with `priority: "next"` (verified live: processed after the active turn)                                |
| resume                  | ✅         | new sessions pin `--session-id <uuid>`; after idle/restart the next prompt uses `--resume <uuid>`                    |
| deleteSession           | ❌         | no documented per-session removal suitable for Homebase                                                              |
| models / modelSwitching | ✅         | models come from the CLI's own `initialize` response; `set_model` applies live                                       |
| thinkingLevels          | ✅         | effort levels per model from `supportsEffort`/`supportedEffortLevels`; applied with `--effort`/`apply_flag_settings` |
| modes                   | ✅         | `default` (CLI `manual`), `acceptEdits`, `plan`, `auto`; bypass modes never exposed                                  |
| imageInput              | ✅         | image content blocks (`{type:"image", source:{type:"base64", …}}`)                                                   |
| attachments             | ❌         | only images are accepted through the structured input path                                                           |
| tools                   | ✅         | tool_use/tool_result mapping with running/completed/failed/denied                                                    |
| approvals               | ✅         | MCP permission-prompt broker over a loopback channel; "always" is session-scoped in memory                           |
| questions               | ✅         | `AskUserQuestion` mapped to neutral questions; answers returned as `updatedInput`                                    |
| plans                   | ❌         | plan mode writes prose, not a structured plan object                                                                 |
| diffs                   | ❌         | Claude exposes no provider-native session diff primitive                                                             |
| usage                   | ✅         | `rate_limit_event.unifiedWindows` (five-hour/weekly/per-model) mapped to usage windows                               |
| slashCommands           | ⏸ deferred | `init.slash_commands` exists but there is no neutral command contract yet                                            |

### Modes and effort

| Homebase mode | CLI flag      | Meaning                                            |
| ------------- | ------------- | -------------------------------------------------- |
| `default`     | `manual`      | Ask before risky tool calls                        |
| `acceptEdits` | `acceptEdits` | Apply file edits without asking                    |
| `plan`        | `plan`        | Explore/propose; make no changes                   |
| `auto`        | `auto`        | Classifier approves most actions (model-dependent) |

`bypassPermissions` and `dontAsk` are excluded by construction: the first is an unrestricted shell,
the second denies everything that would prompt and would disable Homebase's approval UI.

Effort levels are not hard-coded: the CLI's `initialize` response reports `supportsEffort` and
`supportedEffortLevels` per model, and only those levels are offered.

### Session discovery policy

Homebase exposes Claude sessions that are local, project-scoped, and resumable:

- sessions recorded under the configured project directory's transcript folder,
- with at least one real assistant answer (synthetic `<synthetic>` login/notice entries are skipped),
- excluding `claude-desktop`/editor entrypoints, sidechain (subagent) entries, meta entries, and
  never-answered runs. Claude sub-agents therefore have no separate thread yet: their `Task` tool calls still show in
  the Agents strip, but without an "open thread" link (`childSessionId` is absent).

Transcript format is treated as internal and version-sensitive: parsing skips unknown entry types
and malformed lines, and never throws. Message history is built from user/assistant entries with
assistant frames merged by `message.id`, tool results bound by `tool_use_id`, and `<synthetic>`
entries dropped. Transcript paths are never exposed to clients.

### Live tests

```bash
HOMEBASE_TEST_CLAUDE=1 npm test -w @homebase/adapter-claude
```

Verified live on 2.1.268: detection/version with auth redaction, model and mode catalogs, session
create, streamed text, history reload, resume (follow-up turn on the same session), interrupt and
recovery, a Write tool call approved end to end through the MCP broker, an `AskUserQuestion`
answered end to end, subscription usage windows from `rate_limit_event`, and project-scoped session
listing. Approval denial, queue/steer, image input, and model/mode switch races are covered by unit
tests, the fake CLI, and the control-channel probes documented in this file; they were not
re-triggered live to avoid changing the user's permission settings or spending more subscription
usage.

### Version-sensitive assumptions

- Exact control-request/response shapes (`initialize`, `interrupt`, `set_model`,
  `set_permission_mode`, `apply_flag_settings`, `get_usage`) and their capability gates.
- `terminal_reason` starting with `aborted_` must be classified as interrupted _before_ checking
  `is_error`/`subtype` (interrupted results carry both).
- Thinking text is empty in this version (signature only); no reasoning events are emitted.
- The transcript JSONL format is internal; entry types already changed across 2.1.x releases.
- The MCP permission-prompt-tool response shape (`{behavior, updatedInput}` inside the tool result
  text) is historical but live-verified on 2.1.268; it is documented as a compatibility bridge.

## Detection states

`ProviderDetection` distinguishes:

- not installed / server unreachable (`installed: false`)
- installed, authentication unknown (`authenticated: null`)
- installed but not authenticated (`authenticated: false`)
- installed and authenticated (`authenticated: true`)
- compatible / incompatible with the tested version (`compatible`)
- temporarily unavailable (detection failure or transport failure → `installed: false` with `warning`)

Detection never returns credentials or account identifiers.

## Captured fixtures

- Prefer deterministic fixtures captured from a real provider session to paid live runs.
- Fixtures must be scrubbed: no credentials, tokens, personal emails, machine names, personal paths,
  or private repository content. Use synthetic values when re-creating a capture.
- Document which provider version a fixture was captured from next to the file.
