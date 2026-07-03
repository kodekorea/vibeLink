#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Opening VibeLink Desktop..."
"${ROOT}/desktop/run.sh"
