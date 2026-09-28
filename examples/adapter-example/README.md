# Example adapter

This package is a worked example for adapter authors. It implements `AgentAdapter` from
`@homebase/adapter-sdk` with an in-memory "echo" provider and runs the shared compliance suite against
it.

What to notice:

- `getCapabilities()` declares only `streaming: true`. The adapter has no `interrupt`, `resolveApproval`,
  `setModel`, `getDiff`, or `deleteSession` methods, and the compliance suite verifies that capabilities
  and methods agree.
- The adapter emits normalized `AgentEvent`s through `AdapterContext.emit`; it never touches HTTP, SSE,
  or the Host's event bus.
- Session operations receive `AgentProject` records from the Host; the adapter never reads paths from
  environment variables or messages.

To start a real adapter:

1. Copy this package to `packages/adapter-<provider>`.
2. Replace the echo implementation with calls to the provider's documented interface.
3. Map native events to the normalized vocabulary in `docs/protocol.md`.
4. Run `npm test` (the compliance suite) and add fixture tests for native stream shapes.
5. Add `HOMEBASE_TEST_<PROVIDER>=1`-gated live tests and document provider quirks next to the adapter.
