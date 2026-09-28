# Contributing to Homebase

Thanks for helping build Homebase. This project is early (0.0.x) and architectural discipline matters more than
speed.

## Read this first

1. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) is the implementation source of truth. Read it before making
   architectural changes. If implementation reveals a flaw in the plan, update the plan in the same change and
   explain why.
2. [docs/architecture.md](docs/architecture.md), [docs/protocol.md](docs/protocol.md), and
   [docs/adapters.md](docs/adapters.md) describe the current design.

## Architecture rules

- **Provider-neutral protocol first.** Shared code and the web client consume `Agent*` protocol types only. Do not
  introduce provider-native names (`OcSession`, `OcMessage`, transcript formats, ACP method names) into shared code.
- **Capabilities over provider checks.** Feature differences are expressed through `AgentCapabilities`, not
  `if (provider === "claude")` in shared UI or host logic.
- **Security is architecture.** No secrets in the browser, no arbitrary working directories from API input, no
  public bind by default, no analytics, no cloud relay.
- **Do not parse terminal UI output** when a provider exposes a structured interface.
- **Add tests with every behavior.** Protocol tests, adapter tests, and host API tests are required. Live-provider
  tests are opt-in through environment variables and must not run by default.
- **Fixtures must be scrubbed.** No credentials, personal emails, machine names, private hostnames, or personal
  filesystem paths in captured fixtures.

## Development setup

Requirements: Node.js 22+ and npm 10+.

> npm 11 may print an `allow-scripts` warning about `esbuild`'s postinstall script. Homebase does not need
> it — esbuild's platform binary arrives through optional dependencies — so it is safe to leave pending.

```bash
npm install
npm run build       # protocol -> adapter-sdk -> host
npm test
npm run lint
npm run format:check
```

Useful scripts:

| Script              | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `npm run build`     | Build all workspaces (ordered)                 |
| `npm run typecheck` | Typecheck all workspaces                       |
| `npm test`          | Run all workspace test suites                  |
| `npm run lint`      | ESLint                                         |
| `npm run format`    | Prettier write                                 |
| `npm run dev:host`  | Run the Host in watch mode                     |
| `npm run verify`    | Build + typecheck + test + lint + format check |

## Pull requests

- Keep changes focused. One architectural concern per PR where possible.
- Run `npm run verify` before opening a PR.
- Describe what behavior changed and how it was tested.
- For adapter changes, state which compliance-suite checks pass and any skipped capabilities.

## Adding a provider adapter

1. Create a package under `packages/adapter-<provider>` that implements `AgentAdapter` from
   `@homebase/adapter-sdk`.
2. Declare capabilities honestly. Never advertise a capability the adapter cannot fulfill.
3. Run the adapter compliance suite against the adapter.
4. Add fixtures and tests. Document provider quirks next to the adapter code.
5. Do not modify shared protocol or web code to special-case the provider unless the concept is genuinely new and
   provider-neutral.

## License

By contributing, you agree that your contributions are licensed under the Apache License, Version 2.0 (see
[LICENSE](LICENSE)).
