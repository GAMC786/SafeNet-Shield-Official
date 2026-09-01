#!/usr/bin/env bash
set -Eeuo pipefail

readonly PACKAGE_NAME="com.safenet.dns"
readonly TEST_PACKAGE_NAME="${PACKAGE_NAME}.test"
readonly TEST_RUNNER="androidx.test.runner.AndroidJUnitRunner"
readonly DEFAULT_APK="android/app/build/outputs/apk/release/app-release.apk"
readonly DEFAULT_TEST_APK="android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk"

apk_path="${DEFAULT_APK}"
test_apk_path="${DEFAULT_TEST_APK}"
serial="${ANDROID_SERIAL:-}"
output_dir="${ANDROID_SMOKE_OUTPUT_DIR:-android/app/build/reports/android-smoke/latest}"
plain_primary="${ANDROID_SMOKE_PLAIN_PRIMARY:-1.1.1.1}"
plain_secondary="${ANDROID_SMOKE_PLAIN_SECONDARY:-8.8.8.8}"
doh_secondary="${ANDROID_SMOKE_DOH_SECONDARY:-https://cloudflare-dns.com/dns-query}"
dot_secondary="${ANDROID_SMOKE_DOT_SECONDARY:-cloudflare-dns.com}"
ordinary_url="${ANDROID_SMOKE_ORDINARY_URL:-https://example.com/}"

