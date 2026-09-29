# Homebase — Open-Source Implementation Plan

> **Status:** Living implementation reference  
> **Audience:** AI coding agents and human contributors  
> **Product:** Homebase  
> **Primary goal:** A local-first, mobile-first control plane for AI coding agents running on a user's own computer.

---

## 0. How to use this document

This file is the implementation source of truth for the open-source Homebase repository.

When there is a conflict between an implementation idea and this document:

1. Prefer this document.
2. Prefer provider-neutral abstractions over provider-specific shortcuts.
3. Prefer official and documented provider interfaces over terminal scraping or undocumented APIs.
4. Prefer local-first and explicit security boundaries over convenience.
5. Prefer capabilities over fake feature parity.
6. Prefer small, testable phases over large rewrites.

The existing **private/personal Homebase repository** is a reference implementation and a source of proven code. It is **not** the architecture to copy wholesale. Reuse code selectively after understanding it, removing personal assumptions, removing private infrastructure features, and adapting it to the public architecture defined here.

Do not import the private repository's Git history into this repository.

---

# 1. Product definition

Homebase is a local-first, mobile-first interface for controlling AI coding agents that are already installed and authenticated on a developer's computer.

The user's computer is the execution environment. The phone is the control surface.

Homebase should eventually support agents such as:

- Claude Code
- OpenCode
- Grok Build
- Gemini CLI
- OpenAI Codex CLI
- GitHub Copilot CLI
- Additional community adapters later

The product is **not** a remote terminal. It is a structured client for agent concepts such as:

- projects
- sessions
- messages
- streaming output
- reasoning when available
- tool calls
- approvals
- questions
- plans
- models
- modes
- thinking/effort levels
- attachments when supported
- diffs when supported
- interruptions
- steering/queueing when supported
- usage windows when available through a supported interface

The primary user value is that all supported agents share one coherent mobile experience.

---

# 2. Product principles

## 2.1 Local-first

Provider credentials, source code, project files, transcripts, and CLI authentication stay on the user's computer unless the underlying provider CLI itself sends data to its service.

Homebase must not require a Homebase cloud account or Homebase-operated relay for the initial releases.

## 2.2 One interface, not one lowest-common-denominator agent

Providers have different capabilities. Homebase must normalize concepts without pretending all providers are identical.

The UI must use a capability model to show only features supported by the selected provider/session.

## 2.3 Official integration surface first

Integration preference, in order:

1. Official SDK / application server / documented protocol
2. Documented HTTP/SSE interface
3. Documented ACP or JSON-RPC interface
4. Documented structured CLI mode (`json`, `stream-json`, etc.)
5. Carefully isolated compatibility bridge when no better option exists
6. Undocumented behavior only as an explicitly experimental last resort

Do not parse terminal ANSI/TUI output when a structured interface exists.

## 2.4 The mobile UI should hide provider plumbing

Users should think in terms of projects and work, not transport protocols.

The UI may identify the provider, but it should not expose implementation details such as ACP method names, native event names, transcript file formats, or CLI process flags.

## 2.5 Safe by default

Homebase remotely controls software capable of reading files, modifying repositories, running shell commands, and deploying software. Security is a core product requirement.

Unsafe defaults are bugs.

---

# 3. Scope

## 3.1 Public v0.1 target

The first public alpha should support at least three distinct integration families so the architecture is proven to be truly multi-provider:

- **OpenCode** — native HTTP + SSE
- **Claude Code** — compatibility bridge based on structured CLI behavior
- **At least one ACP provider** — Grok Build first, then Gemini CLI

Preferred v0.1 provider set:

- OpenCode — stable
- Claude Code — stable
- Grok Build — beta/stable depending on integration maturity
- Gemini CLI — beta

## 3.2 v0.2 target

Add:

- OpenAI Codex CLI using its application-server protocol
- GitHub Copilot CLI using the official SDK / JSON-RPC interface

## 3.3 Later / experimental

- Antigravity CLI if its structured interface is sufficiently durable
- community adapter SDK
- multi-host support
- native apps if a clear platform need appears

## 3.4 Explicit non-goals for early versions

Do **not** add these during the initial extraction:

- generic server monitoring
- Docker dashboard features
- systemd dashboard features
- Uptime Kuma integration
- Wake-on-LAN
- arbitrary SSH terminal
- remote desktop
- built-in code editor
- Git GUI
- cloud relay
- user accounts
- teams
- shared collaborative sessions
- billing
- hosted transcript sync
- native iOS application
- native Android application

Those are outside the open-source Homebase core.

---

# 4. Target architecture

```text
┌──────────────────────────────────────────────┐
│                Homebase PWA                  │
│                                              │
│ Attention · Projects · Activity · Settings   │
│ Project · Session · Chat                     │
└──────────────────────┬───────────────────────┘
                       │
                  HTTPS / REST
                       │
                  Server-Sent Events
                       │
                       ▼
┌──────────────────────────────────────────────┐
│              Homebase Host                   │
│                                              │
│ auth / pairing                               │
│ project registry                             │
│ provider registry                            │
│ normalized protocol                          │
│ session routing                              │
│ event sequencing                             │
│ notifications                                │
└──────┬──────────┬──────────┬──────────┬───────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
   OpenCode    Claude       ACP      JSON-RPC
   adapter     adapter    transport   transports
       │          │       │      │     │      │
       ▼          ▼       ▼      ▼     ▼      ▼
   OpenCode    Claude    Grok  Gemini Codex Copilot
```

The PWA never talks directly to provider processes.

All provider communication flows through the Homebase Host.

---

# 5. Repository structure

Start with this structure and add provider packages only when implemented.

