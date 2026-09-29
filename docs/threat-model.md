# Threat model (draft)

> Status: Phase 5 reassessment. Revisit before public alpha (IMPLEMENTATION_PLAN §25).
> This model describes assets, trust boundaries, and mitigations for the current implementation plus
> planned work. The original table below is retained as the earlier baseline; the Phase 5 reassessment supersedes its older status labels.

## 1. System and assets

Homebase consists of:

- **Host** (`apps/host`) — Node 22+ process on the developer's computer. Owns configuration, the project
  registry, provider adapters, event sequencing, and the REST/SSE API.
- **PWA** (Phase 4) — installable web client, untrusted from the Host's perspective.
- **Provider CLIs/servers** — Claude Code, OpenCode, Grok, Gemini, Codex, Copilot running locally with
  the user's own credentials.

Assets worth protecting, in order:

1. **The user's filesystem and repositories.** Agents can read, modify, and delete files and run
   commands. Controlling where agents run is the most important boundary.
2. **Provider credentials.** CLI logins, API keys, and saved OAuth tokens on the Host machine.
3. **Source code and transcripts.** Private code, prompts, tool output, and file contents.
4. **The Host machine itself.** Arbitrary command execution on the developer's computer is the end goal
   when a user approves it, and a catastrophic outcome when an attacker achieves it.
5. **Control channel integrity.** Approvals, questions, interrupts, and model/mode changes must be
   authentic and not replayable by a third party.

## 2. Trust boundaries

```text
[ phone / browser ]  --untrusted client-->  [ Host API ]  --trusted local-->  [ adapters ]
        ^                                        |                                  |
        |  private network (Tailscale)           |  canonical project registry      v
        |                                        |                            [ provider CLIs ]
   [ attacker on LAN/WAN ]                       +-- config/credentials (never to client)
```

- Browser input is untrusted even after pairing: strict schemas, no path fields, no provider payloads.
- Adapters are trusted code but must still normalize and sanitize provider output.
- Provider output (file contents, tool output, model text) is untrusted data: it can contain hostile
  Markdown, terminal escapes, or prompt-injection instructions aimed at the model.
- The local network and public internet are hostile; loopback-only defaults plus a private overlay is
  the expected transport.

## 3. Threat table (pre-Phase 5 baseline)

| #   | Threat                                                                                               | Impact                                            | Mitigation                                                                                                                                                                                          | Status                                        |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| T1  | Malicious/compromised client submits an arbitrary working directory and makes an agent run elsewhere | Code execution / data theft outside allowed roots | Strict input schemas reject unknown keys; projects resolved only by the Host registry; `PathAllowlist` canonicalizes + checks every path; adapters receive `AgentProject`/`resolveProjectPath` only | Implemented, tested                           |
| T2  | Symlink or `..` escape from a configured root                                                        | Same as T1                                        | `realpath` canonicalization before containment checks; sibling-prefix and escape tests                                                                                                              | Implemented, tested                           |
| T3  | Host exposed to a network without authentication                                                     | Full remote control of the machine                | Non-loopback bind with `auth.mode=none` refuses to start; default bind `127.0.0.1`                                                                                                                  | Implemented, tested                           |
| T4  | Credential theft through the API or logs                                                             | Provider account compromise                       | Provider config never returned; detection output checked for credential shapes; `redactSecrets` in logs; no secrets in health/config summaries                                                      | Implemented (redaction is best-effort)        |
| T5  | Token guessing / brute force against the auth placeholder                                            | Remote control                                    | Constant-time comparison, ≥32-char tokens, per-client failure throttling with `429`                                                                                                                 | Implemented                                   |
| T6  | Unauthenticated health endpoint leaks topology                                                       | Reconnaissance                                    | Health returns status/version/uptime/sequence only                                                                                                                                                  | Implemented                                   |
| T7  | Session id guessing to reach another session                                                         | Cross-session data access                         | Sessions are routed by Host index/adapters; ids are opaque; adapter calls are scoped by provider; no cross-provider id interpretation                                                               | Implemented (single-user model)               |
| T8  | Hostile Markdown/HTML in model or tool output executes in the PWA                                    | XSS / session theft                               | Protocol carries data only; Phase 4 must sanitize Markdown and never render raw HTML; tool output escaped                                                                                           | Planned (Phase 4)                             |
| T9  | Approval/question replay or forgery by a network attacker                                            | Unauthorized tool execution                       | Auth required for all API routes when exposing the Host; request ids are Host-issued and single-use (adapters reject unknown/duplicate ids)                                                         | Partial (auth placeholder; pairing Phase 5)   |
| T10 | Prompt injection through repo content makes an agent take dangerous actions                          | Unintended file/system changes                    | Approvals surface dangerous actions to the user; bypass permission modes are never enabled by default; adapters must not auto-approve                                                               | Implemented as policy; adapter-dependent      |
| T11 | Large bodies/attachments exhaust Host memory                                                         | DoS                                               | 1 MiB API body limit; schema limits; attachment caps (MIME/size) specified for Phase 2+                                                                                                             | Partial (upload limits land with attachments) |
| T12 | Oversized or malformed provider streams crash the Host                                               | DoS / instability                                 | Adapters ignore unknown frames; Host bus isolates listener errors; provider failures become normalized errors, not crashes                                                                          | Implemented                                   |
| T13 | Event stream tampering / spoofed sequences                                                           | Client confusion, replay attacks                  | Sequences assigned only by the Host after adapter emission; SSE clients cannot publish                                                                                                              | Implemented                                   |
| T14 | Host process termination leaves sessions stuck "working" forever                                     | Misleading state; user misses failures            | Adapters must emit terminal events on process failure; session state derives from `turn.*`; mock and future adapters include failure tests                                                          | Policy + partial                              |
| T15 | Cached private data on shared devices/browsers                                                       | Data exposure                                     | `cache-control: no-store` on all API responses; service worker must not cache session data (Phase 4 requirement)                                                                                    | Partial (no-store now; SW rules Phase 4)      |
| T16 | Dependency supply chain compromise                                                                   | Code execution                                    | Minimal dependency set; lockfile + `npm ci` in CI; secret scanning workflow; dependency review before alpha                                                                                         | Partial (CI present; review pending)          |
| T17 | Untrusted local processes call the Host API                                                          | Privilege escalation on the host                  | Loopback bind means other local users/processes can reach it; pairing/device credentials (Phase 5) and OS user isolation limit exposure; do not run the Host as a privileged user                   | Open design item                              |
| T18 | Model/usage data leaks via `provider.event` passthrough                                              | Information exposure                              | `provider.event` is an explicit escape hatch; shared UI must not render it; adapters must not put credentials in it                                                                                 | Policy                                        |

