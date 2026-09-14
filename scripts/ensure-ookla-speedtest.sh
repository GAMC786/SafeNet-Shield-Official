#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${SPEEDTEST_CLI_PATH:-}" ]]; then
  if [[ -x "$SPEEDTEST_CLI_PATH" ]]; then
    exit 0
  fi
  echo "SPEEDTEST_CLI_PATH is set but is not executable: $SPEEDTEST_CLI_PATH" >&2
  exit 0
fi

if command -v speedtest >/dev/null 2>&1; then
  exit 0
fi

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_dir="$root_dir/.cache/ookla-speedtest"
binary="$install_dir/speedtest"
if [[ -x "$binary" ]]; then
  exit 0
fi

architecture="$(uname -m)"
case "$architecture" in
  x86_64|amd64)
    package_url="${OOKLA_SPEEDTEST_DEB_URL:-https://packagecloud.io/ookla/speedtest-cli/packages/ubuntu/jammy/speedtest_1.2.0.84-1.ea6b6773cf_amd64.deb/download.deb}"
    ;;
  aarch64|arm64)
    package_url="${OOKLA_SPEEDTEST_DEB_URL:-https://packagecloud.io/ookla/speedtest-cli/packages/debian/trixie/speedtest_1.2.0.84-1.ea6b6773cf_arm64.deb/download.deb}"
    ;;
  *)
    echo "Ookla Speedtest CLI setup skipped: unsupported architecture $architecture." >&2
    exit 0
    ;;
esac

if ! command -v curl >/dev/null 2>&1 || ! command -v ar >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  echo "Ookla Speedtest CLI setup skipped: curl, ar, and tar are required." >&2
  exit 0
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$install_dir" "$tmp_dir/root"

echo "Preparing the official Ookla Speedtest CLI..."
curl --fail --location --silent --show-error --retry 3 "$package_url" -o "$tmp_dir/speedtest.deb"
(
  cd "$tmp_dir"
  ar x speedtest.deb
)
data_archive="$(find "$tmp_dir" -maxdepth 1 -type f -name 'data.tar.*' -print -quit)"
if [[ -z "$data_archive" ]]; then
  echo "Ookla Speedtest CLI setup failed: package data archive was missing." >&2
  exit 0
fi
tar -xf "$data_archive" -C "$tmp_dir/root" ./usr/bin/speedtest
cp "$tmp_dir/root/usr/bin/speedtest" "$binary"
chmod 755 "$binary"
echo "Ookla Speedtest CLI is ready."