```text
homebase/
├── apps/
│   ├── host/
│   │   ├── src/
│   │   │   ├── api/
│   │   │   ├── auth/
│   │   │   ├── events/
│   │   │   ├── projects/
│   │   │   ├── providers/
│   │   │   ├── sessions/
│   │   │   ├── notifications/
│   │   │   ├── config/
│   │   │   └── index.ts
│   │   └── test/
│   │
│   └── web/
│       ├── src/
│       │   ├── routes/
│       │   ├── components/
│       │   ├── features/
│       │   ├── lib/
│       │   ├── stores/
│       │   └── styles/
│       └── e2e/
│
├── packages/
│   ├── protocol/
│   ├── adapter-sdk/
│   ├── transport-acp/
│   ├── adapter-opencode/
│   ├── adapter-claude/
│   ├── adapter-grok/
│   └── adapter-gemini/
│
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── adapters.md
│   ├── compatibility.md
│   ├── security.md
│   └── threat-model.md
│
├── examples/
│   └── adapter-example/
│
├── IMPLEMENTATION_PLAN.md
├── README.md
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── LICENSE
└── package.json
```

Use npm workspaces unless there is a strong reason to change package management later.

---

# 6. Technology choices

Initial stack:

| Layer | Choice |
|---|---|
| Runtime | Node.js 22+ |
| Language | TypeScript |
| Host HTTP | Hono or similarly small typed HTTP layer |
| Frontend | React + Vite + TypeScript |
| Routing | TanStack Router |
| Async/server state | TanStack Query |
| Lightweight live client state | Zustand if needed |
| Styling | Tailwind CSS + explicit design tokens |
| Validation | Zod |
| Unit/integration tests | Vitest |
| E2E | Playwright |
| Persistence | SQLite where durable local state is needed |
| Mobile delivery | Installable PWA |

Do not rewrite the host in Rust during initial development. Optimize distribution only after the product architecture is stable.

---

# 7. Provider-neutral protocol

The protocol package is the foundation of the product. Build it before porting UI code.

The open-source protocol must not use OpenCode-specific naming such as `OcSession`, `OcMessage`, or `OcEvent`.

Use provider-neutral concepts.

## 7.1 Core entities

At minimum define:

```ts
export type ProviderId = string;
export type ProjectId = string;
export type SessionId = string;

export interface AgentProvider {
  id: ProviderId;
  name: string;
  version?: string;
  installed: boolean;
  authenticated: boolean | null;
  compatible: boolean;
  capabilities: AgentCapabilities;
  warning?: string | null;
}

export interface AgentProject {
  id: ProjectId;
  name: string;
  path: string;
  gitRoot?: string | null;
  gitRemote?: string | null;
  branch?: string | null;
  providersAvailable: ProviderId[];
}

export interface AgentSession {
  id: SessionId;
  provider: ProviderId;
  projectId: ProjectId;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
  state: "idle" | "working" | "waiting" | "failed" | "completed" | "unknown";
  model?: AgentModelRef | null;
  mode?: string | null;
}
```

The final concrete types may differ, but the naming and ownership boundaries should remain provider-neutral.

`unknown` was added during Phase 0 implementation: transcript-backed providers cannot always report the
run state of a persisted session when Homebase starts, and claiming `idle` or `working` there would be a
lie. Shared UI treats `unknown` as "no active claim". See the revision log at the end of this document.

## 7.2 Capability model

Every provider adapter declares its capabilities.

Minimum capability shape:

```ts
export interface AgentCapabilities {
  resume: boolean;
  deleteSession: boolean;

  streaming: boolean;
  interrupt: boolean;
  steer: boolean;
  queue: boolean;

  models: boolean;
  modelSwitching: boolean;
  thinkingLevels: boolean;
  modes: boolean;

  attachments: boolean;
  imageInput: boolean;

  tools: boolean;
  approvals: boolean;
  questions: boolean;
  plans: boolean;

  diffs: boolean;
  usage: boolean;
  slashCommands: boolean;
}
```

Never implement provider checks throughout the UI such as:

```ts
if (provider === "claude") { ... }
```

when the behavior can instead be driven by capabilities.

Provider-specific UI is allowed only where the concept is genuinely provider-specific.

## 7.3 Content model

Messages should support structured content rather than only a markdown string.

Plan for content parts such as:

- text
- reasoning
- image
- file/attachment reference
- tool call
- tool result
- plan
- status/progress
- error

The protocol should preserve enough structure to build a high-quality client without leaking native provider payloads into the frontend.

---

# 8. Normalized event model

All providers feed one event system.

Recommended event vocabulary:

```text
provider.connected
provider.disconnected
provider.updated

session.created
session.updated
session.deleted

turn.started
turn.completed
turn.failed
turn.interrupted

message.started
message.delta
message.completed

reasoning.started
reasoning.delta
reasoning.completed

tool.started
tool.updated
tool.completed
tool.failed

approval.requested
approval.resolved

question.requested
question.resolved

plan.updated
diff.updated
usage.updated
```

A provider-specific escape hatch may exist:

```ts
{
  type: "provider.event",
  provider: "...",
  nativeType: "...",
  data: unknown
}
```

but normal frontend code should rarely consume it.

## 8.1 Global event sequence

The Homebase Host should assign a monotonically increasing sequence number to normalized events:

```ts
{
  sequence: 19242,
  provider: "claude",
  projectId: "...",
  sessionId: "...",
  type: "tool.started",
  data: {}
}
```

The frontend should be able to reconnect after iOS/PWA suspension and request events after the last received sequence where practical.

Do not rely on the browser maintaining a permanently uninterrupted SSE connection.

---

# 9. Adapter contract

Create a reusable adapter interface in `packages/adapter-sdk`.

The exact API can evolve, but it should cover these responsibilities:

