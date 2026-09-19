#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

BUN_VERSION="${BUN_VERSION:-1.3.14}"
NODE_VERSION="${NODE_VERSION:-24.13.0}"

export PATH="$HOME/.bun/bin:$HOME/.local/node/bin:$PATH"

if [ ! -x "$HOME/.bun/bin/bun" ] || [ "$("$HOME/.bun/bin/bun" --version)" != "$BUN_VERSION" ]; then
  curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip"
  rm -rf /tmp/bun-unzip && mkdir -p /tmp/bun-unzip "$HOME/.bun/bin"
  unzip -qo /tmp/bun.zip -d /tmp/bun-unzip
  mv /tmp/bun-unzip/bun-linux-x64/bun "$HOME/.bun/bin/bun"
fi
ln -sf "$HOME/.bun/bin/bun" "$HOME/.bun/bin/bunx"

if [ ! -x "$HOME/.local/node/bin/node" ] || [ "$("$HOME/.local/node/bin/node" --version)" != "v${NODE_VERSION}" ]; then
  curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  rm -rf "$HOME/.local/node" && mkdir -p "$HOME/.local/node"
  tar -xJf /tmp/node.tar.xz -C "$HOME/.local/node" --strip-components=1
fi

for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  grep -q '\.bun/bin:\$HOME/\.local/node/bin' "$rc" 2>/dev/null \
    || echo 'export PATH="$HOME/.bun/bin:$HOME/.local/node/bin:$PATH"' >> "$rc"
done

command -v ffmpeg >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg; }

bun install --frozen-lockfile
bun run build
(cd apps/studio && bunx playwright install --with-deps chromium)
if [ -f scripts/fixtures/generate-media.ts ]; then bun run fixtures; fi

echo "cloud-env install ok: bun $(bun --version), node $(node --version), $(ls packages/timeline/dist | wc -l) timeline dist files"
