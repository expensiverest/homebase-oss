# Homebase

Homebase is a local-first, mobile-first control plane for AI coding agents running on your own computer.

Your development machine stays the execution environment. Your phone becomes the control surface. Homebase gives
Claude Code, OpenCode, Grok Build, Gemini CLI, Codex CLI, GitHub Copilot CLI, and future agent adapters one coherent
mobile experience for projects, sessions, streaming output, approvals, questions, diffs, models, and usage.

> **Status: pre-alpha (0.0.x).** The provider-neutral protocol, adapter SDK, and Host core are being built in the
> open. No public release exists yet. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the authoritative plan.

## Why Homebase

- **One interface, many agents.** Projects and sessions are first-class across providers instead of being locked
  inside each vendor's app.
- **Your machine does the work.** Source code, provider CLIs, credentials, and transcripts stay on your computer.
- **Phone-appropriate control.** Approvals, questions, plans, diffs, and interruption are structured surfaces, not a
  terminal crammed into a mobile browser.
- **Capability-driven, not lowest-common-denominator.** The UI only shows what the selected provider actually
  supports. Unsupported features stay unsupported rather than being faked.

## Supported providers

| Provider           | Integration                                          | Status                            |
| ------------------ | ---------------------------------------------------- | --------------------------------- |
| OpenCode           | Native HTTP + SSE adapter                            | Planned (next, reference adapter) |
| Claude Code        | Compatibility adapter over the structured CLI stream | Planned                           |
| Grok Build         | Generic ACP transport                                | Planned                           |
| Gemini CLI         | Generic ACP transport                                | Planned                           |
| Codex CLI          | Application-server protocol                          | Later                             |
| GitHub Copilot CLI | Official SDK / structured interface                  | Later                             |

The Host ships with a deterministic **mock provider** so the protocol, event bus, and client can be developed and
tested without any paid provider runs.

## Where things run

- **Host** (`apps/host`): a Node.js 22+ process on your computer. It owns configuration, the project registry,
  provider adapters, the normalized event bus, and the REST/SSE API.
- **Web client** (`apps/web`): an installable PWA served by or pointed at the Host. It never talks to provider
  processes directly.

Provider credentials are never sent to the browser and are never part of the Homebase API. The phone authenticates to
Homebase; the provider CLIs authenticate themselves, on your machine, exactly as they do today.

## Security posture

- The Host binds to `127.0.0.1` by default. Public-internet exposure is never the default and is not recommended.
- For remote access, use a private network such as **Tailscale**. Do not port-forward Homebase to the public internet.
- Projects are resolved from a Host-owned registry. The browser cannot submit an arbitrary filesystem path to start
  an agent.
- See [SECURITY.md](SECURITY.md) and `docs/security.md` for details.

## Install (development)

Homebase is not packaged for end users yet. To work on it:

```bash
npm install
npm run build
npm test
npm run dev:host
```

The Host prints its local URL when it starts. Health check:

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
- [docs/threat-model.md](docs/threat-model.md) — threat model draft

## License

Apache-2.0. See [LICENSE](LICENSE).