```ts
export interface AgentAdapter {
  readonly id: ProviderId;

  detect(): Promise<ProviderDetection>;
  getCapabilities(): Promise<AgentCapabilities>;

  listModels(project: AgentProject): Promise<AgentModel[]>;
  listModes(project: AgentProject): Promise<AgentMode[]>;

  listSessions(project: AgentProject): Promise<AgentSession[]>;
  getSession(sessionId: SessionId): Promise<AgentSession>;
  createSession(input: CreateSessionInput): Promise<AgentSession>;
  deleteSession?(sessionId: SessionId): Promise<void>;

  send(sessionId: SessionId, input: SendMessageInput): Promise<void>;
  interrupt?(sessionId: SessionId): Promise<void>;
  steer?(sessionId: SessionId, input: SendMessageInput): Promise<void>;

  resolveApproval?(requestId: string, result: ApprovalResult): Promise<void>;
  answerQuestion?(requestId: string, answer: QuestionAnswer): Promise<void>;

  setModel?(sessionId: SessionId, model: AgentModelRef): Promise<void>;
  setMode?(sessionId: SessionId, mode: string): Promise<void>;

  getDiff?(sessionId: SessionId): Promise<AgentDiff>;
  getUsage?(): Promise<AgentUsage | null>;

  subscribe(handler: (event: AgentEvent) => void): () => void;
}
```

Unsupported methods must be represented by capabilities and may be absent/undefined.

The adapter layer must own native provider quirks.

The PWA must not know how a Claude transcript is stored or how an OpenCode SSE event is shaped.

**Finalized contract (implemented in `packages/adapter-sdk`).** The responsibilities above are unchanged,
with two refinements found during implementation:

- Adapters receive an `AdapterContext` (`config`, `logger`, `resolveProjectPath`, `emit`) and publish
  normalized events with `context.emit(event)`. The Host owns sequencing and fanout; adapters do not
  expose a `subscribe(handler)` surface. This keeps event delivery in one place and makes adapters
  trivially testable with the SDK's recording context.
- `listModels`, `listModes`, `listSessions`, and `createSession` receive the `AgentProject` record so
  adapters never resolve project paths themselves. Session-scoped calls resolve paths through the
  adapter's own state or `context.resolveProjectPath(projectId)`, which is backed by the Host's
  canonical path registry and allowlist.
- The compliance suite ships at `@homebase/adapter-sdk/compliance`; the deterministic reference adapter
  and test context ship at `@homebase/adapter-sdk/testing`.

---

# 10. Host API

Use REST for commands/reads and SSE for streaming/event delivery.

Initial route direction:

```text
GET    /api/v1/health
GET    /api/v1/providers
GET    /api/v1/projects
GET    /api/v1/projects/:projectId
GET    /api/v1/projects/:projectId/sessions

POST   /api/v1/sessions
GET    /api/v1/sessions/:sessionId
DELETE /api/v1/sessions/:sessionId

POST   /api/v1/sessions/:sessionId/messages
POST   /api/v1/sessions/:sessionId/interrupt
POST   /api/v1/sessions/:sessionId/steer

POST   /api/v1/approvals/:requestId
POST   /api/v1/questions/:requestId

POST   /api/v1/sessions/:sessionId/model
POST   /api/v1/sessions/:sessionId/mode

GET    /api/v1/sessions/:sessionId/diff
GET    /api/v1/providers/:providerId/usage

GET    /api/v1/events
```

Use stable error codes in JSON responses.

Do not expose native provider errors directly without sanitization and normalization.

---

# 11. Project model

Projects belong to Homebase, not to any single provider.

The Host owns configured project roots, for example:

```text
C:\Users\me\Projects
D:\Work
~/Developer
```

The Host discovers repositories and assigns internal project IDs.

Provider calls receive internal project IDs. The Host resolves them to canonical allowlisted paths.

The frontend must not be able to submit an arbitrary filesystem working directory.

Project record should eventually include:

- id
- display name
- canonical path
- git root
- remote
- branch
- provider availability
- session summary across providers

A single project may contain sessions from multiple agents.

---

# 12. Provider implementation plan

## 12.1 OpenCode — reference native adapter

OpenCode should be the first complete implementation of the public adapter contract.

Reuse/reference from private Homebase where valuable:

- hub OpenCode adapter
- OpenCode routes
- shared OpenCode contract/types
- SSE/event handling
- model catalog handling
- session pagination
- approvals/forms
- diffs
- attachments
- mocks and fixtures
- tests that exercise real OpenCode behavior

But refactor all OpenCode-shaped public types into the provider-neutral protocol.

OpenCode is the clean reference adapter, not the common schema.

**Done criteria:**

- detection/version/auth status works
- project-scoped session list works
- session create/resume works
- prompt works
- streaming works
- approvals/questions work where supported
- interrupt works
- model/mode selection works
- attachments work where supported
- diff works
- adapter compliance suite passes

## 12.2 Claude Code — compatibility adapter

Port the proven private Homebase Claude implementation, but restructure it as a public adapter rather than a standalone Homebase-specific bridge.

Useful private source areas include:

- `apps/claude-bridge/src/bridge.mjs`
- `session.mjs`
- `transcript.mjs`
- `permissions.mjs`
- `frames.mjs`
- path allowlisting
- live-run tests
- the Claude adapter and routes in the private hub
- the private Claude protocol notes and fixtures

Preserve proven behavior such as:

- session resume/adoption
- structured stream handling
- permission prompts
- question forms
- interrupt
- model aliases
- effort/thinking levels
- plan usage if available through documented CLI output
- strict MCP isolation
- never exposing provider credentials

Do not copy personal path assumptions, personal connector configuration, or Homebase-specific infrastructure dependencies.

Do not expose unsafe bypass-permission modes through normal product UI.

**Done criteria:**

- adapter is provider-neutral externally
- no Claude-specific conditions are required in shared chat UI for concepts covered by capabilities
- bridge/adapter can survive process restart and resume supported sessions
- run state is accurate
- permission requests and questions work from phone
- failures resolve visibly instead of leaving a permanent "Working" state
- compliance tests pass

## 12.3 ACP transport

Build a generic ACP client package before implementing multiple ACP providers.

Responsibilities:

- process lifecycle for stdio ACP agents
- JSON-RPC request/response correlation
- notifications
- session lifecycle
- cancellation
- permission requests
- questions/prompts
- model/session updates where protocol supports them
- error normalization
- logging without leaking secrets
- reconnect/restart semantics where applicable

The generic transport should not contain Grok or Gemini branding.

## 12.4 Grok Build adapter

