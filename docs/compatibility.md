# Provider compatibility

> Policy: IMPLEMENTATION_PLAN §23. If an installed provider is newer than the latest tested version,
> warn rather than hard-fail unless a known incompatibility exists.

## Matrix

| Provider           | Integration                          | Minimum    | Latest tested | Status                       |
| ------------------ | ------------------------------------ | ---------- | ------------- | ---------------------------- |
| Mock (built-in)    | In-memory adapter                    | 0.0.1-mock | 0.0.1-mock    | Stable (development fixture) |
| OpenCode           | Native server HTTP + SSE adapter     | 2.x        | **2.0.18**    | Beta                         |
| Claude Code        | Structured CLI compatibility adapter | TBD        | TBD           | Planned (Phase 3)            |
| Grok Build         | ACP transport                        | TBD        | TBD           | Planned (Phase 6)            |
| Gemini CLI         | ACP transport                        | TBD        | TBD           | Planned (Phase 6)            |
| Codex CLI          | Application-server protocol          | TBD        | TBD           | Planned (Phase 10)           |
| GitHub Copilot CLI | Official SDK / structured interface  | TBD        | TBD           | Planned (Phase 10)           |

## OpenCode

### Tested against

- **OpenCode 2.0.18** (server API `GET /api/*`, spec `GET /openapi.json`: "opencode HttpApi",
  version 0.0.1). Live verification on Windows 11 with the user's own CLI authentication.
- API family: the experimental HttpApi surface used by the OpenCode 2.x server. Endpoints are
  **not** the same as the `opencode serve` documentation that targets a different major; the adapter
  was built from the installed server's own OpenAPI document plus live captures.

### Configuration

```json
{
  "providers": {
    "opencode": {
      "enabled": true,
      "config": {
        "baseUrl": "http://127.0.0.1:4096",
        "username": "opencode",
        "password": "…",
        "requestTimeoutMs": 15000
      }
    }
  }
}
```

- `baseUrl` — OpenCode server endpoint; default `http://127.0.0.1:4096`.
- `password` — optional HTTP Basic auth (`OPENCODE_SERVER_PASSWORD` on the server side). The adapter
  sends no `Authorization` header when unset, so local servers without auth work unchanged.
- The password stays in Host configuration; it is never logged and never returned by `detect()`.

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

These were true of the private Homebase-era OpenCode 2.0.6 observations and were re-verified:

| Donor observation                                       | Current status (2.0.18)                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/api/info` warm-up failures on first call per location | Still possible for `/api/model` (empty catalog), not for `/api/info`; adapter retries the catalog once      |
| `next` cursor on the last page                          | Still returned; adapter normalizes short pages                                                              |
| Session list needs `parentID=null` to hide subagents    | Still true; adapter also filters `parentID` defensively                                                     |
| `location[directory]=` deep-object scoping for catalogs | Unchanged for `/api/model`, `/api/agent`, `/api/command`; `/api/session` uses a plain `directory` parameter |
| `_tag` error bodies                                     | Unchanged (`SessionNotFoundError`, `PermissionNotFoundError`, …)                                            |
| `delivery: "steer"` is the default for plain prompts    | Unchanged; the adapter only sends `delivery` explicitly when steering or queueing                           |
| Reasoning text may be present                           | Yes (model-dependent; e.g. reasoning-capable models stream `reasoning_content`)                             |
| Form fields use `q0…` keys with options + `custom`      | Unchanged and verified live                                                                                 |

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

## Claude Code, ACP, Codex, Copilot

Filled in during their phases. Adapters must state the tested version in their package documentation
and update this table in the same change.

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
