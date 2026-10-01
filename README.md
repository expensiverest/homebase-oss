# Homebase

Homebase is a local-first, mobile-first control plane for AI coding agents running on your own computer.

Your development machine stays the execution environment. Your phone becomes the control surface. Homebase gives
Claude Code, OpenCode, Grok Build, Gemini CLI, Codex CLI, GitHub Copilot CLI, and future agent adapters one coherent
mobile experience for projects, sessions, streaming output, approvals, questions, diffs, models, and usage.

> **Status: pre-alpha (0.0.x).** The provider-neutral protocol, adapter SDK, Host core, OpenCode, Claude Code, and
> Grok Build adapters, the generic ACP v1 transport, and the Phase 5 device-paired mobile web client (installable
> PWA) are being built in the open. No public release exists
> yet. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the authoritative plan and
> [docs/web-client.md](docs/web-client.md) for the client architecture.

## Why Homebase

- **One interface, many agents.** Projects and sessions are first-class across providers instead of being locked
  inside each vendor's app.
- **Your machine does the work.** Source code, provider CLIs, credentials, and transcripts stay on your computer.
- **Phone-appropriate control.** Approvals, questions, plans, diffs, and interruption are structured surfaces, not a
  terminal crammed into a mobile browser.
- **Capability-driven, not lowest-common-denominator.** The UI only shows what the selected provider actually
  supports. Unsupported features stay unsupported rather than being faked.

## Supported providers

| Provider           | Integration                                         | Status                                                |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------- |
| OpenCode           | Native server HTTP + SSE adapter (Homebase-managed) | **Available (beta)** — verified against 2.0.18        |
| Claude Code        | Structured CLI subprocess + MCP approval broker     | **Available (beta)** — verified against 2.1.268       |
| Grok Build         | Generic ACP v1 transport (`packages/transport-acp`) | **Available (beta)** — ACP v1 verified against 1.0.41 |
| Gemini CLI         | Generic ACP transport                               | Planned (Phase 7)                                     |
| Codex CLI          | Application-server protocol                         | Later                                                 |
| GitHub Copilot CLI | Official SDK / structured interface                 | Later                                                 |

The Host ships with a deterministic **mock provider** so the protocol, event bus, and client can be developed and
tested without any paid provider runs.

## Where things run

Projects opens with Recent coding activity and configured Folders instead of one long repository list.
Open a folder to browse its projects. Each project also has a read-only **Files** view for code, safe
Markdown, and common raster images; HTML stays source, and oversized/unsupported files show metadata.
Pairing grants read access to files inside configured projects, including files that contain secrets.

Sessions show reported token/cost details where the provider exposes them. **Usage** on Projects shows
account quota windows where available: Claude's latest observed rate-limit events are supported;
OpenCode and Grok currently do not expose account limits. Unavailable values remain unavailable.

- **Host** (`apps/host`): a Node.js 22+ process on your computer. It owns configuration, the project registry,
  provider adapters, the normalized event bus, and the REST/SSE API.
- **Web client** (`apps/web`): an installable PWA served by or pointed at the Host. It never talks to provider
  processes directly.

Provider credentials are never sent to the browser and are never part of the Homebase API. The phone authenticates to
Homebase; the provider CLIs authenticate themselves, on your machine, exactly as they do today.

## Security posture

- The Host binds to `127.0.0.1` by default. Public-internet exposure is never the default and is not recommended.
- Device authentication is the default, including on loopback. Run `homebase pair` on the Host to pair a browser; the permanent credential is an HttpOnly cookie and each device can be revoked.
- For remote access, use **Tailscale Serve** over the private tailnet: `tailscale serve --bg 8787`, then `homebase pair`. See [remote-access.md](docs/remote-access.md). Never use Funnel or port forwarding.
- Projects are resolved from a Host-owned registry. The browser cannot submit an arbitrary filesystem path to start
  an agent.
- See [SECURITY.md](SECURITY.md) and `docs/security.md` for details.

## Install from source (pre-alpha)

A packaged public release does not exist yet. Install Node.js 22 or later and the provider CLIs you want to use,
and sign in through those CLIs. Tailscale is needed for private phone access.