Implement Grok on top of the ACP transport where possible.

Provider package responsibilities should mostly be:

- binary detection
- supported invocation
- capability mapping
- native-to-normalized event mapping
- model/mode mapping
- provider-specific metadata

Avoid reimplementing ACP lifecycle logic in the Grok package.

## 12.5 Gemini CLI adapter

Implement Gemini CLI on top of the ACP transport where supported.

Account for the fact that Google may have different authentication/product availability depending on account type.

Provider detection must distinguish:

- not installed
- installed but not authenticated
- installed/authenticated
- installed but unsupported/incompatible version

Do not hard-code assumptions about all Google users having identical access.

## 12.6 Codex — later adapter

Use the official Codex application-server interface rather than parsing terminal UI output.

Build this after the core protocol has survived OpenCode, Claude, and ACP.

## 12.7 GitHub Copilot — later adapter

Use the official Copilot SDK / structured CLI interface rather than terminal scraping.

Build this after the core protocol is stable.

---

# 13. Private Homebase reuse map

The AI agent implementing this repository should inspect the private Homebase repository before rewriting proven behavior.

### Likely reusable concepts/code

#### Web

- mobile chat layout
- timeline rendering
- smooth streamed text behavior
- folded completed work
- tool rows
- approval cards
- question/form cards
- composer behavior
- iOS keyboard handling
- safe-area handling
- model picker
- thinking/effort picker
- image previews
- diff sheet
- project/session list interaction
- mock architecture
- Playwright fixtures and state coverage
- design tokens and accessibility tests

#### Host/backend

- OpenCode adapter behavior
- Claude bridge behavior
- project discovery logic
- canonical path/allowlist logic
- structured error mapping
- event fanout patterns
- stale/offline handling concepts
- configuration validation patterns

#### Shared/testing

- captured provider fixtures
- session/message fixtures
- event-folding tests
- model normalization tests
- forms/approval tests
- contrast tests
- mobile E2E cases

### Do not port into open-source core

- iMac system metrics
- Docker monitoring
- systemd dashboard
- Uptime Kuma dashboard
- PC Wake-on-LAN
- private LAN assumptions that are not generic
- private machine names
- personal user names
- personal repository paths
- personal credentials/tokens
- private ntfy topics
- direct use of undocumented saved OAuth tokens
- undocumented Codex/ChatGPT usage endpoints as a core feature
- any Homebase-specific secret or environment value

When copying code, adapt naming and architecture rather than preserving private-specific abstractions for convenience.

---

# 14. Mobile product architecture

The public product should not copy the entire private Homebase navigation.

Primary surfaces:

## 14.1 Attention

A unified inbox for items requiring the developer:

- approval requested
- question requested
- plan ready
- run failed
- optionally completed work that has not been seen

This should eventually become one of the strongest product differentiators.

## 14.2 Projects

Project-first view across providers.

Example:

```text
GlassFlow
  Claude Code — Working
  OpenCode — 2 recent sessions
  Grok — Needs approval
```

## 14.3 Activity

Unified active/recent runs across projects and providers.

## 14.4 Settings

- host status
- paired devices
- project roots
- providers
- provider status/version/auth state
- networking
- notification settings
- diagnostics

## 14.5 Session/chat

Start from the private Homebase chat UX, but refactor it to consume only provider-neutral protocol types.

Keep or improve:

- smooth streaming
- final answer prominence
- collapsible completed work
- reasoning when available
- tool rows
- approval cards
- questions
- plan rendering
- diff rendering
- attachments
- model picker
- mode picker
- thinking/effort picker
- stop
- steer/queue where supported
- reconnect state
- offline/stale state

---

# 15. PWA requirements

Homebase is mobile-first but should remain responsive on desktop.

Required:

- installable PWA
- iOS safe-area support
- Android safe-area support
- keyboard-safe composer
- no horizontal overflow
- at least 44x44 touch targets
- light and dark themes
- reduced-motion support
- accessible focus states
- large-text resilience
- reconnect handling after app suspension
- service worker must not cache private session/transcript API data

Do not build a native iOS/Android application for v0.1.

---

# 16. Security model

Security is release-blocking.

## 16.1 Default bind

The Homebase Host must bind to localhost by default.

Remote exposure must require an explicit configuration step.

## 16.2 Initial remote-network recommendation

Tailscale is the recommended remote access path for early releases.
Phase 5 uses Tailscale Serve to proxy the loopback Host through a private tailnet HTTPS hostname. Funnel is public and is not recommended. Homebase device auth remains required on top of the tailnet; Tailscale identity headers are not used as application credentials.

Do not instruct users to expose Homebase directly to the public internet with router port forwarding.

## 16.3 Provider credentials

Provider credentials remain on the host computer.

The phone authenticates to Homebase, not to Anthropic/OpenAI/GitHub/Google/xAI directly.

Homebase must never return provider tokens or credential files through its API.

## 16.4 Project allowlist

All project paths must be canonicalized and checked against configured project roots before any provider process or tool is started.

The frontend must not be able to bypass the registry by supplying arbitrary working directories.

## 16.5 Pairing

Target setup flow:

```text
homebase pair
```

The host generates a short-lived, single-use pairing credential and displays a QR code / URL.

After redemption, create a revocable device credential.

Track:

- device id
- friendly name
- created time
- last seen time
- revoked state

Do not use one permanent shared token copied manually between devices as the final public UX.

**Phase 5 implementation:** `auth.mode: "device"` is the normal default. The Host creates a private, machine-local admin key in `~/.homebase` (or `HOMEBASE_STATE_DIR`). `homebase pair` authenticates to a loopback management endpoint, receives a five-minute, in-memory, 256-bit invitation, and prints a local QR for a private HTTPS Serve URL. The one-time secret is in the URL fragment and is removed from browser history before a POST. Redemption consumes it atomically, generates a versioned 256-bit per-device credential, persists only its SHA-256 digest, and sets a Secure, HttpOnly, SameSite=Strict `__Host-` cookie. Device revoke invalidates REST and closes active SSE. Local `homebase devices` and `homebase revoke` recover access after loss. `none` and `dev-token` remain explicit development modes.

