#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <ad-hoc|developer-id> <app.app>..." >&2
  exit 2
}

[ "$#" -ge 2 ] || usage
mode="$1"
shift

assert_contains() {
  local haystack="$1" needle="$2" what="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "ok $what"
  else
    echo "FAIL $what, expected to find '$needle' in:" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

verify_app() {
  local app="$1" codesign_out
  echo "== $app"
  codesign_out="$(codesign -dv --verbose=4 "$app" 2>&1)"
  echo "$codesign_out"
  case "$mode" in
    ad-hoc)
      assert_contains "$codesign_out" 'Signature=adhoc' 'ad-hoc signature'
      assert_contains "$codesign_out" 'Identifier=com.mcut.studio' 'identifier'
      ;;
    developer-id)
      local spctl_out
      assert_contains "$codesign_out" 'Authority=Developer ID Application:' 'developer id authority'
      assert_contains "$codesign_out" 'Identifier=com.mcut.studio' 'identifier'
      assert_contains "$(grep 'flags=' <<<"$codesign_out" || true)" 'runtime' 'hardened runtime flag'
      spctl_out="$(spctl -a -vv -t exec "$app" 2>&1)"
      echo "$spctl_out"
      assert_contains "$spctl_out" 'accepted' 'gatekeeper accepted'
      assert_contains "$spctl_out" 'source=Notarized Developer ID' 'notarized source'
      xcrun stapler validate "$app"
      echo 'ok stapled ticket'
      ;;
  esac
}

case "$mode" in
  ad-hoc | developer-id) ;;
  *) usage ;;
esac

for app in "$@"; do
  verify_app "$app"
done
