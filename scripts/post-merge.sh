#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -x node_modules/.bin/tsx ]; then
  echo "Dependencies are missing; restoring from the lockfile..."
  npm ci --ignore-scripts --no-audit --no-fund
else
  echo "Dependencies are already available."
fi

echo "Checking TypeScript..."
npm run check

echo "Rebuilding production assets..."
npm run build

echo "Post-merge setup complete."