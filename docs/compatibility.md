# Provider compatibility

> Policy: IMPLEMENTATION_PLAN §23. If an installed provider is newer than the latest tested version,
> warn rather than hard-fail unless a known incompatibility exists.

## Matrix

| Provider           | Integration                          | Minimum    | Latest tested | Status                       |
| ------------------ | ------------------------------------ | ---------- | ------------- | ---------------------------- |
| Mock (built-in)    | In-memory adapter                    | 0.0.1-mock | 0.0.1-mock    | Stable (development fixture) |
| OpenCode           | Native HTTP + SSE adapter            | TBD        | TBD           | Planned (Phase 2)            |
| Claude Code        | Structured CLI compatibility adapter | TBD        | TBD           | Planned (Phase 3)            |
| Grok Build         | ACP transport                        | TBD        | TBD           | Planned (Phase 6)            |
| Gemini CLI         | ACP transport                        | TBD        | TBD           | Planned (Phase 6)            |
| Codex CLI          | Application-server protocol          | TBD        | TBD           | Planned (Phase 10)           |
| GitHub Copilot CLI | Official SDK / structured interface  | TBD        | TBD           | Planned (Phase 10)           |

Minimum/target versions are filled in when each adapter is implemented and verified against a real
installation. Adapters must state the tested version in their package documentation and update this
table in the same change.

## Detection states

`ProviderDetection` distinguishes:

- not installed (`installed: false`)
- installed, authentication unknown (`authenticated: null`)
- installed but not authenticated (`authenticated: false`)
- installed and authenticated (`authenticated: true`)
- compatible / incompatible with the tested version (`compatible`)
- temporarily unavailable (detection failure or transport failure → `installed: false` with `warning`)

`warning` carries a human-readable explanation. Detection never returns credentials or account
identifiers.

## Live provider tests

Adapters add opt-in tests gated by environment variables:

```text
HOMEBASE_TEST_OPENCODE=1
HOMEBASE_TEST_CLAUDE=1
HOMEBASE_TEST_GROK=1
HOMEBASE_TEST_GEMINI=1
```

They are skipped by default so contributors without a provider installed can run the full suite. CI runs
fixture-based tests only.

## Captured fixtures

- Prefer deterministic fixtures captured from a real provider session to paid live runs.
- Fixtures must be scrubbed: no credentials, tokens, personal emails, machine names, personal paths, or
  private repository content. Use synthetic values when re-creating a capture.
- Document what provider version a fixture was captured from next to the file.