```bash
git clone https://github.com/expensiverest/homebase-oss.git
cd homebase-oss
npm install
npm run setup
```

`npm run setup` builds all workspaces, links `homebase` using npm's standard workspace mechanism, and opens the
terminal wizard. It validates configuration, asks for one or more project folders, detects provider versions and
sign-in state without sending model prompts, offers private Tailscale Serve, installs a user background Host,
and offers a pairing QR. If Tailscale is disconnected, run `tailscale up` yourself and rerun setup.

Setup can also review or repair an existing installation. It preserves custom settings and paired devices,
deduplicates canonical project roots, recognizes existing Serve, and refreshes the same service. Partial failures
preserve completed work and give guidance. Once the service is running, you can close the terminal.

| Platform | User background service                 | Startup              |
| -------- | --------------------------------------- | -------------------- |
| Windows  | Task Scheduler task `Homebase Host`     | Current user's logon |
| macOS    | launchd LaunchAgent `com.homebase.host` | User GUI session     |
| Linux    | systemd user unit `homebase.service`    | User session         |

No administrator/root account is used. Where the user service manager is unavailable (for example, a minimal
container), run `homebase` in the foreground. Linux setup does not enable lingering; see
[service operations](docs/service.md) for headless session guidance. macOS and Linux definitions have portable
fixture coverage; real service-manager validation for this milestone was performed on Windows.

Normal operation from any directory:

```text
homebase --help
homebase service status
homebase service start
homebase service stop
homebase service restart
homebase doctor
homebase doctor --json
homebase pair
homebase projects add <folder>
homebase projects remove <folder>
```

Project changes restart a running Homebase service after the config is committed; duplicates do not restart it.
Use `--no-restart` to defer a restart. A manually running Host still needs a manual restart.

Configuration lives at `${HOMEBASE_STATE_DIR:-~/.homebase}/config.json`; a legacy `./homebase.config.json` is
migrated once and preserved. `--config <path>` and `HOMEBASE_CONFIG` win. The service records that exact config
and state directory, absolute Node/entrypoint paths, and a sanitized PATH. It does not copy shell API keys;
use provider-owned saved login. Keep `HOMEBASE_STATE_DIR` set when managing a custom state location.

During pre-alpha, fetch source updates yourself, run `npm install` and `npm run build`, then `homebase upgrade`
to refresh/restart the service and verify its version. `npm run setup` is also a repair/refresh path. Homebase
does not fetch updates, publish an npm package, or download release archives.

`homebase uninstall` gracefully stops and removes the background service while preserving Homebase state,
provider installations/logins, project repositories, and Tailscale. `homebase uninstall --purge-state` requires
confirmation and refuses unsafe or unowned directories. Remove the linked command with `npm run unlink:cli`
in the checkout, then remove the source checkout yourself if desired.

For development, `npm run link:cli` remains available. It builds and links without running the wizard.

Direct Node invocation stays available as a development fallback:

```bash
node apps/host/dist/index.js pair
```

If the OpenCode CLI is installed, the Host normally starts its own private loopback OpenCode server; no second
terminal is required. Set `providers.opencode.config.serverMode` to `"external"` to keep pointing at a server you
manage yourself. Grok Build is detected when `grok` is installed and signed in; Homebase never stores xAI
credentials.

For unauthenticated development, explicitly set `HOMEBASE_AUTH_MODE=none` while keeping the Host loopback-bound. Health check:

```bash
curl http://127.0.0.1:8787/api/v1/health
```

## Documentation

- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the implementation source of truth
- [docs/architecture.md](docs/architecture.md) — architecture overview
- [docs/protocol.md](docs/protocol.md) — provider-neutral protocol
- [docs/adapters.md](docs/adapters.md) — adapter SDK and compliance suite
- [docs/private-homebase-reuse-map.md](docs/private-homebase-reuse-map.md) — audit of the private reference implementation
- [docs/security.md](docs/security.md) — security model
- [docs/remote-access.md](docs/remote-access.md) — Tailscale Serve and pairing
- [docs/service.md](docs/service.md) — setup, service lifecycle, upgrade, uninstall, and platform research
- [docs/threat-model.md](docs/threat-model.md) — threat model draft

## License

Apache-2.0. See [LICENSE](LICENSE).
