# Homebase web client

`apps/web` is the Phase 4 public mobile web client: an installable PWA that consumes only the provider-neutral
Homebase API and normalized event vocabulary. It never imports an adapter and never sees OpenCode or Claude payloads.

## Stack

- Vite 8 + React 19 + TypeScript, bundled as static assets.
- Tailwind CSS v4 with semantic design tokens in `src/styles/tokens.css` (light/dark/system).
- TanStack Router (code-based routes: `/`, `/p/$projectId`, `/s/$sessionId`, `/dev/ui`) and TanStack Query for
  server state.
- Zustand for client-ephemeral state (live event overlay, connection status, optimistic messages).
- `react-markdown` + GFM for assistant text, Shiki's web bundle for code highlighting, Lucide icons, self-hosted
  Fontsource Geist / Geist Mono / Instrument Serif.

## Data ownership

Server-owned data lives in TanStack Query and is never mirrored into Zustand:

| Query key                                          | Owns                                            |
| -------------------------------------------------- | ----------------------------------------------- |
| `providers`                                        | provider readiness and capabilities             |
| `projects`, `project`                              | project registry                                |
| `project/<id>/sessions`                            | merged, paginated session list (all providers)  |
| `session/<id>`                                     | session metadata (model, mode, thinking, state) |
| `session/<id>/messages`                            | paged history, newest first                     |
| `session/<id>/actions`                             | pending approvals and questions                 |
| `catalog/<project>/<provider>/models` and `/modes` | provider catalogs                               |
| `session/<id>/diff`, `usage/<provider>`            | optional surfaces gated by capabilities         |

Events drive invalidation (`src/lib/queries.ts`): text deltas never refetch; provider, session, approval/question,
terminal-turn, diff, usage, plan, and resync events invalidate the queries they affect. There is no polling loop and
no cache persistence — the query cache stays in memory because it contains conversation data.

## Transport and credentials

`src/lib/transport.ts` is the single injection point shared by REST and SSE. It exposes an optional bearer token now
so Phase 5 pairings can add device credentials without touching components. Tokens are never placed in URLs, query
strings, or logs; the browser tests inject credentials the same way.

## Event stream

One global stream per app, `GET /api/v1/events`, opened with `fetch` (native `EventSource` cannot send an
`Authorization` header). `src/lib/sse.ts` implements a tolerant parser (chunk boundaries, CRLF, multi-line data,
comments/heartbeats, malformed blocks) and `src/lib/live.ts` owns the connection lifecycle:

- `ready` marks the connection healthy; the first paint shows no alarming state.
- Reconnects use `?since=<highest applied sequence>`; the sequence is kept in `sessionStorage` only.
- `visibilitychange` triggers an immediate reconnect attempt because iOS suspends background networking.
- `resync` resets live overlays and invalidates every query; fetched provider history is authoritative.
- Events are de-duplicated by global sequence. Within a message, parts upsert by part id and tools by tool-call id.

## Live overlay

`src/lib/live.ts` reduces normalized events into per-session overlays (streaming message snapshots, deltas, tool
calls, running state). Chat renders `fetched history + overlay`, with overlay copies taking precedence by id. When a
turn ends, history is refetched and overlay copies that history already contains are pruned. Optimistic user messages
are pruned as soon as history contains a user message with the same text, even mid-run, so a prompt is never shown
twice.

## Pending actions

The Host keeps complete normalized approval/question requests in a read model and exposes them at
`GET /api/v1/sessions/:sessionId/actions` (oldest first, provider-neutral ids). The chat screen seeds its action
cards from that endpoint, then keeps them current through `approval.*` / `question.*` events. Answers are applied
optimistically and restored if the API reports an error, which is what makes action cards survive a browser reload
while the Host is still waiting.

## Provider refresh and status

`POST /api/v1/providers/refresh` re-runs detection and returns the refreshed list. The Projects screen and project
header use it from an explicit **Retry** action (Claude signed out, OpenCode started later); nothing polls provider
CLIs continuously. Language is provider-neutral: _Unavailable_, _Sign in required_, _Incompatible version_, _Ready_.

## Capability-driven UI

Every functional difference comes from capabilities, model metadata, mode metadata, or normalized content — never
from provider identity:

- Model, mode, and thinking/effort pickers appear only when the capability exists; thinking levels come from
  `AgentModel.thinkingLevels`, and an invalid level resets to the model default.
- Attachments: images require `capabilities.imageInput` and a model that does not reject images; generic files
  require `capabilities.attachments`. Claude keeps image input with `attachments === false`.