## 4. Out of scope (documented)

- Vulnerabilities in provider CLIs/SDKs themselves (report to the provider).
- Operators who deliberately bind to a public interface with weak credentials.
- Compromised developer machine (an attacker with local code execution can read all local state).
- Multi-user or multi-tenant isolation; Homebase is a single-user control plane in early releases.

## 5. Phase 5 reassessment

- **T3:** Device auth is now the default even on loopback. Tailscale Serve can expose a loopback service, so the non-loopback invariant alone was insufficient. Recommended transport stays private HTTPS Serve with device auth; `none` remains an explicit development mode.
- **T5:** Each device has 256 bits of random secret, only a SHA-256 digest is persisted, and comparison is constant-time. Failed auth and pairing attempts are throttled. The shared Serve loopback address cannot lock out valid credentials.
- **T7:** All project, parent/child session, transcript, attachment, action, provider refresh, and SSE routes pass the same auth middleware. Public provider-scoped IDs are routing metadata, not authorization.
- **T8:** Raw Markdown HTML is disabled, link schemes are filtered, and tool output is text. The permanent cookie is HttpOnly, reducing credential theft if a future rendering bug occurs. CSP blocks inline/eval scripts and external origins. Continued hostile-output testing is needed before public alpha.
- **T9:** Device auth covers approvals and questions; same-origin mutation checks and single-use provider action handling prevent ordinary cross-site submission and replay. Tailscale Serve is a trusted local proxy hop for external-origin reconstruction only when the actual socket peer is loopback; forwarded headers from other peers are ignored. A compromised paired browser still has full single-user control.
- **T15:** API responses are no-store and the service worker ignores `/api/*`. Auth loss stops the stream, clears the in-memory query cache and live overlays, and removes private screens. Browser memory and OS-level snapshots remain outside app control.
- **T17:** Loopback requests now require a device credential, materially reducing access from unrelated local processes. The local admin credential is stored in the private user state directory, and admin endpoints reject reverse-proxied traffic even if it arrives over loopback. Device cookies have a one-year sliding browser lifetime but remain revocable immediately on the Host. A malicious process running as the **same OS user** can generally read that user's Homebase state and is outside the meaningful protection boundary. Windows ACLs depend on the selected profile/state directory.

## 6. Open items before public alpha

1. Additional hostile-output and provider fixture privacy audit.
2. Per-device, burst-friendly limits for expensive agent operations.
3. Windows ACL verification on shared-account deployments.
4. Secret scanning and dependency review in CI before public alpha.
