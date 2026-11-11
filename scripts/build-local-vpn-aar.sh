#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETSTACK="$ROOT/third_party/netvalve/netstack"
OUT="$ROOT/android/app/libs/safenet-localvpn.aar"
VARS="$ROOT/android/variables.gradle"

export GOTOOLCHAIN="${GOTOOLCHAIN:-auto}"
if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  if [[ -z "$SDK" && -f "$ROOT/android/local.properties" ]]; then
    SDK="$(sed -nE 's/^[[:space:]]*sdk\.dir[[:space:]]*=[[:space:]]*//p' \
      "$ROOT/android/local.properties" | head -n1)"
    SDK="${SDK//\\:/\:}"
  fi
  : "${SDK:?Set ANDROID_SDK_ROOT or ANDROID_NDK_HOME}"
  NDK_VERSION="$(sed -nE "s/^[[:space:]]*strongswanNdkVersion[[:space:]]*=[[:space:]]*'([^']+)'.*$/\1/p" "$VARS")"
  : "${NDK_VERSION:?Could not read the pinned Android NDK version}"
  export ANDROID_NDK_HOME="$SDK/ndk/$NDK_VERSION"
fi
[[ -d "$ANDROID_NDK_HOME" ]] || { echo "Android NDK not found: $ANDROID_NDK_HOME" >&2; exit 1; }

MOBILE_VERSION="$(cd "$NETSTACK" && go list -mod=readonly -m -f '{{.Version}}' golang.org/x/mobile)"
go install "golang.org/x/mobile/cmd/gomobile@$MOBILE_VERSION"
go install "golang.org/x/mobile/cmd/gobind@$MOBILE_VERSION"
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