- Stop appears only with `interrupt`; queue and steer buttons only with `queue` / `steer`.
- Diff and delete-session controls appear only with `diffs` / `deleteSession`; the UI never runs git itself.
- Reasoning renders only when an `AgentMessage` actually contains a reasoning part.

Provider identity is used only for names and visual marks (`src/components/marks.tsx`).

## Design system (Phase 4.1)

The visual direction is "evening instrument": warm neutrals (charcoal and paper, never blue-grey), one iris accent for
actions and agent activity, and status colors only where something needs you. Tokens live in `src/styles/tokens.css`;
every text color, including status on its tinted `*-soft` background, is checked at ≥ 4.5:1 by `contrast.test.ts`.

- **Type.** Instrument Serif for screen identity only (the Projects title, a project's name, empty-state headlines);
  Geist for UI; Geist Mono for readouts (branches, paths, times, model ids). The scale is rem-based (`display`,
  `title`, `heading`, `row`, `body`, `callout`, `caption`, `eyebrow`) and nothing sets a px size on the root, so the iOS
  `-apple-system-body` root (Dynamic Type) scales the whole interface. Conversation text is 17px with 1.6 leading;
  nothing essential is below 13px.
- **Surfaces.** Inset-grouped lists on one `.surface`: a hairline border plus light from above (an inner top highlight
  in dark, a soft ambient shadow in light). Drop shadows are reserved for sheets.
- **Status.** Healthy is quiet (a muted "OpenCode · Claude Code ready" line); problems explain themselves (provider,
  what's wrong, Retry). Pills are reserved for Working / Needs you style status and branch chips.
- **Screens.** Projects is project-first with serif identity and deterministic monogram marks. A project's screen is
  its workspace: the session launcher (provider, mode, model, thinking, **New session**) is part of the screen, with
  long catalogs in sheets. Chat has a real heading, provider/state line, and a composer whose textarea always owns the
  full width; attach/Stop sit on the left of a toolbar below the text and Steer/Queue on the right, wrapping as a
  group at very large text sizes. Queue is the primary follow-up, Steer secondary, Stop a separate interruption.
- **Navigation.** There is only one root destination today, so there is no tab bar; one will arrive with the
  Attention/Activity screens rather than as placeholder tabs.

`/dev/ui` (development only) shows the type scale, colors, marks, rows, controls, buttons, a folded conversation, tool
states, action cards, attachments, and the composer idle and running.

## Agent work presentation (Phase 4.2)

Agent-facing surfaces are Beautiful UI components (MIT, © Shane Levine) adapted in
`src/components/beautiful/` and fed only normalized `Agent*` state by Homebase adapters (`ChatTimeline.tsx`,
`ActionCards.tsx`, `Composer.tsx`, `Sheets.tsx`). Provenance and what each adaptation removed are in
`THIRD_PARTY_NOTICES.md` and the folder README. Upstream demo behavior is gone everywhere: no self-running timers,
scripted stages, hard-coded content, hover-only reveals, `@` sources, slash commands, dictation or shaders.

**One narrative per run** (`activeRunView` in `lib/viewmodel.ts`, `buildTrace` for the steps):

| Moment                            | Surface                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Turn started, nothing visible yet | **Loading State (Orbit)**: "Starting…"/"Working…" with elapsed time from `turn.started`                                     |
| Reasoning streaming               | **Thinking**, open, with lucide-react-motion's `Brain` looping (`trigger="mount"`, `repeat={Infinity}`, `mode="signature"`) |
| Tools / plan in the live run      | **Task Rows** (status ring → check / cross, expandable input/output/error)                                                  |
| Text                              | streaming Markdown; the Orbit never shows beside real work                                                                  |
| Run finished                      | "Worked for …" folded; open: settled **Thinking**, interim updates, **Tool Chips**                                          |

- **Orbit** is agent activity only; ordinary loading keeps skeletons. Elapsed time comes from the real turn start
  (the live overlay's `runStartedAt`, else the prompt's time), never from page mount.
- **Thinking** renders only reasoning text the provider sent; the Brain loops only while that reasoning streams
  and is a still icon once settled. lucide-react-motion honors `prefers-reduced-motion` (the icon stays `resting`).
- **Tool Chips / Task Rows** take any `AgentToolCall`; unknown tools render generically from `toolPresentation`.
  Details mount only when opened and render as text in Code Blocks (never HTML).
- **Approval Card** renders `request.options` as full-width actions (allow once primary, deny destructive, custom
  options as-is) plus an optional note. **Questions** step one at a time with the odometer counter; a single choice
  advances but never submits on its own.
- **Recommendation Card** is used only when a request is a single `confirm` question. Its signal meter and
  alternatives drawer are optional and unused today: the protocol carries no confidence, so none is shown or
  inferred.
- **Prompt Bar** is the composer's surface: pickers above, a full-width input, attach/Stop left and Steer/Queue (or
  Send) right on a toolbar below that wraps as a group. Send/Queue change fill with readiness.
- **Code Block** tokenises with Shiki (web bundle, preloaded and cached) into text nodes; line numbers, wrapping,
  copy. Diff mode is used only for real `AgentDiff` patches in the Changes sheet.

## Visual QA

`npm run screenshots -w @homebase/web` renders the key screens at 402×874 (@3×) in both themes and at 130% text,
including Orbit, active Thinking, live tools, folded work, approval, recommendation, both prompt-bar states and a
code block, and writes PNGs to `apps/web/screenshots/` (git-ignored). It asserts composition invariants (no horizontal overflow, a
composer textarea wider than 70% of the viewport) but never compares pixels, so it is a review artifact rather than a
brittle golden-image gate. CI uploads the images as the `visual-qa-screenshots` artifact. Functional design
regressions (running composer width, long names, 130% text, large model names, quiet/loud provider health) are
covered by `e2e/quality.spec.ts`.

## Mock mode

In development, `?mock=<scenario>` installs a deterministic in-memory transport and event stream. Scenarios include
`normal`, `empty`, `many-sessions`, `active-stream`, `approval`, `question`, `failed`, `provider-down`, `signed-out`,
`reconnecting`, `resync`, `models-large`, `attachments`, `diff`, `reasoning`, `claude-image-only`,
`long-conversation`, `host-error`, and the held live turns `run-starting`, `run-thinking`, `run-tools` plus `confirm`.
Fixtures are fictional; the normal scenario deliberately includes short and
very long project names, a long branch, a long session title, mixed providers and states, and a long tool-heavy reply
so screenshots exercise the design. The module is loaded through a dynamic import behind
`import.meta.env.DEV || VITE_MOCK === "1"`, so scenario payloads are excluded from the production bundle. Playwright
E2E runs entirely on these mocks and spends no provider quota.

## PWA and caching

`public/manifest.webmanifest` and locally generated PNG/SVG icons make Homebase installable, with iOS metadata and
`viewport-fit=cover` safe-area support. `public/sw.js` caches only the app shell (hashed assets, fonts, icons,
manifest). It never caches `/api/*`, the event stream, messages, approvals, questions, attachments, or usage; its
fetch handler returns early for `/api/` and non-GET requests.

## Static serving

The Host serves `apps/web/dist` when it exists: `/api/*` always stays API, hashed Vite assets are immutable,
`index.html`/manifest/icons revalidate, unknown extension paths 404 instead of SPA-falling back, deep links return
the shell, and path traversal is blocked by resolving inside the dist root. A missing build serves a short
development instruction page instead of a confusing 404. Development runs Vite separately with an `/api` proxy to
the Host (`HOMEBASE_DEV_HOST`, default `http://127.0.0.1:8787`).

## Accessibility and motion

Buttons are semantic, icon-only controls carry `aria-label`, sheets trap focus and close on Escape while restoring
focus, and controls meet the 44px touch target. Contrast is enforced by a token test (`src/lib/contrast.test.ts`,
≥ 4.5:1 for essential text in both themes), 130% root text is covered by Playwright, and all motion collapses under
`prefers-reduced-motion`. Status is never color-only.

## Browser support

Modern evergreen browsers and iOS/iPadOS Safari 16.4+ (uses `dvh`, `visualViewport`, and safe-area insets). Desktop
is a centered, naturally expanded version of the same product.

## Known Phase 4 limitations

- No pairing, device credentials, or shared-token login UI (Phase 5). The transport accepts credentials already.
- Attention and Activity screens are later phases; the connection pill and provider warnings are the only global
  status surfaces.
- Usage (`capabilities.usage`) is fetched by the API client but not yet rendered.
- Thinking shows "Thought process" rather than a duration: the protocol has no per-part reasoning timing.
- Steer is an explicit secondary button beside Queue; the private client's press-and-hold gesture was not ported.
- Diffs are read-only; there is no git command execution from the browser.
- Queue/steer behaviour is verified against mocks; Claude/OpenCode live queue/steer proofs remain adapter-level.
