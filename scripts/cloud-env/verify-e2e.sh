#!/usr/bin/env bash
set -uo pipefail

export PATH="$HOME/.local/node/bin:$HOME/.bun/bin:$PATH"
unset ELECTRON_RUN_AS_NODE
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-/tmp/mcut-verify}"
mkdir -p "$OUT"
cd "$ROOT"

[ -d packages/timeline/dist ] || bun run build
[ -f apps/desktop/dist/main.mjs ] || bun run --cwd apps/desktop build

start=$(date +%s)
(cd apps/studio && CI=true xvfb-run --auto-servernum -- bun run e2e) >"$OUT/playwright.log" 2>&1
e2e_exit=$?
e2e_secs=$(( $(date +%s) - start ))
cp -r apps/studio/playwright-report "$OUT/" 2>/dev/null || true
echo "RESULT playwright exit=$e2e_exit seconds=$e2e_secs $(grep -E '^\s+[0-9]+ (passed|failed|flaky|skipped)' "$OUT/playwright.log" | tr -s ' ' | tr '\n' ' ')"

start=$(date +%s)
if [ "${MCUT_VERIFY_HEADED:-}" = "1" ] && [ -n "${DISPLAY:-}" ]; then
  node .cursor/skills/verify-studio/scripts/drive.ts "$OUT/verify-studio" >"$OUT/drive.log" 2>&1
else
  xvfb-run --auto-servernum -- node .cursor/skills/verify-studio/scripts/drive.ts "$OUT/verify-studio" >"$OUT/drive.log" 2>&1
fi
drive_exit=$?
drive_secs=$(( $(date +%s) - start ))
echo "RESULT verify-studio exit=$drive_exit seconds=$drive_secs $(grep -E '^RESULT' "$OUT/drive.log" | tail -1)"

if [ "$e2e_exit" -eq 0 ] && grep -qx 'RESULT PASS' "$OUT/drive.log"; then
  echo "SUMMARY PASS out=$OUT"
  exit 0
fi
echo "SUMMARY FAIL playwright=$e2e_exit verify-studio=$drive_exit out=$OUT"
exit 1
