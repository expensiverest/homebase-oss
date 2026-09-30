# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private vulnerability reporting for this repository
(**Security** tab → **Report a vulnerability**) so the maintainers can assess and fix the issue before disclosure.

Include:

- a description of the issue and its impact,
- reproduction steps or a proof of concept,
- the Homebase version/commit and your platform (Windows, macOS, Linux),
- any relevant logs with secrets, tokens, and personal paths removed.

## Scope

Homebase is a control plane for software that can read files, modify repositories, and run shell commands. Reports
that are especially valuable include:

- ways the browser can cause an agent to run in a directory outside the configured project roots,
- ways provider credentials, tokens, or credential files can be read through the API, logs, or diagnostics,
- ways the Host can be reached without authentication when it is not intentionally exposed,
- ways a paired device credential can be forged, replayed, or escalated,
- injection through agent output (markdown, tool output, file contents) into the web client,
- denial of service against the Host or a provider process.

Out of scope:

- vulnerabilities in the provider CLIs themselves (report those to the provider),
- deployments where the operator intentionally exposes Homebase to the public internet,
- issues that require a compromised local machine or a compromised provider account.

## Supported versions

Homebase is pre-alpha. There are no supported release versions yet; security fixes land on `main`.

## Security model summary

- The Host binds to `127.0.0.1` with per-device authentication by default. Non-loopback binds require authentication.
- Provider credentials never leave the machine and are never returned by the Homebase API. OpenCode managed servers
  use an in-memory random password; Grok keeps its own login and Homebase stores no xAI credentials.
- Project paths are canonicalized and checked against Host-configured roots before any provider process starts. Only
  the local `homebase projects` CLI can change those roots; no browser request can.
- Remote access is expected through private Tailscale Serve with HTTPS and Homebase pairing, not Funnel or router port forwarding.
- Provider processes are spawned without a shell; ACP agents get no filesystem or terminal client capabilities.
- Secrets are redacted from logs and diagnostics where practical.
- Background services run as the current user, never root/LocalSystem by default. Definitions persist absolute
  executable/config/state paths and sanitized PATH, without provider keys or device/admin credentials.
- Local-admin status/shutdown require an actual loopback socket, the machine key, no Origin, and no proxy
  headers. Paired browsers cannot use them. Uninstall preserves state by default, with explicit guarded purge;
  no network self-updater exists. See [service boundaries](docs/service.md).