usage() {
    cat <<'EOF'
Usage: scripts/android-smoke-test.sh [options]

Installs the explicitly named signed release APK and runs SafeNet's Android
instrumentation checks against one attached device or emulator.

Options:
  --apk PATH       Must be app-release.apk (default: android/app/build/outputs/apk/release/app-release.apk)
  --test-apk PATH  Must be app-release-androidTest.apk (default: android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk)
  --serial ID      adb device/emulator serial (or set ANDROID_SERIAL)
  --output DIR     Evidence directory (default: android/app/build/reports/android-smoke/latest)
  --help           Show this help

Resolver endpoints can be overridden with ANDROID_SMOKE_PLAIN_PRIMARY,
ANDROID_SMOKE_PLAIN_SECONDARY, ANDROID_SMOKE_DOH_SECONDARY, and
ANDROID_SMOKE_DOT_SECONDARY. The test intentionally uses an unreachable
192.0.2.1 primary for DoH/DoT fallback.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apk)
            [[ $# -ge 2 ]] || { echo "ERROR: --apk requires a path." >&2; exit 2; }
            apk_path="$2"
            shift 2
            ;;
        --test-apk)
            [[ $# -ge 2 ]] || { echo "ERROR: --test-apk requires a path." >&2; exit 2; }
            test_apk_path="$2"
            shift 2
            ;;
        --serial)
            [[ $# -ge 2 ]] || { echo "ERROR: --serial requires a device ID." >&2; exit 2; }
            serial="$2"
            shift 2
            ;;
        --output)
            [[ $# -ge 2 ]] || { echo "ERROR: --output requires a directory." >&2; exit 2; }
            output_dir="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: Unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [[ "$(basename "$apk_path")" != "app-release.apk" ]]; then
    echo "ERROR: Android smoke tests require the explicitly named app-release.apk; got: $apk_path" >&2
    exit 2
fi
if [[ "$(basename "$test_apk_path")" != "app-release-androidTest.apk" ]]; then
    echo "ERROR: Android smoke tests require the explicitly named app-release-androidTest.apk; got: $test_apk_path" >&2
    exit 2
fi
if [[ ! -f "$apk_path" ]]; then
    echo "ERROR: Release APK not found: $apk_path" >&2
    echo "Build android/app/build/outputs/apk/release/app-release.apk first." >&2
    exit 2
fi
if [[ ! -f "$test_apk_path" ]]; then
    echo "ERROR: Release instrumentation APK not found: $test_apk_path" >&2
    echo "Build app-release-androidTest.apk with assembleReleaseAndroidTest first." >&2
    exit 2
fi
command -v adb >/dev/null 2>&1 || {
    echo "ERROR: adb is required. Run this lane on an Android SDK runner or emulator host." >&2
    exit 2
}

mkdir -p "$output_dir"
rm -f "$output_dir"/instrumentation.log "$output_dir"/result.txt "$output_dir"/failure-category.txt

adb_args=()
if [[ -n "$serial" ]]; then
    adb_args=(-s "$serial")
fi
adb_run() {
    adb "${adb_args[@]}" "$@"
}
capture() {
    local name="$1"
    shift
    {
        echo "\$ $*"
        "$@" 2>&1 || echo "[command exited $?, evidence may be incomplete]"
    } > "$output_dir/$name"
}

if [[ -z "$serial" ]]; then
    mapfile -t online_devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
    if [[ "${#online_devices[@]}" -eq 0 ]]; then
        echo "ERROR: No Android device or emulator is connected." >&2
        echo "Attach a target or start an emulator, then rerun this lane." >&2
        exit 3
    fi
    if [[ "${#online_devices[@]}" -gt 1 ]]; then
        echo "ERROR: More than one Android target is connected; pass --serial." >&2
        printf '  %s\n' "${online_devices[@]}" >&2
        exit 3
    fi
    serial="${online_devices[0]}"
    adb_args=(-s "$serial")
fi

if ! adb_run get-state | grep -qx "device"; then
    echo "ERROR: adb target '$serial' is not online." >&2
    exit 3
fi

apksigner_bin="$(command -v apksigner || true)"
if [[ -z "$apksigner_bin" ]]; then
    sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
    if [[ -n "$sdk_root" && -d "$sdk_root/build-tools" ]]; then
        apksigner_bin="$(find "$sdk_root/build-tools" -type f -name apksigner -perm -u+x \
            | sort -V | tail -n 1)"
    fi
fi
if [[ -z "$apksigner_bin" ]]; then
    echo "ERROR: apksigner is required to verify the release APK signature." >&2
    echo "Use an Android SDK runner with build-tools installed." >&2
    exit 2
fi
for signed_apk in "$apk_path" "$test_apk_path"; do
    signature_report="$output_dir/$(basename "$signed_apk").signature.txt"
    if ! "$apksigner_bin" verify --verbose "$signed_apk" > "$signature_report" 2>&1; then
        echo "ERROR: $signed_apk is not a valid signed APK." >&2
        cat "$signature_report" >&2
        exit 2
    fi
done

capture device-details adb "${adb_args[@]}" shell sh -c \
    'echo "serial=$(getprop ro.serialno)"; echo "manufacturer=$(getprop ro.product.manufacturer)"; echo "model=$(getprop ro.product.model)"; echo "android=$(getprop ro.build.version.release)"; echo "sdk=$(getprop ro.build.version.sdk)"; echo "abi=$(getprop ro.product.cpu.abi)"'
capture network-connectivity adb "${adb_args[@]}" shell dumpsys connectivity
capture network-ip-route adb "${adb_args[@]}" shell sh -c 'ip addr; echo "--- routes ---"; ip route'
capture network-proc-route adb "${adb_args[@]}" shell cat /proc/net/route

echo "Installing $apk_path on Android target $serial..."
adb_run uninstall "$PACKAGE_NAME" >/dev/null 2>&1 || true
adb_run uninstall "$TEST_PACKAGE_NAME" >/dev/null 2>&1 || true
adb_run install "$apk_path"
adb_run install "$test_apk_path"

echo "Running SafeNet DNS instrumentation..."
set +e
adb_run shell am instrument -w -r \
    -e class com.safenet.dns.SafeNetVpnInstrumentationTest \
    -e plain-primary "$plain_primary" \
    -e plain-secondary "$plain_secondary" \
    -e doh-secondary "$doh_secondary" \
    -e dot-secondary "$dot_secondary" \
    -e ordinary-url "$ordinary_url" \
    "$TEST_PACKAGE_NAME/$TEST_RUNNER" 2>&1 | tee "$output_dir/instrumentation.log"
instrumentation_status="${PIPESTATUS[0]}"
set -e

# Capture the VPN and network state even after a failed test. This is the
# evidence needed to tell a route problem from an upstream resolver problem.
capture post-test-connectivity adb "${adb_args[@]}" shell dumpsys connectivity
capture post-test-vpn adb "${adb_args[@]}" shell dumpsys vpn
capture post-test-logcat adb "${adb_args[@]}" shell logcat -d -t 400

test_failed=0
if [[ "$instrumentation_status" -ne 0 ]] ||
    grep -Eiq 'FAILURES!!!|INSTRUMENTATION_CODE: -1|INSTRUMENTATION_RESULT: shortMsg=' \
        "$output_dir/instrumentation.log"; then
    test_failed=1
fi

failure_category="PASS"
if [[ "$test_failed" -ne 0 ]]; then
    evidence="$output_dir/instrumentation.log $output_dir/post-test-connectivity $output_dir/post-test-vpn $output_dir/post-test-logcat"
    if grep -Eiq 'ENETUNREACH|Network is unreachable' $evidence; then
        failure_category="ENETUNREACH"
    elif grep -Eiq 'EAI_AGAIN|UnknownHost|UnknownHostException|timed out|timeout|ECONNREFUSED|Connection reset|network unavailable' $evidence; then
        failure_category="UNRELATED_NETWORK_FAILURE"
    else
        failure_category="NON_NETWORK_FAILURE"
    fi
fi
printf '%s\n' "$failure_category" | tee "$output_dir/failure-category.txt"
printf 'target=%s\napk=%s\ninstrumentation_status=%s\nfailure_category=%s\n' \
    "$serial" "$apk_path" "$instrumentation_status" "$failure_category" | tee "$output_dir/result.txt"

if [[ "$test_failed" -ne 0 ]]; then
    echo "Android DNS smoke tests failed ($failure_category)." >&2
    echo "Evidence: $output_dir" >&2
    if [[ "$instrumentation_status" -eq 0 ]]; then
        exit 1
    fi
    exit "$instrumentation_status"
fi

echo "Android DNS smoke tests passed. Evidence: $output_dir"