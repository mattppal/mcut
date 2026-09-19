# Cloud agent environment

Cursor cloud agents run the whole product on one VM. The environment is
dashboard managed, so the install command lives in the Cursor dashboard and
`scripts/cloud-env/install.sh` is its mirror in the repository. Change the
script first, then paste the same steps into the dashboard.

## What the VM has

| Tool | Where it comes from | Why |
| --- | --- | --- |
| Bun 1.3.14 | GitHub release zip, `~/.bun/bin` | `bun.sh` fails TLS from the VM, the release asset does not |
| Node 24 | `nodejs.org` tarball, `~/.local/node/bin`, first on `PATH` | `tsdown` loads its config through Node and needs 22.18 or newer |
| Chromium with WebCodecs | `bunx playwright install --with-deps chromium` in `apps/studio` | The Playwright suite and the verify-studio drive script |
| Google Chrome | Preinstalled at `/usr/local/bin/google-chrome` | H.264 export when a check needs MP4, set `MCUT_CHROME_PATH` |
| ffmpeg 6.1 | Ubuntu package | Fixture generation and re-probing exported media |
| Workspace `dist/` | `bun run build` | Package `exports` resolve to `dist/` |

## Install

```sh
bash scripts/cloud-env/install.sh
```

Every step checks for its artifact before downloading, so the script converges
on a snapshot that already has the tools and only refreshes `node_modules` and
`dist/`. The last line prints the tool versions it ended with.

## Prove the environment

```sh
OUT=/tmp/mcut-verify bash scripts/cloud-env/verify-e2e.sh
```

The script runs the Playwright suite in `apps/studio`, then starts a production
Studio server on port 3124 and runs `.cursor/skills/verify-studio/scripts/drive.ts`
against it. It prints one `RESULT` line per stage and ends with `SUMMARY PASS`
or `SUMMARY FAIL`. Logs, the Playwright report, and the drive screenshots land
under `$OUT`.
