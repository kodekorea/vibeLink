#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export MTB_PASSWORD="${MTB_PASSWORD:-changeme1234}"
export MTB_PORT="${MTB_PORT:-47801}"
export MTB_SHELL="${MTB_SHELL:-${SHELL:-/bin/zsh}}"
export MTB_DEFAULT_ENV="${MTB_DEFAULT_ENV:-zsh}"

if [ ! -d node_modules ]; then
  npm install
fi

echo "Starting VibeLink Hub on http://127.0.0.1:${MTB_PORT}"
echo "Password: ${MTB_PASSWORD}"
npx tsx src/index.ts
