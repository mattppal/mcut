---
"@mcut/compositor": minor
---

A multicam needs a scratch 2D context to compose its layout on. Where none is available, rendering the multicam throws `ScratchContextError`. No context is available where `OffscreenCanvas` is missing and no `createScratchContext` is given, or when `createScratchContext` returns `null`. The message names the size and shows a node-canvas factory to pass as `createScratchContext`. `ElementRenderContext.acquireScratch` returns a 2D context or throws that error, so a renderer never gets `null`.
