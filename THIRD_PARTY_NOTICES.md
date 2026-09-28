# Third-party notices

Homebase is licensed under Apache-2.0 (see [LICENSE](LICENSE)). This file lists third-party material that is
**copied or adapted into this repository's source**. Ordinary npm dependencies keep their own license files in
`node_modules` and are not repeated here, except where noted for clarity.

## Beautiful UI

- Source: <https://www.beautifului.dev>, repository `slev12397/beautiful-ui`
- Copyright © 2026 Shane Levine
- License: MIT (full text below)

The following files in `apps/web/src/components/beautiful/` are adapted from Beautiful UI components. They were
rewritten as data-driven components in Homebase's design tokens; each file's header comment names the upstream
component, what was kept, what was changed, and which demo behavior was removed.

| Homebase file            | Upstream Beautiful UI component | Upstream source used                                      |
| ------------------------ | ------------------------------- | --------------------------------------------------------- |
| `LoadingState.tsx`       | Loading State (Orbit variant)   | beautifului.dev "Copy code", 2026-09-27                   |
| `Thinking.tsx`           | Thinking                        | beautifului.dev "Copy code", 2026-09-27                   |
| `ToolChips.tsx`          | Tool Chips                      | beautifului.dev "Copy code", 2026-09-27                   |
| `TaskRows.tsx`           | Task Rows                       | beautifului.dev "Copy code", 2026-09-27                   |
| `ApprovalCard.tsx`       | Approval Card                   | beautifului.dev "Copy code", 2026-09-27                   |
| `PromptBar.tsx`          | Prompt Bar                      | `slev12397/beautiful-ui@44a274e` `components/primitives/` |
| `RecommendationCard.tsx` | Recommendation Card             | `slev12397/beautiful-ui@44a274e` `components/primitives/` |
| `CodeBlock.tsx`          | Code Block                      | `slev12397/beautiful-ui@44a274e` `components/primitives/` |

Upstream dependencies that were **not** brought over: `glimm` (Prompt Bar's shader), `class-variance-authority`, and
the site's `Button`, `EntityChip`, `ValuePill` and `GlideMenu` helpers.

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

## Lucide-React-Motion (Brain animation)

- Source: <https://github.com/Aadil1505/Lucide-React-Motion>
- Copyright (c) 2026 Aadil Alli
- License: MIT (full text below)

Homebase does **not** depend on the `lucide-react-motion` package at runtime. `apps/web/src/components/beautiful/AnimatedBrain.tsx`
contains a narrow, purpose-built adaptation of that project's `brain` signature animation and its `brain-fold-ripple`
motion (`packages/lucide-react-motion/src/modes/signatures/brain.ts` and `.../motions/brain-fold-ripple.ts`): the
per-path propagation order, the fold/outline roles, the keyframes and the 1.2 s ease-in-out cycle. It is reimplemented
directly on `motion/react` for the Thinking indicator only; nothing else from the library (icon catalog, mode registry,
other animations) is included.

The Brain's static path geometry is Lucide's `brain` icon (ISC License, Copyright (c) 2026 Lucide Icons and Contributors;
see the `lucide-react` package's LICENSE file).
`lucide-react` and `motion` remain ordinary npm runtime dependencies, so they are not copied here.

```
MIT License

Copyright (c) 2026 Aadil Alli

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
