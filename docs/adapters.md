# Adapters

> Contract: `packages/adapter-sdk/src/adapter.ts`. Compliance suite:
> `packages/adapter-sdk/src/compliance.ts`.

An adapter is the only place that knows a provider's native protocol. Everything above it — Host logic
and the PWA — speaks `@homebase/protocol`.

## The contract

```ts
interface AgentAdapter {
  readonly id: ProviderId;
  readonly displayName: string;

  init?(context: AdapterContext): void | Promise<void>;
  dispose?(): void | Promise<void>;

  detect(): Promise<ProviderDetection>;
  getCapabilities(): Promise<AgentCapabilities>;

  listModels(project: AgentProject): Promise<AgentModel[]>;
  listModes(project: AgentProject): Promise<AgentMode[]>;

  listSessions(project: AgentProject, page?: PageRequest): Promise<AgentPage<AgentSession>>;
  getSession(sessionId: SessionId): Promise<AgentSession>;
  createSession(input: CreateSessionInput, project: AgentProject): Promise<AgentSession>;
  deleteSession?(sessionId: SessionId): Promise<void>;

  listMessages(sessionId: SessionId, page?: PageRequest): Promise<AgentPage<AgentMessage>>;

  send(sessionId: SessionId, input: SendMessageInput): Promise<void>;
  interrupt?(sessionId: SessionId): Promise<void>;
  steer?(sessionId: SessionId, input: SendMessageInput): Promise<void>;
  queue?(sessionId: SessionId, input: SendMessageInput): Promise<void>;

  resolveApproval?(requestId: string, result: ApprovalResult): Promise<void>;
  answerQuestion?(requestId: string, answer: QuestionAnswer): Promise<void>;

  setModel?(sessionId: SessionId, input: SetModelInput): Promise<void>;
  setMode?(sessionId: SessionId, input: SetModeInput): Promise<void>;

  getDiff?(sessionId: SessionId): Promise<AgentDiff>;
  getUsage?(): Promise<AgentUsage | null>;
}
```

Rules:

- **Optional methods are capability-gated.** If `interrupt` is declared, `interrupt()` must exist and
  work. If not, the Host returns `unsupported_capability` and the UI hides the affordance.
- **Send, steer, and queue are distinct operations.** `send` begins a turn when appropriate (it must
  not hijack an active run); `steer` injects into the active turn; `queue` parks a message for delivery
  behind the active turn (or runs it immediately when idle).
- **`send` resolves on acceptance**, not completion. Streaming progress arrives through events.
- **List operations page.** `listSessions` and `listMessages` return `AgentPage` with opaque cursors;
  adapters normalize short final pages to a null next cursor.
- Methods without a matching boolean capability in `CAPABILITY_METHODS` are covered by the compliance
  suite's structural checks.
- **Only `context.emit` talks to clients.** Adapters never serve HTTP, never fan out, and never assign
  sequence numbers.

## `AdapterContext`

```ts
interface AdapterContext {
  readonly hostVersion: string;
  readonly config: Readonly<Record<string, unknown>>; // validated per-provider config
  readonly logger: AdapterLogger;

  resolveProjectPath(projectId: ProjectId): Promise<string>;
  emit(event: AgentEvent): void;
}
```

- `resolveProjectPath` returns the canonical, allowlisted path from the Host project registry. Adapters
  must not read configuration files or environment variables to find projects, and must not accept paths
  from messages.
- `findProjectByPath` maps a provider-reported directory (session location, transcript cwd) back to a
  Homebase project id, or `null` when it is outside every configured root. Adapters use it to scope
  provider data instead of inventing their own project identity.
- `resolveAttachment` yields Host-owned bytes for an uploaded attachment id. Adapters never read
  arbitrary files; clients never send paths.
- **Ids returned to clients must be provider-scoped.** Use `createPublicId(providerId, nativeId)` for
  sessions and globally routed requests (approvals/questions); decode with `decodePublicIdFor(id,
providerId)` and fail closed on foreign/malformed ids. The compliance suite enforces this.
- `config` contains only what the operator put in `providers.<id>.config` in the Host config. Secrets go
  here, stay server-side, and must never be emitted in events, logs, or detection output.
- `emit` publishes a normalized event. Omit `occurredAt` and the Host stamps time.

## Errors

Throw `AdapterError` from `@homebase/adapter-sdk`:

```ts
throw new AdapterError("provider_not_installed", "The OpenCode CLI was not found on PATH.");
```

- Codes come from `AgentErrorCode` in the protocol; unknown thrown values are normalized to
  `provider_error` with a sanitized, bounded message.
- `retryable` and `details` are optional; `details` must be JSON and non-sensitive.
- Provider-native error payloads stay inside the adapter. If a tag matters for debugging, log it (with
  redaction), don't throw it.