## 16.6 Web security requirements

At minimum:

- strict CSP
- no third-party JavaScript by default
- no third-party analytics by default
- no caching API responses containing private data
- sanitize Markdown
- do not render raw agent HTML
- sanitize/escape tool output
- limit request body sizes
- limit attachment sizes
- validate attachment MIME types
- rate-limit pairing
- rate-limit repeated auth failures
- use secure random credentials
- never log secrets
- redact likely credentials from diagnostics/logging where possible

---

# 17. Persistence

Provider sessions/transcripts should remain provider-owned whenever possible.

Homebase persistence should initially be limited to data Homebase itself owns, such as:

- paired devices
- a local admin key and versioned security state (atomic private JSON; no raw device secret)
- project registry
- provider settings
- host settings
- notification state
- event sequence/checkpoint state
- lightweight normalized metadata cache if needed

Do not duplicate complete provider conversation histories into Homebase storage unless there is a clear requirement.
For the small Phase 5 security record set, atomic JSON is sufficient; SQLite remains appropriate if future durable state grows. Corrupt or future-version security state fails startup closed.

---

# 18. Notifications

Design the event model so notifications can be added without reworking adapters.

Useful notification events:

- approval needed
- question needed
- plan ready
- run completed
- run failed

Avoid notifying for low-level tool activity.

Notification backends should be pluggable.

Initial options may include:

- none
- ntfy
- Web Push when ready

---

# 19. Installation and setup

Long-term target:

```bash
npx homebase setup
```

or an equivalent simple installation command.

The setup wizard should eventually:

1. detect installed provider CLIs
2. detect provider versions
3. check authentication state without exposing credentials
4. ask for project roots
5. detect Tailscale
6. generate Homebase configuration
7. install/start the Host as a background service
8. generate a pairing QR code
9. run diagnostics

Example UX:

```text
Checking installed agents...

✓ Claude Code
✓ OpenCode
✓ Grok Build
✕ Gemini CLI
✕ Codex
✓ GitHub Copilot

Choose project folders:
> C:\Users\me\Projects

Tailscale detected.
Install Homebase as a background service? Yes

Ready. Scan this QR code with your phone.
```

Do not require users to manually edit many environment variables for the normal installation path.

---

# 20. Testing strategy

## 20.1 Protocol tests

The protocol package must have tests covering serialization, event semantics, and capability behavior.

## 20.2 Adapter compliance suite

Create a shared compliance suite every adapter can run.

Common checks should cover, when supported:

- detection
- version reporting
- auth state
- project scoping
- list sessions
- create session
- resume session
- send prompt
- stream output
- interrupt
- approval
- question
- model switch
- mode switch
- error propagation
- process/provider disconnect
- restart/resume behavior

Unsupported capabilities should skip explicitly rather than fail or be faked.

## 20.3 Fixture tests

Capture representative native provider streams and replay them in tests.

Fixtures must not contain credentials, personal email addresses, private repository paths, or personal data.

## 20.4 Real-provider tests

Use opt-in environment-gated tests for live CLIs.

Examples:

```text
HOMEBASE_TEST_CLAUDE=1
HOMEBASE_TEST_OPENCODE=1
HOMEBASE_TEST_GROK=1
```

These tests should not run automatically for contributors without the provider installed/authenticated.

## 20.5 Web E2E

Playwright should test mobile states including:

- normal
- loading
- provider offline
- host reconnect
- working session
- completed session
- failed session
- approval
- question
- long conversation
- large text
- reduced motion
- light/dark mode
- keyboard/composer behavior where testable
- safe-area behavior

Preserve the strong state-coverage discipline from private Homebase.

---

# 21. Design direction

The open-source product should preserve the quality bar of private Homebase without blindly copying every visual detail.

Design goals:

- calm
- compact
- mobile-native feeling
- high information density without looking like a monitoring dashboard
- restrained use of color
- provider identity should be visible but not dominate
- status colors should mean status
- readable streamed text
- approvals/questions should feel first-class, not like raw JSON cards
- no generic developer-dashboard aesthetic

The UI should be visually strong enough that mobile experience is a product differentiator.

---

# 22. Documentation requirements

Before public alpha, include:

