#!/usr/bin/env bash
set -uo pipefail

export PATH="$HOME/.bun/bin:$HOME/.local/node/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-/tmp/mcut-verify}"
DRIVE_PORT="${MCUT_VERIFY_PORT:-3124}"
mkdir -p "$OUT"
cd "$ROOT"

[ -d packages/timeline/dist ] || bun run build

start=$(date +%s)
(cd apps/studio && CI=true bun run e2e) >"$OUT/playwright.log" 2>&1
e2e_exit=$?
e2e_secs=$(( $(date +%s) - start ))
cp -r apps/studio/playwright-report "$OUT/" 2>/dev/null || true
echo "RESULT playwright exit=$e2e_exit seconds=$e2e_secs $(grep -E '^\s+[0-9]+ (passed|failed|flaky|skipped)' "$OUT/playwright.log" | tr -s ' ' | tr '\n' ' ')"

(cd apps/studio && bun run start --port "$DRIVE_PORT") >"$OUT/studio.log" 2>&1 &
studio_pid=$!
for _ in $(seq 1 60); do
  curl -fs -o /dev/null "http://127.0.0.1:$DRIVE_PORT/editor" && break
  sleep 1
done

start=$(date +%s)
MCUT_EDITOR_URL="http://127.0.0.1:$DRIVE_PORT/editor" bun .cursor/skills/verify-studio/scripts/drive.ts "$OUT/verify-studio" >"$OUT/drive.log" 2>&1
drive_exit=$?
drive_secs=$(( $(date +%s) - start ))
kill "$studio_pid" 2>/dev/null
echo "RESULT verify-studio exit=$drive_exit seconds=$drive_secs $(grep -E '^RESULT' "$OUT/drive.log" | tail -1)"

if [ "$e2e_exit" -eq 0 ] && [ "$drive_exit" -eq 0 ]; then
  echo "SUMMARY PASS out=$OUT"
  exit 0
fi
echo "SUMMARY FAIL playwright=$e2e_exit verify-studio=$drive_exit out=$OUT"
exit 1
