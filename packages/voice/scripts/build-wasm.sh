#!/bin/sh
set -eu

commit=d375b2d8309e0935d165700c91da9de862a99c31
package=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git -C "$work" init --quiet upstream
git -C "$work/upstream" fetch --quiet --depth 1 https://github.com/Rikorose/DeepFilterNet.git "$commit"
git -C "$work/upstream" checkout --quiet FETCH_HEAD
git -C "$work/upstream" apply "$package/wasm/deepfilternet.patch"
cp "$package/wasm/Cargo.lock" "$work/upstream/Cargo.lock"

cd "$work/upstream/libDF"
wasm-pack build --release --target web --out-dir "$work/pkg" . -- --features wasm --no-default-features --locked

cp "$work/pkg/df_bg.wasm" "$work/pkg/LICENSE-MIT" "$work/pkg/LICENSE-APACHE" "$package/wasm/"
bun "$package/scripts/vendor-glue.ts" "$work/pkg"
