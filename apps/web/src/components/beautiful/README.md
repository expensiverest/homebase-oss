# Beautiful UI primitives

Presentational components in the Beautiful UI idiom, reskinned with Homebase tokens. They know nothing about
providers, sessions or the API: Homebase adapters (`ChatTimeline.tsx`, `ActionCards.tsx`, `Composer.tsx`,
`Sheets.tsx`) map normalized `Agent*` state into them. Licensing and provenance: `THIRD_PARTY_NOTICES.md`.

| Primitive            | Origin              | Driven by (adapter)                                                  |
| -------------------- | ------------------- | -------------------------------------------------------------------- |
| `LoadingState`       | Beautiful UI, Orbit | a live turn with nothing visible yet; elapsed from `turn.started`    |
| `Thinking`           | Beautiful UI        | `reasoning` content parts (only what the provider sent)              |
| `ToolChips`          | Beautiful UI        | `AgentToolCall[]` in finished (folded) runs                          |
| `TaskRows`           | Beautiful UI        | `AgentToolCall[]` in the live run; `AgentPlan.steps`                 |
| `ApprovalCard`       | Beautiful UI        | `AgentApprovalRequest` (options from `request.options`), questions   |
| `RecommendationCard` | Beautiful UI        | a single `confirm` `AgentQuestion`; signal meter only with real data |
| `PromptBar`          | Beautiful UI        | `Composer` (drafts, uploads, queue/steer/stop, capabilities)         |
| `CodeBlock`          | Beautiful UI        | fenced Markdown code, tool input/output, `AgentDiff` patches         |

Removed from every upstream demo: self-running timers and scripted stages, hard-coded content, hover-only reveals,
popovers that assume a mouse, and the site's own tokens/helpers. Motion runs only on live state; history renders
still, and `prefers-reduced-motion` freezes everything to its settled look.
