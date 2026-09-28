# Third-party notices

Homebase is licensed under Apache-2.0 (see [LICENSE](LICENSE)). This file lists third-party material that is
**copied or adapted into this repository's source**. Ordinary npm dependencies keep their own license files in
`node_modules` and are not repeated here, except where noted for clarity.

## Beautiful UI

- Source: <https://www.beautifului.dev>
- Copyright © 2026 Shane Levine
- License: MIT (full text below)

The following files in `apps/web/src/components/beautiful/` are adapted from Beautiful UI components. The original
component sources were taken verbatim from the site's "Copy code" buttons (2026-09-27) and then rewritten as
data-driven components in Homebase's design tokens. Each file's header comment names the upstream component, what
was kept, what was changed, and which demo behavior was removed.

| Homebase file      | Upstream Beautiful UI component |
| ------------------ | ------------------------------- |
| `LoadingState.tsx` | Loading State (Orbit variant)   |
| `Thinking.tsx`     | Thinking                        |
| `ToolChips.tsx`    | Tool Chips                      |
| `TaskRows.tsx`     | Task Rows                       |
| `ApprovalCard.tsx` | Approval Card                   |

`PromptBar.tsx`, `RecommendationCard.tsx` and `CodeBlock.tsx` are **original Homebase components** written in the
same visual idiom. The upstream sources for Beautiful UI's Prompt Bar, Recommendation Card and Code Block were not
available to this project when they were written, so no Beautiful UI code is contained in them.

```
MIT License

Copyright (c) 2026 Shane Levine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Runtime dependencies added for the web client's animated icon

These are regular npm dependencies (not copied into the source tree), listed because they were added specifically
for the Thinking indicator:

- `lucide-react-motion` 0.5.x — MIT, © 2026 Aadil Alli — animated Lucide icons; only the `Brain` icon is used.
- `motion` 13.x — MIT — the animation engine `lucide-react-motion` requires as a peer dependency.