- Never surface credentials in `message` or `details`.

## Writing an adapter

1. Create `packages/adapter-<provider>` implementing `AgentAdapter`.
2. Register it with the Host (`AdapterRegistration`): `{ id, displayName, create(config) }`.
3. Declare capabilities in `getCapabilities()` honestly.
4. Own all native parsing, session lifecycle, reconnects, and quirks inside the package.
5. Cover it with:
   - unit tests using `createTestAdapterContext()` (from `@homebase/adapter-sdk/testing`);
   - captured-fixture replay tests for native stream shapes;
   - the compliance suite;
   - `HOMEBASE_TEST_<PROVIDER>=1`-gated live tests that validate assumptions fixtures cannot prove.
6. Document provider quirks next to the code and update `docs/compatibility.md`.

## Compliance suite

```ts
import { defineAdapterComplianceSuite } from "@homebase/adapter-sdk/compliance";
import { MyAdapter } from "../src/index.js";

defineAdapterComplianceSuite({
  providerName: "My Provider",
  createAdapter: () => new MyAdapter(),
  createProject: () => ({ id: "prj_fixture", name: "demo", path: "/tmp/demo", providersAvailable: [] }),
  live: process.env.HOMEBASE_TEST_MY_PROVIDER === "1",
});
```

Checks:

- provider identity is a valid slug and display name is present;
- detection is well-formed and contains no credential-looking fields;
- capabilities parse and are complete;
- every declared capability with a matching method has that method (including `queue`);
- models/modes/sessions validate against the protocol schemas;
- create → get → list → delete lifecycle (when a project fixture is supplied);
- session and message listing return valid `AgentPage` shapes with opaque cursors;
- live-only checks (streaming turn, interrupt, message history, diff, usage) run only when
  `live: true`;
- unsupported capabilities are skipped with an explicit reason — never faked, never failed.

The mock adapter is the reference implementation and runs the suite with `live: true` in
`packages/adapter-sdk/test/compliance.test.ts`.

## ACP providers

Providers that speak the Agent Client Protocol use `@homebase/transport-acp` instead of hand-rolling JSON-RPC:

- `AcpTransport` owns stdio process lifecycle, ACP v1 `initialize`/capability negotiation, request correlation with
  bounded control timeouts, notifications, cancellation, a bounded stderr tail, and process-death semantics.
- The Host may call `detect()` and `getCapabilities()` concurrently (`Promise.all`), so adapter connection state must
  be race-safe: single-flight connection/recycle attempts, identity-gated process-exit handling, and coherent
  capability results even while a signed-out process is being recycled.
- Adapters register only the client callbacks they genuinely support. Homebase advertises **no** `fs/*` or
  `terminal/*` client capabilities.
- `session/prompt` is always run as a background turn: `send()` starts it, the transport resolves later, and
  normalized events carry progress and the terminal turn outcome.
- `packages/adapter-grok` is the reference ACP adapter and runs the full compliance suite against the deterministic
  fake ACP agent in `packages/transport-acp/test/fixtures/fake-agent.mjs`.

## Mock adapter

`MockAdapter` (`@homebase/adapter-sdk/testing`) is a deterministic in-memory provider used by Host tests,
UI development, and adapter authors. Prompt keywords trigger behaviors:

- `approve` → emits an approval request and waits for resolution
- `ask` → emits a structured question and waits for an answer
- `think` → streams a reasoning part

It deliberately declares `slashCommands: false` so the unsupported-capability path is exercised.

## Live provider tests

Naming convention:

```text
HOMEBASE_TEST_OPENCODE=1
HOMEBASE_TEST_CLAUDE=1
HOMEBASE_TEST_GROK=1
```

These must never run by default, must not require a provider to be installed for the normal test suite,
and must not fail CI for contributors without the provider. Prefer replaying captured fixtures for
regressions. `HOMEBASE_TEST_GROK=1` performs only no-model-cost checks (version, ACP startup, initialize,
capabilities, auth availability); it never sends a prompt.

## Delivery semantics reference

| Event                                       | Meaning for clients                                         |
| ------------------------------------------- | ----------------------------------------------------------- |
| `message.started`                           | Message exists (possibly empty parts); render immediately   |
| `message.updated`                           | Full snapshot after parts change; upsert by message id      |
| `message.delta`                             | Append to the part id; ignore unknown part ids              |
| `message.completed`                         | Replace with the final snapshot                             |
| `tool.*`                                    | Replace `AgentToolCall` by id; `denied` is a user rejection |
| `turn.*`                                    | Run lifecycle; `turn.failed` carries `AgentError`           |
| `approval.requested` / `question.requested` | Show a blocking card; resolve via Host API                  |
| `provider.event`                            | Escape hatch; not for shared UI logic                       |
