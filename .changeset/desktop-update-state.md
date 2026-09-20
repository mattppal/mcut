---
"@mcut/desktop-ipc": minor
---

`updateStateSchema` names the desktop auto-update state machine, one of `idle`, `available`, `downloading`, `ready`, or `failed`, and `UpdateState` is its type. `DESKTOP_INVOKES` gains `update.download` and `update.install`, which both return the state after the call, and the main process pushes every state change on the `update` channel with the same schema. `DesktopApi.update` exposes `download()`, `install()`, and `onState()` to Studio.
