#!/usr/bin/env bash

set -euo pipefail

readonly max_attempts=3
readonly retry_delay_seconds=10
readonly diagnostics_directory="${RUNNER_TEMP:-.}/npm-ci-diagnostics"

mkdir -p "$diagnostics_directory"

# Replit's package firewall URL is useful inside Replit but is not reachable
# from a GitHub-hosted runner. Keep the lockfile's integrity hashes intact
# while making its tarball sources available to the release runner.
if grep -q 'package-firewall\.replit\.local/npm/' package-lock.json; then
  echo "::warning::Normalizing Replit-only package tarball URLs for the hosted runner."
  sed -i \
    's#http://package-firewall\.replit\.local/npm/#https://registry.npmjs.org/#g' \
    package-lock.json
fi

last_status=1
for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
  log_file="$diagnostics_directory/npm-ci-attempt-${attempt}.log"
  echo "Running npm ci (attempt ${attempt}/${max_attempts})."

  if npm ci --no-audit --no-fund 2>&1 | tee "$log_file"; then
    echo "npm ci succeeded on attempt ${attempt}."
    exit 0
  fi

  npm_status="${PIPESTATUS[0]}"
  last_status="$npm_status"
  diagnostics_file="$diagnostics_directory/npm-ci-attempt-${attempt}-diagnostics.txt"
  registry="$(npm config get registry 2>&1 || true)"
  registry="$(printf '%s' "$registry" | sed -E 's#(https?://)[^/@[:space:]]+@#\1<redacted>@#g')"

  {
    printf 'npm ci attempt: %s/%s\n' "$attempt" "$max_attempts"
    printf 'npm ci exit status: %s\n' "$npm_status"
    printf 'Node.js: '
    node --version 2>&1 || true
    printf 'npm: '
    npm --version 2>&1 || true
    printf 'npm registry: %s\n' "$registry"
    printf 'npm cache: '
    npm config get cache 2>&1 || true
    printf 'package-lock.json SHA-256: '
    sha256sum package-lock.json 2>&1 || true
    echo 'Filesystem:'
    df -h . "$RUNNER_TEMP" 2>&1 || true
    echo 'npm cache verification:'
    npm cache verify 2>&1 || true
    echo 'Last 120 lines of npm output:'
    tail -n 120 "$log_file" || true
  } > "$diagnostics_file"

  if (( attempt < max_attempts )); then
    echo "::warning::npm ci failed on attempt ${attempt}/${max_attempts}; retrying in ${retry_delay_seconds}s."
    sleep "$retry_delay_seconds"
  else
    echo "::error::npm ci failed after ${max_attempts} attempts. See the npm-ci-diagnostics artifact."
  fi
done

exit "$last_status"