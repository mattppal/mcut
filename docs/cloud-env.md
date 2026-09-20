# Cloud agent environment

Cursor cloud agents run the whole product on one VM. The environment is
dashboard managed, so the install command lives in the Cursor dashboard and
`scripts/cloud-env/install.sh` is its mirror in the repository. Change the
script first, then paste the same steps into the dashboard.

## What the VM has

| Tool | Where it comes from | Why |
| --- | --- | --- |
| Bun 1.3.14 | GitHub release zip, `~/.bun/bin` | `bun.sh` fails TLS from the VM, the release asset does not |
| Node 24 | `nodejs.org` tarball, `~/.local/node/bin`, first on `PATH` | `tsdown` loads its config through Node and needs 22.18 or newer. `drive.ts` runs under `node` because Playwright `_electron.launch` hangs under Bun |
| xvfb and Electron GTK libs | Ubuntu packages `xvfb libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64` | Electron needs a display and these libs on Ubuntu |
| Electron | `bun install` writes the package under `apps/desktop/node_modules/electron`. `install.sh` runs `install.js` when `dist/electron` is missing | The Playwright suite and `drive.ts` launch `apps/desktop` |
| ffmpeg 6.1 | Ubuntu package | Fixture generation and re-probing exported media |
| Workspace `dist/` | `bun run build` and `bun run --cwd apps/desktop build` | Package `exports` resolve to `dist/`. The desktop app serves `apps/studio/out` |

Environment build id. Coordinator fills after the build.

## Install

```sh
bash scripts/cloud-env/install.sh
```

Every step checks for its artifact before downloading, so the script converges
on a snapshot that already has the tools and only refreshes `node_modules` and
`dist/`. The last line prints the tool versions it ended with. The dashboard
command starts with `set -euo pipefail` and `cd /agent/repos/mcut`. The
environment holds two repositories, so the install shell does not start inside
mcut, and without `set -e` a build reports success after every step failed.

## Prove the environment

```sh
OUT=/tmp/mcut-verify bash scripts/cloud-env/verify-e2e.sh
```

The script runs the Playwright suite in `apps/studio` through Electron under
xvfb, then runs `.cursor/skills/verify-studio/scripts/drive.ts` under `node`
and xvfb. `drive.ts` must run under `node`. Playwright `_electron.launch` hangs
under Bun. It prints one `RESULT` line per stage with `seconds=` and ends with
`SUMMARY PASS` or `SUMMARY FAIL`. `SUMMARY PASS` requires the literal
`RESULT PASS` line from `drive.ts`. Set `MCUT_VERIFY_HEADED=1` with `DISPLAY`
set to drive the app on that display instead of xvfb. Logs, the Playwright
report, and the drive screenshots land under `$OUT`.
