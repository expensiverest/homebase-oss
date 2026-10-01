# Phase 6.1 validation

Validated on Windows on 2026-09-30. Base: `441dd79b07e4b53958c7959d7d3b91ed35283e93`
(Phase 6, PR #5). Branch: `sol/phase-6-1-dogfood`. This milestone is for final review;
it does not implement Gemini, file editing, an Activity feed, distribution, or a network updater.

## Provider evidence

| Provider    | Installed version | Primary source inspected                                                                                                                | No-model live result                                                                                                                                                                                                           |
| ----------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code | 2.1.268           | [Headless CLI](https://code.claude.com/docs/en/headless), [cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking)      | Version/auth status parsed without identity output. Account limits remain unavailable before a rate-limit observation.                                                                                                         |
| OpenCode    | 2.0.18            | [Versioned source](https://github.com/anomalyco/opencode/tree/v2.0.18), including Agent, SessionProjector and TokenUsage; local OpenAPI | Build/Plan discovered; Plan selected and recovered on a reopened empty session; native zero consumption validated. An existing session also returned valid positive token totals and reported cost. No quota endpoint exposed. |
| Grok Build  | 1.0.41 alpha      | [Official source](https://github.com/xai-org/grok-build), usage ledger/extension dispatch; installed ACP initialize                     | Stable ACP v1, `grokShell` extension-family advertisement, and recognition of `_x.ai/session/usage` verified. A deliberately nonexistent session returns structured ResourceNotFound; no prompt sent.                          |
| ACP         | SDK 1.5.1         | [Stable usage update contract](https://agentclientprotocol.com/protocol/session-update), installed SDK schemas                          | Stable context updates covered by deterministic fixtures. Experimental prompt-response usage is not relied upon.                                                                                                               |

The inspected OpenCode tag resolves to `cd9a14a6b688d4021bee381dfd39d2cef9c0f862`.
Grok's installed commit was not available in public source; the public source and installed
extension handshake are separate evidence. New Grok consumption payloads are fixture verified,
not claimed as live paid-turn verification. No model inference, account-site scraping, credential-file
inspection, or provider login was performed. Actual account identities, usage values, session IDs,
project names, paths and contents were not captured in committed fixtures.

## Claude chronology

Cold history previously collected user messages first, appended accumulated assistant messages afterward,
and sorted by timestamps. Equal timestamps and fallback times could place answers before their prompts.
The transcript's line sequence now reserves an assistant slot at first occurrence; subsequent content and
tool frames update that slot. Missing timestamps use the preceding timestamp or an epoch value without
changing order. String and text-block user input are accepted, including text alongside tool results.

The adapter retains the newest-first pagination contract. The web reverses provider history and merges
ordered live messages using shared message identities as anchors. Optimistic prompts and accepted echoes
are reconciled within the corresponding anchor interval, rather than against arbitrary old identical text.
Assistant snapshots replace their slot without moving it. Accepted Claude user messages are emitted after
stdin accepts them. Older pages prepend without timestamp sorting or scroll-position changes.

The synthetic two-turn transcript exercises user A → assistant A → user B → assistant B with equal/missing
timestamps through cold read, both pages, two reloads and web/live overlap. Additional tests cover repeated
identical prompts, differently persisted user IDs, accepted echoes, and mixed user/tool-result blocks.

## Modes and usage contracts

OpenCode's selectable concepts are non-hidden agents whose mode is `primary` or `all`; subagents are excluded.
The catalog is scoped by `location[directory]`. An initial catalog can be empty while the location initializes.
Discovery warms the model catalog and retries an empty agent catalog with a short bound. `Session.Info.agent`
is the selected mode. Build and Plan are upstream values, not Homebase-invented choices.

The Mode capability describes provider support. A known empty catalog hides the chat picker; the shared sheet
also has explicit loading, empty and error states. Apply requires a selected catalog entry and is disabled
while loading or on error. Tests cover all these states, current selection and application.

`AgentTokenUsage`, `AgentTurnUsage` and `AgentSessionUsage` describe consumption separately from
`AgentProviderUsage` account windows. Input includes cache subsets; output includes reasoning when the native
accounting requires reconciliation. Unknown counters, money and context remain absent/null. Percentages are
finite and bounded, and consumption schemas reject unknown fields. `partial` identifies incomplete history.

Every adapter, mock and example must implement `getSessionUsage(sessionId)` and `getProviderUsage()` and declare
`sessionUsage`/`providerUsage`. Unsupported methods return null. Compliance validates declarations, schemas,
provider/session identity and unsupported null behavior; provider-specific fixtures verify available payloads.
`turn.completed.usage` now means turn consumption. Account windows retain `usage.updated`; observed session
consumption can emit `session.usage.updated`. Terminal events invalidate session usage independently of quotas.

| Provider | Session consumption                                                                                                                                                  | Account limits                                                                                                                                                  | Limits on completeness                                                                                                                                                                                                                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | Final result tokens replace repeated assistant snapshots. Native message IDs deduplicate input/cache calls. Cumulative process cost replaces earlier process totals. | Latest observed `rate_limit_event.unifiedWindows`, including reset times and model windows. Expired observations disappear without fabricated zero utilization. | Final token usage covers the main loop, not subagents. Historical assistant output may be a placeholder, so only input/cache are restored; historical cost/output stay unknown. Installed 2.1.268 resets process spend on resume; observations retain prior spend. Restored cumulative spend in 2.1.277+ is source/fixture verified. Error-result zeros do not erase prior spend. |
| OpenCode | Cumulative Session.Info tokens/cost are authoritative. Cache/reasoning are reconciled once; message totals are never added again. Reopened session usage works.      | Explicitly unsupported: no account quota, subscription-window or credit API in the inspected version.                                                           | Missing native counters cannot establish inclusive totals; no Homebase pricing estimate. Provider-reported cost may itself be an estimate.                                                                                                                                                                                                                                        |
| Grok     | Stable ACP context `usage_update`; advertised x.ai ledger extension supplies tokens/cost when recognized. Validated totals/subsets; unknown payloads ignored.        | Explicitly unsupported: no structured account-limit surface found.                                                                                              | Extension ledger is current ACP-process consumption, including resumed sessions, not restored historical totals. Partial/incomplete cost stays unknown. The extension is isolated in adapter-grok; generic ACP remains neutral.                                                                                                                                                   |

Projects has a one-tap account Usage sheet for installed providers. Session headers show compact available
consumption and a details sheet. Both are capability driven, with no provider-ID branches in shared rendering.
Reset times, observed age, partial accounting and unsupported observations are explained. TanStack Query caches
observations for 30/60 seconds and refreshes on relevant events/history reload or explicit action, not fast polling.
Refreshing never starts an inference run.

## Projects and Files

`GET /api/v1/projects/overview` returns five recent projects and configured folders.
`GET /api/v1/project-roots/:rootId/projects` returns one folder's summaries. IDs derive from canonical paths;
the browser supplies IDs, never root paths. The most-specific configured root owns each project once, including
nested roots and repositories at a root. Folder lists sort by activity descending, then name/ID deterministically.
Unavailable roots remain visible. Same-name folders can be distinguished by their displayed location.

Private atomic `project-activity.json` stores only project IDs and monotonic coding timestamps. Session creation,
accepted sends, turn starts, session updates and newer provider history advance it. File viewing and filesystem
mtime do not count. Bursts coalesce; shutdown flushes persistence. Stale IDs are ignored when rendering.
Counts are the Host's known session index, not a fabricated complete provider census. A fresh installation learns
historical activity when that provider history is opened; overview does not start providers or query every project.
The former per-row `useSessions` calls are gone.

Files complements the existing project launcher. Routes use `/p/:projectId/files` with a relative `path` and
folder/file selection. Folder context survives navigation back to project/root/Projects. Listing, current-folder
filter, bounded breadcrumbs, filenames, metadata and source viewers fit mobile touch and safe areas.

The read-only authenticated API is `projects/:projectId/files`, `file` and `file-bytes`. There are no write,
execute, terminal or git-mutation endpoints. ProjectRegistry selects the canonical root. Absolute/drive/UNC
paths, NUL, traversal, backslashes, encoded separators and malformed components are rejected. Existing targets
must realpath inside that exact project; another allowed project is not a permitted escape. Replaced project roots
fail closed. Outside symlinks, junctions and nested escapes are unavailable without disclosing target paths.

Directory listing is nonrecursive and bounded to 500 entries, with truncation indicated. Only `.git` is hidden;
generated/source directories are otherwise truthful. Only regular files can be opened. Text preview is limited to
1 MiB, raster bytes to 10 MiB. File handles are rechecked before bounded reads; POSIX NOFOLLOW/NONBLOCK protect
final links and replacement pipes. Tests also delete a file or swap a directory to an outside junction during open.
These checks are not a sandbox against a malicious process with the same OS-user privileges.

HTML is escaped source; Markdown uses the existing sanitized renderer with Source/Rendered selection. Raster
signatures are checked for PNG/JPEG/WebP/GIF and fetched with credentials into revoked object URLs. SVG, PDF and
arbitrary binary content remain unsupported. Large files show metadata rather than contents. Mobile rendering
is further bounded to 2,000 lines/200,000 characters; large blocks bypass highlighting. No project HTML, SVG script,
iframe, raw HTML injection, or project executable runs.

Pairing now grants read access to files inside configured projects, including secret files there. Homebase does
not pretend filename hiding is secret protection. API responses are no-store; the service worker excludes all
API paths. File query data has no retained unmounted cache, image URLs are revoked, and auth loss clears query,
live and highlighted-source memory. File contents never enter logs or diagnostics. Security/threat-model docs
cover traversal, reparse escapes, size bounds, inert rendering, caching and the enlarged pairing trust boundary.

## Verification

Normal suites use deterministic providers, temporary project/state fixtures and injected OS runners. They do not
install native tasks, alter Serve, pair real devices, or consume quota. Live gates are separate and selected by filename.

| Suite                  |  Passed | Skipped |   Total |
| ---------------------- | ------: | ------: | ------: |
| Host                   |     376 |       3 |     379 |
| Web unit               |     106 |       0 |     106 |
| Claude                 |      51 |      10 |      61 |
| OpenCode               |      76 |       7 |      83 |
| Grok                   |      75 |       3 |      78 |
| Adapter SDK/compliance |      74 |       0 |      74 |
| Protocol               |      28 |       0 |      28 |
| ACP transport          |      20 |       0 |      20 |
| Example adapter        |      16 |       4 |      20 |
| **Total (Windows)**    | **822** |  **27** | **849** |

`npm run verify` includes build, all typechecks, these suites, lint and formatting.
The POSIX special-file case is skipped on Windows; opt-in native/provider suites remain skipped in ordinary CI.
Full mobile Playwright: **87 passed** (Phase 6 baseline 78). Full screenshot composition QA: **60 passed**
(all existing 40 retained plus 20 new theme/state cases). Images were inspected deliberately; the screenshot suite
is composition QA, not blind pixel-baseline regeneration. An extra WebKit mobile run passed all **9** new journeys.
Dark mode, 130% text, reduced motion, 44px targets, overflow, natural back navigation, empty/error states and unsafe
content are covered. Physical iPhone/VoiceOver and real model turns remain the user's final dogfood pass.
`npm audit --omit=dev`: **0 vulnerabilities**. No dependency or lockfile changes.

## Windows no-model validation

The opt-in native Task Scheduler fixture and real built Host fixture both passed (**2 tests**).
The Host fixture uses a uniquely named task, alternate state/config/port, a generic repository and a fixture paired
cookie. It exercises web/status, nested-root ownership, Files, traversal and outside junction rejection, OpenCode
catalogs, persisted Recent across restart, exact install/metadata repair without interruption, restart/stop/start
and uninstall. All captured Host/provider descendant PIDs exit after stop/restart, with a bounded wait for Windows
process handles. Managed OpenCode and initialized Grok cleanup are covered; no Claude model session is created.
Task/config/project cleanup runs in finally; real user security state is untouched.

The three separate provider no-model gates passed (**3 tests**). Existing-session OpenCode API inspection additionally
validated positive consumption/cost without printing values, identity, title, source or transcript. Read-only current
Windows configuration inspection found **2 configured folders / 39 projects**, each assigned exactly once. The
existing service was installed/running; existing Tailscale was connected with the correct private HTTPS mapping.
No Serve configuration was changed and no Funnel was enabled. Primary-service/device state was preserved.

## Final review and limits

Reviewed normalized usage provenance/cumulative scopes, message identity/order, most-specific ownership,
absence of project N+1 calls, relative paths/realpath and raced-open checks, read bounds, inert HTML/SVG/Markdown,
API/SW/auth-loss caching, executable/service lifecycle and fixture privacy. Existing admin authorization and HTTP
quiescing remain unchanged. Purge only adds the Homebase-owned activity file to its strict owned-entry allowlist;
all original purge safeguards remain. No file-editing controls or new privileged/service/network machinery exist.

Remaining limits are explicit: upstream quota gaps, partial Claude/Grok historical consumption, known rather than
exhaustive session counts, capped listings/previews, browser raster-decoder resource limits, and same-user filesystem
compromise. macOS/Linux native services were not live tested in this Windows milestone; their Phase 6 regression
tests remain in ordinary verification. Final GitHub Node 22/24, Web E2E and gitleaks results belong to the PR head.
