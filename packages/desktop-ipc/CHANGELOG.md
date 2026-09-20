# @mcut/desktop-ipc

## 0.1.0-alpha.3

### Minor Changes

- [#119](https://github.com/mattppal/mcut/pull/119) [`eb3826c`](https://github.com/mattppal/mcut/commit/eb3826c6bf507ebe18e5323c3e7634619e239670) Thanks [@mattppal](https://github.com/mattppal)! - `updateStateSchema` names the desktop auto-update state machine, one of `idle`, `available`, `downloading`, `ready`, or `failed`, and `UpdateState` is its type. `DESKTOP_INVOKES` gains `update.download` and `update.install`, which both return the state after the call, and the main process pushes every state change on the `update` channel with the same schema. `DesktopApi.update` exposes `download()`, `install()`, and `onState()` to Studio.

## 0.1.0-alpha.2

### Patch Changes

- [#116](https://github.com/mattppal/mcut/pull/116) [`8c2ec43`](https://github.com/mattppal/mcut/commit/8c2ec43005515e57832b30e26b78705a51fd1e7a) Thanks [@mattppal](https://github.com/mattppal)! - Expose the desktop platform on `DesktopApi` so Studio can lay out around the hidden title bar.

## 0.1.0-alpha.1

### Minor Changes

- [#102](https://github.com/mattppal/mcut/pull/102) [`6afcc08`](https://github.com/mattppal/mcut/commit/6afcc084e6d022cd80e44f5d7b53db7567b759d6) Thanks [@mattppal](https://github.com/mattppal)! - New package. `DESKTOP_INVOKES` is the zod schema table for the four desktop IPC channels (`app.info`, `app.setTranscriptionKey`, `project.open`, `project.save`), `InvokeHandlers` is the mapped handler type over it, `desktopErrorSchema` and `DesktopError` carry the closed error codes across the process boundary, `DesktopApi` is the surface the preload exposes on `window.mcutDesktop`, and `readDesktopApi()` parses it or returns `null` in a plain browser.

### Patch Changes

- Updated dependencies [[`03cc06d`](https://github.com/mattppal/mcut/commit/03cc06daf1034f8dd5a8ec4640f86a08dcb7138b), [`834832d`](https://github.com/mattppal/mcut/commit/834832d355eaa57c1f834137ef8dc0a995a3abfc), [`5aad56b`](https://github.com/mattppal/mcut/commit/5aad56b25548ff130b3277bb4c97d791c08da0d7), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`7dfa960`](https://github.com/mattppal/mcut/commit/7dfa96035bd5c203cd09e6a2836fa0f71c02cb46), [`110405d`](https://github.com/mattppal/mcut/commit/110405d29e4fce2f2ece5f56b1b15e9944f45f6a), [`4878e4e`](https://github.com/mattppal/mcut/commit/4878e4ec2737a4c80aa4770e7b11ad790c7876ad), [`14e10e9`](https://github.com/mattppal/mcut/commit/14e10e90669438c548a3873f53134fb06c673c78), [`37cda0c`](https://github.com/mattppal/mcut/commit/37cda0ce379c84f82bc8d6785f7e597418c209c3), [`17ef0cb`](https://github.com/mattppal/mcut/commit/17ef0cbecfeac56cbc03ac8f49a266c01471ffc0), [`e71776c`](https://github.com/mattppal/mcut/commit/e71776c27f0a663bba684a6cb015f417f865e40a), [`c9f8b6a`](https://github.com/mattppal/mcut/commit/c9f8b6a9e7b31df0e369443e0d494e3df516ffd1), [`c8c63b3`](https://github.com/mattppal/mcut/commit/c8c63b34315f24f81d0f551e192bc6ff699baff7)]:
  - @mcut/timeline@0.1.0-alpha.1
