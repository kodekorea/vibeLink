#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "First run: installing dependencies, please wait..."
  npm install
fi

echo "Starting Expo dev server. Scan the QR with Expo Go on your phone."
echo "Press Ctrl+C to stop."
npx expo start
