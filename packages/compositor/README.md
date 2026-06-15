# @mcut/compositor

Canvas2D and WebGPU compositor for mcut projects.

```sh
bun add @mcut/compositor @mcut/timeline
```

This package renders mcut timeline frames and hit-test geometry for preview and
export flows. It includes the Canvas2D reference renderer and an opt-in WebGPU
backend for high-performance preview compositing. It is framework-agnostic and
depends on the project model from `@mcut/timeline`.
