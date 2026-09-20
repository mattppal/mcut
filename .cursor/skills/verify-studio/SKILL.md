---
name: verify-studio
description: Drive the mcut Studio editor as a user and record proof. Use when a change touches apps/studio, apps/desktop, or the packages they render and you need evidence in the real desktop app that opening a project, importing a clip, scrubbing the playhead, and exporting still work.
---

# Verify Studio as a user

Studio is the editor in `apps/studio`, shipped inside the Electron desktop app in `apps/desktop`. This skill walks the editor the way a person does, checks one literal observable per step, and leaves screenshots plus a screen recording behind. The selectors and the spec each came from live in [references/selectors.md](references/selectors.md).

## Prerequisites

- Bun 1.3.14 and Node 24 first on `PATH`. `bash scripts/cloud-env/install.sh` installs both on a cloud VM. The script runs under `node`, because Playwright's `_electron.launch` hangs under Bun.
- A display. On a VM without one, prefix every launch with `xvfb-run --auto-servernum --server-args="-screen 0 1600x1000x24" --`.
- `ELECTRON_RUN_AS_NODE` unset in the shell. With it set, Electron starts as plain Node and never opens a window (https://github.com/microsoft/playwright/issues/39922). The script strips it from the environment it hands Electron.
- The fixture `apps/studio/e2e/fixtures/fixture-vp9.mkv`, a 2 second VP9 clip committed with the specs.
- For a recording, a desktop session with `DISPLAY` set and the `RecordScreen` tool.

## Build the app

From the repo root run these in order.

```sh
bun install --frozen-lockfile
bun run build
```

`bun run build` exports Studio to `apps/studio/out` and bundles the desktop shell into `apps/desktop/dist`. After a change to `apps/desktop` alone, `bun run --cwd apps/desktop build` is enough. The first Electron launch downloads the Electron binary into `~/.cache/electron`, so the first run needs network access.

To drive by hand, start the app with `bun run --cwd apps/desktop start`. It prints `BRIDGE_READY ws://127.0.0.1:44737/mcut-mcp` and opens the editor window. Pass `--port 0` for an ephemeral bridge port.

## The flow

Take a screenshot after every step. Each step names the literal the screenshot must show.

1. Open the app. If a toast asks to restore the previous session, click `Discard`. See the transport bar with the `Go to start` button, an empty `Track 1`, and the project name input at the top center reading `Untitled`.
2. Click the project name and type `verify-studio`. See the input read `verify-studio`. The export later downloads as `verify-studio.webm`.
3. Click `+ Import` in the media panel and pick the fixture. In a native file chooser, type the absolute path and confirm. See a card titled `fixture-vp9.mkv` with a `0:02` badge and a toast reading `Imported 1 file`. The thumbnail fills in a moment later.
4. Double-click the card to add it at the playhead, or drag it onto `Track 1`. See one clip carrying the file name on the lane with a color-bar filmstrip, the inspector heading `Video` with `Duration 2.008`, and the `Export` button enabled.
5. Press the ruler above the lane inside the clip and drag right. See the timecode at the left of the timeline leave `0:00.0` and the preview show color bars with a burned-in timestamp. Press `Shift+ArrowRight`. See the timecode advance by exactly one second and the preview repaint with a different frame.
6. Click `Export` at the top right. See a dialog titled `Export video` with `MP4`, `WebM`, and `MKV` format buttons. Click `WebM`. See the footer button read `Export WebM`.
7. Click `Export WebM`. See the button read `Exporting…` with a `Rendering frames` progress line, then a save dialog proposing `verify-studio.webm` in your Downloads folder. Confirm it and see the file land larger than 0 bytes. In the page console `window.__mcutLastExportMode` reads `worker`.
8. Click `Close` in the dialog footer. See the dialog gone and the clip still on the timeline.

## Scripted variant

`scripts/drive.ts` launches the desktop app through Playwright's `_electron`, runs the same eight steps in its window, and asserts every literal above.

```sh
xvfb-run --auto-servernum --server-args="-screen 0 1600x1000x24" -- node .cursor/skills/verify-studio/scripts/drive.ts /tmp/verify
```

It writes `01-open-editor.png` through `08-close-export-dialog.png`, `verify-studio.webm`, and `report.json` into the directory, prints one `ok` or `fail` line per step, and ends with `RESULT PASS`, `RESULT ISSUES`, or `RESULT FAIL`. The exit code is 0 for PASS and ISSUES and 1 for FAIL. The app runs with a fresh `XDG_CONFIG_HOME` under the output directory, so no earlier session leaks in, and the script answers the export's `will-download` event with a path in the output directory, so no save dialog opens. Set `MCUT_ELECTRON_PATH` to a packaged binary, such as `apps/desktop/release/linux-unpacked/mcut-desktop` from `bun run --cwd apps/desktop package`, to drive that build instead of `apps/desktop/dist` under the development Electron. If the app cannot encode WebM, the script asserts the warning text in the dialog instead of downloading and reports ISSUES.

## Record the run

1. Start `RecordScreen` before step 1.
2. Drive the steps with the `computerUse` subagent, or run the script without `xvfb-run` under the same `DISPLAY`.
3. After the export finishes and the dialog is closed, save the recording as `studio-verify`. The tool returns the path, usually `/opt/cursor/artifacts/studio-verify.mp4`.
4. If a step failed before the window opened, discard the recording and say so in the report.

## Report

Open with one of `PASS`, `ISSUES`, or `BLOCKED`. Then list the eight steps with the observed literal and the screenshot path, the export file path with its byte count, and the recording path.

- `PASS` when every step showed its literal and the download exists.
- `ISSUES` when the flow completed but something deviated, such as a `page error` entry in `report.json`, a WebCodecs warning in the export dialog, or a preview that stayed black. Quote the exact text.
- `BLOCKED` when the app did not start or a step could not be reached. Quote the exact error and the last ready signal seen.

## Gotchas

- If `curl https://bun.sh/install` fails on the VM, download `bun-linux-x64.zip` from the GitHub release for 1.3.14, put `bun` on `PATH`, and symlink `bunx` to it.
- If the script hangs at launch, check that it runs under `node`, not `bun`, and that `ELECTRON_RUN_AS_NODE` is unset.
- If Electron prints `Unable to open X display`, there is no display. Use `xvfb-run`.
- If the launch fails with a sandbox error on Ubuntu 24.04, run `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` (https://github.com/microsoft/playwright/issues/34251).
- If the preview is black right after a seek, wait. It repaints one to two seconds later once the frame decodes.
- If you drop the card instead of double-clicking, the drop position sets the clip start. A drop 120 px into the lane lands near `2.4` seconds at the default zoom, so the playhead at `0:00.0` shows black until you scrub into the clip.
- If the export dialog is still open after the download, that is expected. The button returns to `Export WebM` and nothing else confirms success, so check the file.
- If `Export` is disabled, the timeline is empty.
- If no restore toast appears, the profile has no saved session. Only profiles with an earlier session show it.
- If a `Close` lookup matches two buttons, that is the dialog's corner X plus the footer button. Use the last one.
