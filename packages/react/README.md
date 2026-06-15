# @mcut/react

React bindings for mcut.

```sh
bun add @mcut/react react react-dom
```

This package provides the editor provider, hooks, canvas player binding,
selection overlay, playback clock, and audio preview integration for React apps.
`PlayerCanvas` uses the WebGPU compositor by default where supported and falls
back to Canvas2D when unavailable. React and React DOM are peer dependencies.
