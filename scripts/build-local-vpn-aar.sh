#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETSTACK="$ROOT/third_party/netvalve/netstack"
OUT="$ROOT/android/app/libs/safenet-localvpn.aar"

export GOTOOLCHAIN="${GOTOOLCHAIN:-auto}"
if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  : "${SDK:?Set ANDROID_SDK_ROOT or ANDROID_NDK_HOME}"
  export ANDROID_NDK_HOME="$SDK/ndk/27.3.13750724"
fi
[[ -d "$ANDROID_NDK_HOME" ]] || { echo "Android NDK not found: $ANDROID_NDK_HOME" >&2; exit 1; }

go install golang.org/x/mobile/cmd/gomobile@latest
export PATH="$(go env GOPATH)/bin:$PATH"

mkdir -p "$(dirname "$OUT")"
cd "$NETSTACK"
GOFLAGS=-mod=readonly go build ./...
GOFLAGS=-mod=readonly gomobile bind \
  -target="${LOCAL_VPN_ANDROID_TARGETS:-android/arm64,android/arm,android/amd64,android/386}" \
  -androidapi 26 \
  -javapkg=dev.netvalve \
  -o "$OUT" \
  .
echo "Built $OUT"
