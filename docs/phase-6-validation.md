# Phase 6 validation

Baseline: `781adf977ef7b1925c86c0c6f4c90104f55af1a9`, new branch `deepseek/phase-6-setup-service`.
Host version is 0.0.2 so upgrade/status can distinguish this milestone from the previous runtime; this is still
an unpublished pre-alpha source installation. No dependencies were added, so third-party notices are unchanged.

## Automated coverage

Normal verification builds/types/checks every workspace and runs 695 passing unit/integration tests, with
25 intentionally skipped opt-in/live cases. Host has 304 passing tests and two service suites gated off.

| Suite                                | Passed |
| ------------------------------------ | -----: |
| Setup                                |     34 |
| Service definitions                  |     21 |
| Platform managers                    |     16 |
| Service controller                   |     15 |
| Doctor                               |     18 |
| Uninstall / upgrade                  |     22 |
| Service-aware projects               |      7 |
| Admin status/shutdown/security       |     12 |
| Tailscale                            |     13 |
| Host (including existing regression) |    304 |
| Web unit                             |     87 |
| Claude                               |     41 |
| Grok                                 |     63 |
| OpenCode                             |     71 |
| Adapter SDK                          |     73 |
| Protocol                             |     22 |
| ACP transport                        |     20 |
| Example adapter                      |     14 |

Full Playwright: 78 passed. Screenshot QA: 40 passed, with no expected or committed web visual changes.
`npm audit --omit=dev`: 0 vulnerabilities. Normal CI never installs services or changes Serve; platform
mutations use fake runners/temp files, and service lifecycle suites require explicit environment gates.

## Windows smoke tests

- `HOMEBASE_TEST_SERVICE=1`: uniquely named real Task Scheduler fixture installed/queried/started/stopped,
  started again, removed, and verified absent. The owned fixture process exited after native stop/removal.
  Paths included spaces, ampersands, and literal `%PATH%`. Finally cleanup removes fixture resources.
- `HOMEBASE_TEST_HOMEBASE_SERVICE=1`: built real Host with isolated config/state/port and a unique test task.
  Install/start/health/cached providers/web/restart/stop/start/uninstall all passed. All seven captured
  Host/provider descendants from each run exited. OpenCode, Claude and Grok were detected; no Claude session
  or provider model prompt was created. Managed OpenCode and Grok ACP exited with the Host.
- Actual linked CLI: interactive setup, service status, upgrade from the initial dogfood runtime to 0.0.2,
  graceful stop (health disappeared), start, and doctor passed. Root `npm run setup` was also exercised as
  a build/link/idempotent setup path. The selected project root is not duplicated.
- Existing real Tailscale private Serve was recognized and left unchanged. Existing device state was
  fingerprinted before/after setup/upgrade and remained byte-for-byte unchanged. Pairing was deliberately
  skipped during live setup; invitation/cookie security remains covered by the Host and Playwright suites.

No paid live prompt suite ran. The intended current-user Homebase task is installed and running; namespaced
test tasks are removed. No reboot/logoff was performed; logon/autostart is defined and inspected through real
Task Scheduler. macOS/Linux native lifecycle runs remain outstanding on those operating systems; their
definitions and command sequences have portable tests.

## Security review

**Verdict: APPROVE for final repository review. Confidence: high for tested Windows behavior; medium for
native macOS/Linux behavior pending their opt-in smoke tests.** No unresolved P0/P1 findings from this review.

| Boundary              | Review conclusion                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands/quoting      | OS argv calls are bounded; Windows launcher uses fixed encoded code and data-only paths, no cmd shell. Shared Windows quoting, XML escaping, systemd percent/dollar escaping are tested.                  |
| Privilege             | User SID/InteractiveToken/LeastPrivilege, LaunchAgent, and systemd --user; no SCM Node registration, LocalSystem, sudo, or automatic lingering.                                                           |
| Service env           | Exact paths, Homebase state, and sanitized PATH only; no serialized provider API keys, admin/device secrets, cookies, or raw environment.                                                                 |
| Native ownership      | Alternate-state commands refuse mismatched services; corrupt metadata never authorizes removal/recreation. Windows native fallback captures exact-action children and verifies process creation identity. |
| Admin shutdown/status | Existing loopback socket/key/Origin/forwarding rejection applies. Valid local response completes before provider disposal/server close; paired browsers and Serve cannot invoke it.                       |
| Remote setup          | Structured status, verify-after-write, missing-only Serve mutation; conflicts/ambiguity/Funnel block mutation. No Tailscale login, public relay, or public bind convenience.                              |
| Purge                 | Confirmation, ownership marker, canonical target, ancestry/shallow/symlink/unexpected-content guards, and provider/Tailscale directory protection; rechecked before recursive removal.                    |
| Files/logs            | Atomic private state/metadata; bounded sanitized operational logs. No prompt/transcript capture by default. Windows profile ACL and same-user compromise limits are documented.                           |
| Updates               | Manual source fetch; service refresh only. No network updater, unsigned download, release publication, or invented signing system.                                                                        |
| Privacy               | New diff inspected for personal identities/paths/hostnames/project names and credentials; committed fixtures use generic identities. Real smoke-test logs stay outside committed source.                  |

Final review should focus on native platform semantics, shutdown/fallback ownership, and purge guards. Corrupt
or manually altered service definitions require inspection rather than destructive automatic repair. Reboot
behavior and native macOS/Linux execution are the remaining validation limits, not claimed test results.