- `README.md`
- `docs/architecture.md`
- `docs/protocol.md`
- `docs/adapters.md`
- `docs/compatibility.md`
- `docs/security.md`
- `docs/threat-model.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- Apache-2.0 `LICENSE`

README should answer immediately:

1. What is Homebase?
2. Why use it instead of each provider's mobile app?
3. Which providers are supported?
4. Where does source code run?
5. Where do provider credentials live?
6. How is the phone connected securely?
7. How do I install it?
8. What is considered experimental?

---

# 23. Compatibility policy

Maintain a compatibility table.

Example:

| Provider | Minimum | Latest tested | Status |
|---|---:|---:|---|
| OpenCode | TBD | TBD | Stable |
| Claude Code | TBD | TBD | Stable |
| Grok Build | TBD | TBD | Beta |
| Gemini CLI | TBD | TBD | Beta |

If an installed provider is newer than the latest tested version, warn rather than hard-fail unless there is known incompatibility.

Provider detection should distinguish:

- not installed
- installed/authenticated
- installed/not authenticated
- installed/incompatible
- installed/newer than tested
- temporarily unavailable

---

# 24. Version and release policy

Use semantic versioning.

Early development:

- `0.0.x` — internal extraction and architecture work
- `0.1.0` — first public alpha with OpenCode + Claude + ACP provider support
- `0.2.0` — Codex + Copilot
- `0.3.0` — adapter SDK maturity / additional providers / multi-host groundwork

Breaking changes are acceptable in `0.x` but must be documented.

---

# 25. Implementation phases

## Phase 0 — Repository and specification foundation

### Tasks

- create monorepo/workspaces
- add TypeScript configuration
- add formatter/linter/test setup
- add Apache-2.0 license
- add GitHub Actions for build/typecheck/test
- add secret scanning where practical
- add this implementation plan
- create `packages/protocol`
- create `packages/adapter-sdk`
- define provider-neutral entities
- define capabilities
- define normalized event model
- define adapter interface
- write adapter compliance test harness skeleton
- create threat-model draft

### Exit criteria

- clean build
- clean typecheck
- protocol package tested
- no provider-specific types leak into shared protocol
- adapter contract is documented

## Phase 1 — Host core

### Tasks

- create `apps/host`
- config loading/validation
- provider registry
- project registry
- canonical project path handling
- REST API skeleton
- global normalized event bus
- SSE endpoint
- event sequence IDs
- stable error format
- basic local auth placeholder suitable for development
- health/diagnostic endpoint

### Exit criteria

- host runs locally
- project registry works against test fixtures
- mock provider can register
- mock provider events reach a browser/client through SSE
- arbitrary filesystem paths cannot bypass allowed roots

## Phase 2 — OpenCode reference adapter

### Tasks

- inspect private Homebase OpenCode implementation
- port only reusable behavior
- translate native OpenCode types/events into public protocol
- implement provider detection
- implement session list/create/resume
- implement streaming
- implement approvals/questions
- implement models/modes
- implement interrupt
- implement attachments where supported
- implement diffs
- port relevant fixtures/tests
- run compliance suite

### Exit criteria

OpenCode can be fully controlled through the Host without the frontend knowing OpenCode-native payloads.

## Phase 3 — Claude Code adapter

### Tasks

- inspect private bridge and notes
- split bridge responsibilities into maintainable modules
- preserve proven process/session behavior
- normalize transcripts and live stream into protocol events
- implement permissions/questions
- implement interrupt
- implement resume/adoption
- implement model/effort controls
- implement provider status/auth detection
- implement usage only through supported/structured data
- preserve strict MCP isolation
- run compliance suite

### Exit criteria

The same generic session client can drive both OpenCode and Claude Code with capability-driven differences only.

## Phase 4 — Minimal public web client

### Tasks

- create `apps/web`
- establish design tokens
- add PWA manifest/installability
- implement Projects
- implement Project sessions
- implement Session/chat
- implement provider badge/status
- implement capabilities-driven controls
- port/refactor private Homebase chat components where appropriate
- implement reconnect state
- implement mock providers/scenarios
- add mobile Playwright suite

### Exit criteria

From a phone-sized browser, a user can select a project, open/create a session, send a prompt, watch streaming output, approve/answer requests, and interrupt a run for both OpenCode and Claude.

## Phase 5 — Security and device pairing

**Status:** implemented on the Phase 5 review branch; pending PR/CI review before merge.

### Tasks

- localhost-only default bind
- device credential model
- one-time pairing token
- pairing API
- QR setup flow
- credential revocation
- secure headers/CSP
- auth failure throttling
- request/body/attachment limits
- security tests
- Tailscale setup documentation

### Exit criteria

No manual permanent token copy is required for normal setup, and all remote control requires an explicitly paired device.
Browser auth is cookie-based to support WebKit's iOS/iPadOS 17.2+ Home Screen cookie handoff. Earlier iOS versions may require pairing again inside the installed app.

## Phase 6 — Generic ACP transport + Grok + Gemini

### Tasks

- build `packages/transport-acp`
- implement process lifecycle
- implement JSON-RPC correlation
- implement ACP notifications/events
- implement cancellation
- implement permission/question handling
- implement reconnect/process-failure semantics
- add Grok adapter
- add Gemini adapter
- run compliance suite on both
- verify the shared protocol survives a third integration family

### Exit criteria

At least one ACP provider is usable end-to-end in the same PWA without provider-specific shared UI architecture.

## Phase 7 — Attention + Activity

### Tasks

- unified Attention model
- approvals across providers
- questions across providers
- failed/finished state
- unified Activity feed
- deep links to session/request
- groundwork for notifications

### Exit criteria

A user can see all agent work requiring attention without opening each provider/project individually.

## Phase 8 — Installer and background service

### Tasks

- interactive setup command
- provider detection
- project-root wizard
- Tailscale detection
- background service installation
- pairing QR
- diagnostics command
- upgrade command
- uninstall instructions

### Exit criteria

A technically competent user can install Homebase from README instructions without manually wiring multiple services or editing a large environment file.

## Phase 9 — Public alpha hardening

### Tasks

- full docs
- compatibility matrix
- security review
- dependency/license review
- fixture privacy audit
- clean secret scan
- accessibility review
- mobile QA on real iOS and Android devices where possible
- release notes

### Exit criteria

Release `0.1.0`.

## Phase 10 — Codex and Copilot

Only after the protocol has survived the earlier phases:

- add Codex adapter using the official application-server protocol
- add GitHub Copilot adapter using the official SDK/structured interface
- update capability matrix
- run compliance suite
- release as a later minor version

---

# 26. AI-agent implementation rules

Any AI coding agent working on this repository should follow these rules.

1. **Read this file before making architectural changes.**
2. **Inspect the relevant private Homebase code before reimplementing proven functionality.**
3. **Do not blindly copy the private repo. Understand, extract, generalize, and test.**
4. **Never copy credentials, tokens, private machine names, personal emails, or private paths into this repo.**
5. **Do not preserve `Oc*` naming in the new public protocol.**
6. **Do not add provider checks to shared UI when capabilities can express the difference.**
7. **Do not parse terminal UI output when a structured provider interface exists.**
8. **Do not expose provider credentials to the browser.**
9. **Do not accept arbitrary unvalidated working directories from the frontend.**
10. **Do not make the host public-internet-facing by default.**
11. **Do not add Homebase's unrelated homelab/server-monitoring features.**
12. **Add tests with each provider behavior ported from the private repo.**
13. **Prefer captured fixtures and deterministic tests over relying on live paid-provider runs.**
14. **Use live-provider tests to validate assumptions that fixtures cannot prove.**
15. **Keep the public API stable within each implemented milestone.**
16. **Document important provider quirks next to the adapter, not as tribal knowledge.**
17. **If this implementation plan proves wrong, update the plan in the same PR as the architectural change.**

---

# 27. First-session work order

For the first implementation session in a new repository, do the following in order:

1. Read this entire document.
2. Inspect the private Homebase repository's root structure and relevant agent-related files.
3. Produce a short reuse map identifying:
   - code that can be ported with light changes
   - code that needs architectural refactoring
   - code that must remain private/out of scope
4. Scaffold the monorepo.
5. Create `packages/protocol`.
6. Define provider-neutral core types.
7. Define `AgentCapabilities`.
8. Define the normalized event vocabulary.
9. Create `packages/adapter-sdk`.
10. Define the adapter interface.
11. Add the adapter compliance test skeleton.
12. Create `apps/host` with a mock adapter and global SSE event bus.
13. Add project-root canonicalization/allowlisting.
14. Add build/typecheck/test scripts.
15. Stop only when Phase 0 is complete and Phase 1 has a working host skeleton, or when a real blocker requires human input.

Do not start by copying the private Homebase web application wholesale.

The protocol and adapter contract come first.

---

# 28. Definition of architectural success

The architecture is proven when one generic mobile client can do all of the following without provider-specific forks in its core session UI:

1. Open one project.
2. See sessions from multiple providers.
3. Start a Claude session.
4. Start an OpenCode session.
5. Start an ACP-backed Grok or Gemini session.
6. Watch all three stream through the same timeline system.
7. Approve a tool action when a provider requests it.
8. Answer a provider question.
9. Stop a running agent.
10. Change model/mode/effort only where that provider advertises support.
11. Return to a unified Attention screen and see pending work across providers.

At that point Homebase is no longer a private dashboard extraction. It is a real multi-agent control plane.

---

# 29. Product success scenario

The intended experience is:

```text
Homebase

