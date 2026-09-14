#!/usr/bin/env bash
set -Eeuo pipefail

# Run the same native debug APK build used as the pre-release compile gate.
# The build includes SafeNetVpnPlugin and SafeNetVpnService, so resolver
# address-family forwarding must compile before any APK can be published.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
android_dir="$project_root/android"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

[[ -d "$android_dir" ]] || fail "Android project directory was not found: $android_dir"

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk_root" && -f "$android_dir/local.properties" ]]; then
    sdk_root="$(sed -nE 's/^[[:space:]]*sdk\.dir[[:space:]]*=[[:space:]]*//p' \
        "$android_dir/local.properties" | head -n1)"
    sdk_root="${sdk_root//\\:/\:}"
fi

[[ -n "$sdk_root" ]] ||
    fail "Android SDK location is not configured. Set ANDROID_SDK_ROOT (or ANDROID_HOME), then run npm run android:setup."
[[ -d "$sdk_root" ]] ||
    fail "Android SDK directory does not exist: $sdk_root"

# Export both names because Gradle and Android tooling use different
# conventions across local shells and hosted runners.
export ANDROID_SDK_ROOT="$sdk_root"
export ANDROID_HOME="$sdk_root"

echo "Compiling Android native sources with the pinned SDK at $sdk_root"
cd "$android_dir"
./gradlew --no-daemon assembleDebug --rerun-tasks