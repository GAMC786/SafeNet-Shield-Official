#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_APK="android/app/build/outputs/apk/release/app-release.apk"
readonly DEFAULT_TEST_APK="android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk"
readonly SMOKE_SCRIPT="scripts/android-smoke-test.sh"

apk_path="$DEFAULT_APK"
test_apk_path="$DEFAULT_TEST_APK"
serial="${ANDROID_SERIAL:-}"
output_dir="${ANDROID_PHYSICAL_CONNECTIVITY_OUTPUT_DIR:-android/app/build/reports/android-physical-connectivity/latest}"

usage() {
    cat <<'EOF'
Usage: scripts/android-physical-connectivity-test.sh [options]

Runs the signed Android connectivity-recovery smoke on one physical Android
device. Hosted emulators are rejected so their results cannot be reported as
physical-device evidence.

Options:
  --apk PATH       Signed app-release.apk
  --test-apk PATH  Signed app-release-androidTest.apk
  --serial ID      Physical device serial (or set ANDROID_SERIAL)
  --output DIR     Evidence directory
  --help           Show this help

The wrapper uses the public resolver mode because a physical device cannot
reach the emulator-only 10.0.2.2 fixture address. The packaged test still
validates local VPN DNS filtering while Android airplane mode is toggled.
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

mkdir -p "$output_dir"
rm -f "$output_dir"/result.txt \
    "$output_dir"/device-access-result.txt \
    "$output_dir"/adb-devices.txt \
    "$output_dir"/physical-device-details.txt \
    "$output_dir"/smoke-run.log

write_device_access_result() {
    local category="$1"
    local message="$2"
    local target="${serial:-unavailable}"
    {
        printf 'validation_mode=real-device\n'
        printf 'device_kind=physical-device\n'
        printf 'target=%s\n' "$target"
        printf 'device_access=BLOCKED\n'
        printf 'failure_class=DEVICE_ACCESS\n'
        printf 'failure_category=%s\n' "$category"
        printf 'result=BLOCKED\n'
        printf 'message=%s\n' "$message"
    } | tee "$output_dir/device-access-result.txt" "$output_dir/result.txt" >&2
    echo "Physical Android connectivity smoke was blocked ($category): $message" >&2
    exit 78
}

command -v adb >/dev/null 2>&1 ||
    write_device_access_result "ADB_UNAVAILABLE" "adb is not installed on the dedicated device runner"

if ! adb start-server > "$output_dir/adb-start-server.txt" 2>&1; then
    write_device_access_result "ADB_UNAVAILABLE" "adb could not start its server"
fi

adb devices -l > "$output_dir/adb-devices.txt" 2>&1 || {
    write_device_access_result "ADB_UNAVAILABLE" "adb could not enumerate Android targets"
}

device_is_physical() {
    local candidate="$1"
    local qemu
    qemu="$(adb -s "$candidate" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r' || true)"
    [[ "$qemu" != "1" ]]
}

if [[ -n "$serial" ]]; then
    if ! adb -s "$serial" get-state 2>/dev/null | tr -d '\r' | grep -qx "device"; then
        write_device_access_result "TARGET_OFFLINE" "the configured physical device is not online"
    fi
    device_is_physical "$serial" ||
        write_device_access_result "EMULATOR_TARGET" "the configured target reports ro.kernel.qemu=1"
else
    mapfile -t online_devices < <(
        adb devices | awk 'NR > 1 && $2 == "device" { print $1 }'
    )
    physical_devices=()
    for candidate in "${online_devices[@]}"; do
        if device_is_physical "$candidate"; then
            physical_devices+=("$candidate")
        fi
    done
    if [[ "${#physical_devices[@]}" -eq 0 ]]; then
        if [[ "${#online_devices[@]}" -gt 0 ]]; then
            write_device_access_result "EMULATOR_ONLY" "only emulator targets are online; a physical device is required"
        fi
        write_device_access_result "NO_PHYSICAL_DEVICE" "no online physical Android device was found"
    fi
    if [[ "${#physical_devices[@]}" -gt 1 ]]; then
        printf 'physical_target=%s\n' "${physical_devices[@]}" > "$output_dir/physical-device-candidates.txt"
        write_device_access_result "AMBIGUOUS_TARGET" "more than one physical Android device is online; pass --serial"
    fi
    serial="${physical_devices[0]}"
fi

{
    printf 'serial=%s\n' "$serial"
    printf 'manufacturer=%s\n' "$(adb -s "$serial" shell getprop ro.product.manufacturer | tr -d '\r')"
    printf 'model=%s\n' "$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')"
    printf 'android=%s\n' "$(adb -s "$serial" shell getprop ro.build.version.release | tr -d '\r')"
    printf 'sdk=%s\n' "$(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')"
    printf 'abi=%s\n' "$(adb -s "$serial" shell getprop ro.product.cpu.abi | tr -d '\r')"
    printf 'ro.kernel.qemu=%s\n' "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')"
} | tee "$output_dir/physical-device-details.txt"

export ANDROID_SERIAL="$serial"
export ANDROID_SMOKE_RESOLVER_MODE=public
export ANDROID_SMOKE_VALIDATION_MODE=real-device
export ANDROID_SMOKE_DEVICE_KIND=physical-device
export ANDROID_SMOKE_OUTPUT_DIR="$output_dir"

set +e
bash "$SMOKE_SCRIPT" \
    --apk "$apk_path" \
    --test-apk "$test_apk_path" \
    --serial "$serial" \
    --resolver-mode public \
    --output "$output_dir" 2>&1 | tee "$output_dir/smoke-run.log"
smoke_status="${PIPESTATUS[0]}"
set -e

smoke_category="$(
    awk -F= '$1 == "failure_category" { print $2; exit }' \
        "$output_dir/result.txt" 2>/dev/null || true
)"
smoke_category="${smoke_category:-APPLICATION_SMOKE_FAILURE}"
smoke_result_file="$output_dir/smoke-result.txt"
if [[ -f "$output_dir/result.txt" ]]; then
    cp "$output_dir/result.txt" "$smoke_result_file"
fi
connectivity_recovery="$(
    awk -F= '$1 == "connectivity_recovery" { print $2; exit }' \
        "$smoke_result_file" 2>/dev/null || true
)"
connectivity_recovery="${connectivity_recovery:-NOT_RECORDED}"
if [[ "$smoke_status" -eq 0 && "$smoke_category" == "PASS" ]]; then
    result="PASS"
    failure_class="NONE"
else
    result="FAIL"
    failure_class="APPLICATION"
fi

{
    printf 'validation_mode=real-device\n'
    printf 'device_kind=physical-device\n'
    printf 'target=%s\n' "$serial"
    printf 'device_access=PASS\n'
    printf 'failure_class=%s\n' "$failure_class"
    printf 'failure_category=%s\n' "$smoke_category"
    printf 'connectivity_recovery=%s\n' "$connectivity_recovery"
    printf 'smoke_exit_code=%s\n' "$smoke_status"
    printf 'result=%s\n' "$result"
} | tee "$output_dir/physical-connectivity-result.txt" "$output_dir/result.txt"

if [[ "$result" != "PASS" ]]; then
    echo "Physical Android connectivity smoke failed ($smoke_category)." >&2
    echo "Evidence: $output_dir" >&2
    exit 1
fi

echo "Physical Android connectivity smoke passed. Evidence: $output_dir"