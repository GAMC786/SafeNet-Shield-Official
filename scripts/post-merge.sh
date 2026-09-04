#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Restoring dependencies from the lockfile..."
# Always use a clean lockfile install. Checking for one executable is not
# sufficient after a merge because node_modules can be partially populated
# while newly merged packages are still missing.
npm ci --ignore-scripts --no-audit --no-fund

echo "Synchronizing the development database schema..."
npm run db:push

echo "Checking TypeScript..."
npm run check

echo "Rebuilding production assets..."
npm run build

echo "Post-merge setup complete."