ATTENTION
QuoteLink · Grok
Needs approval

GlassFlow · Claude Code
Question waiting

ACTIVE
Homebase · OpenCode
Working · 2m 14s
```

The developer can approve Grok, answer Claude, open the OpenCode session, send another instruction, close the phone, and later receive a completion notification.

They never need to:

- switch between vendor mobile apps
- expose source code to a Homebase cloud service
- move provider credentials to the phone
- SSH into the workstation
- use a terminal interface on mobile

That is the product Homebase is being built to deliver.

---

# 30. Revision log

Changes to this plan are recorded here with the reason. Implementation and plan must not silently
diverge (rule 17).

- **2026-09-28 — Phase 5 architecture:** Default authentication changed to `device`, including on loopback because Serve can proxy loopback. The permanent browser credential moved from the planned JS bearer injection to a Secure HttpOnly cookie. Pair invitations use a URL fragment and POST redemption; the CLI uses a separate machine-local admin key. Device records use versioned atomic JSON with only SHA-256 digests. Serve, not Funnel, is the recommended private HTTPS path. Browser/PWA seamless cookie handoff begins with iOS/iPadOS 17.2. Phase 4.3 viewport containment remains, but user zoom has been restored.

- **2026-09-27 — Phase 0/1 implementation refinements.**
  - **§7.1:** added `unknown` to `AgentSession.state`. Transcript-backed providers cannot always report
    the run state of a persisted session when the Host starts; `unknown` prevents a stale "Working"
    claim. Shared UI treats it as "no active claim".
  - **§9:** finalized the adapter contract as implemented: adapters emit through `AdapterContext.emit`
    (the Host owns sequencing/fanout instead of `adapter.subscribe`), project-scoped methods receive the
    `AgentProject` record, and the compliance/testing utilities ship as
    `@homebase/adapter-sdk/compliance` and `/testing`.
  - **§25 (Phase 1):** the auth placeholder is `auth.mode: "dev-token"` (constant-time comparison,
    throttled failures) with a refuse-to-start invariant: a non-loopback bind without authentication
    fails configuration validation. Device pairing remains Phase 5.
  - **Phase 1 status:** Host core implemented with a global sequenced event bus, SSE replay/resync,
    canonical project allowlisting, mock provider registration, and stable errors; covered by 54 Host
    tests plus protocol/adapter-SDK suites.

- **2026-09-27 — Phase 2 (OpenCode reference adapter + provider-neutral contract corrections).**
  - **§9:** the adapter contract gained a required `listMessages(sessionId, page?)` returning
    `AgentPage<AgentMessage>`; `listSessions(project, page?)` now returns `AgentPage<AgentSession>`
    (opaque cursors, bounded pages); and an optional `queue(sessionId, input)` gated by the existing
    `queue` capability. Send/steer/queue are distinct neutral operations.
  - **§8:** added `message.updated` (full message snapshot when parts change mid-turn, for example tool
    calls); `message.delta` remains the text streaming mechanism.
  - **§7:** `AgentModel.inputCapabilities` (`text`/`image`/`file`) lets per-model input support refine
    provider-level `attachments`/`imageInput`; image/file parts may omit `attachmentId` when a provider
    exposes only historical attachment metadata.
  - **Attachments:** the Host owns an ephemeral attachment store (multipart upload, MIME allowlist,
    magic-byte checks, size caps, TTL/LRU cleanup, no disk writes). Adapters receive bytes through
    `AdapterContext.resolveAttachment`; clients never provide paths.
  - **OpenCode:** `packages/adapter-opencode` implements the adapter against OpenCode 2.0.18's `/api/*`
    server API and is a default Host registration; `plans`, `usage`, and `slashCommands` are honestly
    declared unsupported/deferred.
  - **Live checks:** `HOMEBASE_TEST_OPENCODE=1` verified detection, catalogs, session lifecycle,
    streaming, history reload, resume, interrupt, and diffs against OpenCode 2.0.18.

- **2026-09-28 — Phase 3 (Claude adapter + multi-provider identity).**
  - **§9/§4 (identity):** public session, approval, and question ids are now provider-scoped
    (`hb1~<providerId>~<base64url(nativeId)>`, via `@homebase/adapter-sdk`). The Host routes by
    decoding trusted provider scope and no longer probes adapters for session ownership; provider
    failures surface instead of being swallowed as "maybe another provider owns it". OpenCode, mock,
    and the example adapter were migrated in the same change.
  - **Detection privacy:** the compliance suite now recursively rejects sensitive
    credential/identity fields (including email-like values) instead of substring-matching warning
    text.
  - **Claude Code transport:** direct `claude` child process with documented stream-json, not the
    Agent SDK and not the private HTTP bridge. The user's CLI owns authentication; Homebase ships no
    Anthropic SDK, no login flow, and no API-key requirement.
  - **Claude approvals/questions:** MCP permission-prompt broker over a loopback-only, token-guarded
    channel; session-scoped in-memory "always" rules; deny messages reach the model and do not fail
    the run. `--strict-mcp-config` keeps personal connectors out of Homebase sessions (live-verified).
  - **Claude capabilities:** streaming, interrupt, steer (`priority:"now"`), queue (`priority:"next"`),
    resume, models/effort via the CLI's own `initialize` catalog, live model/mode switching over
    control requests, image input, tools, approvals, questions, and usage from `rate_limit_event`.
    `plans`, `diffs`, `attachments` (non-image), `deleteSession`, and `slashCommands` stay false.
  - **Testing:** fake-CLI compliance suite for normal runs, live suite (`HOMEBASE_TEST_CLAUDE=1`)
    verified against Claude Code 2.1.268, and Host multi-provider coverage with colliding native ids.

- **2026-09-27 - Phase 4 (mobile web client and normalized live UX).**
  - **Correction A15 (pending actions read model):** `SessionService` now retains complete normalized
    `AgentApprovalRequest`/`AgentQuestionRequest` objects (not just routing ids) and drops them on
    resolution, session deletion, or a terminal turn. `GET /api/v1/sessions/:sessionId/actions`
    returns them oldest-first so approval/question cards survive a browser reload. The mock adapter now
    emits resolutions when a pending request is aborted.
  - **Correction A16 (provider refresh):** `POST /api/v1/providers/refresh` re-runs detection, publishes
    the resulting provider events, and returns the refreshed list, so a signed-out Claude or stopped
    OpenCode server can recover without restarting Homebase.
  - **Static serving:** the Host serves `apps/web/dist` (SPA fallback for deep links, immutable hashed
    assets, revalidated shell, `/api/*` never falls back, traversal blocked, dev message when unbuilt).
  - **Web client (`@homebase/web`):** Vite 8 + React 19 + Tailwind v4 + TanStack Router/Query + Zustand;
    design tokens with light/dark/system, installable PWA with an app-shell-only service worker that
    never touches `/api/*`; provider-neutral Projects -> Sessions -> Chat navigation.
  - **Networking:** typed REST client and a fetch-based SSE client (native `EventSource` cannot carry
    `Authorization`), one global event stream, sequence replay via `?since`, `ready`/`resync` handling,
    visibility reconnect for iOS, and event-driven query invalidation instead of polling.
  - **Live UX:** global overlay reducer with sequence de-duplication; streaming text with smooth
    reveal; tool rows, reasoning disclosure (content-driven, not provider-driven), run folding into
    "Worked for …"; optimistic user messages pruned against fetched history; capabilities drive
    queue/steer/stop, attachments (images vs files), model/mode/thinking pickers, diffs, and deletion.
  - **Mock/test architecture:** `?mock=<scenario>` installs a deterministic transport and event script
    for browser use; unit suites cover the SSE parser, overlay reducer, invalidation map, timeline
    folding, capability gating, and token contrast; Playwright covers the mobile journey, quality gates,
    and resilience against 402x874. Mock fixtures are fictional and excluded from production bundles.
  - **Limitations carried forward:** pairing/login, Attention/Activity, and usage rendering belong to
    later phases; queue/steer and approval denial remain verified at the adapter/fixture level rather
    than live UI runs.


- **2026-09-28 - Phase 4.1 (mobile UI craft pass).** Warm "evening instrument" tokens, a rebuilt rem type
  scale that respects Dynamic Type, project monograms, an inline session launcher on the project screen, a
  chat heading and a full-width composer whose actions sit on a toolbar below the text. Screenshot QA
  (`npm run screenshots -w @homebase/web`) and design-regression tests were added. Web-only; no protocol change.

- **2026-09-28 - Phase 4.2 (AI-native components and final polish).** Web-only; no protocol or adapter change.
  - **Beautiful UI integration:** Loading State (Orbit), Thinking, Tool Chips, Task Rows, Approval Card, Prompt
    Bar, Recommendation Card and Code Block (MIT, © Shane Levine) are adapted in
    `apps/web/src/components/beautiful/` and driven only by normalized `Agent*` state; demo timers, scripted
    content, `@` sources, slash commands, dictation and the Prompt Bar shader were removed. Provenance is in
    `THIRD_PARTY_NOTICES.md`.
  - **Execution trace:** each run is one narrative. Live: Orbit until anything is visible (elapsed time from
    `turn.started`, recorded in the live overlay as `runStartedAt`), then Thinking (fold-ripple `Brain`, adapted
    from Lucide-React-Motion and looping only while reasoning streams), Task Rows for tools and plan steps, then streaming text. Finished:
    "Worked for …" folds Thinking, interim updates and Tool Chips, whose rows still expand to input, output and
    error.
  - **Rules:** no confidence is shown or inferred (the protocol has none); the Recommendation Card is used only
    for a single `confirm` question; Code Block diff mode is used only for real `AgentDiff` patches.
  - **Fix:** syntax highlighting had never run — asking Shiki's web bundle for `diff` made the highlighter reject.
    Code is now tokenised (no HTML injection), cached, and preloaded; plain and highlighted renders share one
    layout.
  - **Polish:** warm app icon and a service-worker cache bump, text-scaled but capped marks, roomier list rows,
    and a "Worked for …" chevron that wraps with its summary.
