# @mcut/desktop-ipc

The typed IPC contract between the mcut desktop main process and Studio.

```sh
bun add @mcut/desktop-ipc @mcut/timeline
```

`DESKTOP_INVOKES` is one table from channel name to `{ input, output }` zod
schemas. The desktop preload and the main process both compile against it, so
a channel added on one side fails to typecheck on the other. `InvokeHandlers`
is the mapped handler type the main process implements. `DesktopError` carries
one of the closed error codes in `desktopErrorSchema`, and every invoke resolves
to a `DesktopResult` that is either `{ ok: true, value }` or `{ ok: false, error }`.

`DesktopApi` is the shape the preload exposes as `window.mcutDesktop`.
`readDesktopApi()` parses that global and returns it, or `null` in a plain
browser, so the same Studio build runs in both places.
