#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/desktop"

echo "============================================"
echo "  Building VibeLink Desktop app"
echo "============================================"

if [ ! -d node_modules ]; then
  npm install
fi

(
  cd ../hub
  npm install
)

# Personal distribution: avoid local signing prompts unless explicitly configured.
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"

npm run dist

echo
echo "[OK] Done. Output is in: desktop/dist-new/"
