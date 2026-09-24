#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
source_dir="$project_root/third_party/tailscale-android"
expected_revision="803d93860da0652d501298883fcc61c70973290b"
ndk_version="23.1.7779620"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

[[ -d "$source_dir/.git" || -f "$source_dir/.git" ]] ||
    fail "Tailscale Android source is missing. Initialize the pinned third_party/tailscale-android submodule."

actual_revision="$(git -C "$source_dir" rev-parse HEAD)"
[[ "$actual_revision" == "$expected_revision" ]] ||
    fail "Tailscale Android source revision mismatch: expected $expected_revision, found $actual_revision."

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
[[ -n "$sdk_root" && -d "$sdk_root" ]] ||
    fail "Android SDK is not configured. Set ANDROID_SDK_ROOT and run npm run android:setup."

ndk_root="$sdk_root/ndk/$ndk_version"
[[ -d "$ndk_root" ]] ||
    fail "Pinned Android NDK $ndk_version is missing from $sdk_root. Run npm run android:setup."

command -v make >/dev/null 2>&1 || fail "GNU make is required to build the Tailscale Android engine."
command -v go >/dev/null 2>&1 || fail "Go is required to build the Tailscale Android engine."

export ANDROID_SDK_ROOT="$sdk_root"
export ANDROID_HOME="$sdk_root"
export ANDROID_NDK_HOME="$ndk_root"
export NDK_ROOT="$ndk_root"

echo "Building Tailscale Android engine from pinned revision $expected_revision"
# The submodule Makefile derives the custom Go wrapper path from PWD.
# Enter it first so gomobile uses Tailscale's runtime fork, not host Go.
(
    cd "$source_dir"
    make libtailscale
)
[[ -s "$source_dir/android/libs/libtailscale.aar" ]] ||
    fail "Tailscale Android build completed without producing libtailscale.aar."