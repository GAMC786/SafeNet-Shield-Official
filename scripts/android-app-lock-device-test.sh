#!/usr/bin/env bash
set -Eeuo pipefail

readonly PACKAGE_NAME="com.safenet.dns"
readonly TEST_PACKAGE_NAME="${PACKAGE_NAME}.test"
readonly TEST_RUNNER="androidx.test.runner.AndroidJUnitRunner"
readonly TEST_CLASS="${PACKAGE_NAME}.AppLockInstrumentationTest"
readonly DEFAULT_APK="artifacts/android/app-release.apk"
readonly DEFAULT_TEST_APK="artifacts/android-test/app-release-androidTest.apk"
readonly UI_FAILURE_SCREENSHOT="/data/local/tmp/safenet-locklock-ui-failure.png"
readonly UI_FAILURE_HIERARCHY="/data/local/tmp/safenet-locklock-ui-failure.xml"

apk_path="${ANDROID_APP_LOCK_APK:-$DEFAULT_APK}"
test_apk_path="${ANDROID_APP_LOCK_TEST_APK:-$DEFAULT_TEST_APK}"
output_dir="${ANDROID_APP_LOCK_OUTPUT_DIR:-android/app/build/reports/android-app-lock/latest}"
serial="${ANDROID_SERIAL:-}"

fail() {
    echo "ERROR: $*" >&2
    exit 2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apk)
            [[ $# -ge 2 ]] || fail "--apk requires a path."
            apk_path="$2"
            shift 2
            ;;
        --test-apk)
            [[ $# -ge 2 ]] || fail "--test-apk requires a path."
            test_apk_path="$2"
            shift 2
            ;;
        --output)
            [[ $# -ge 2 ]] || fail "--output requires a path."
            output_dir="$2"
            shift 2
            ;;
        --serial)
            [[ $# -ge 2 ]] || fail "--serial requires a device ID."
            serial="$2"
            shift 2
            ;;
        --help|-h)
            cat <<'EOF'
Usage: scripts/android-app-lock-device-test.sh [options]

Installs the explicitly named signed SafeNet APKs and runs the LockLock
instrumentation checks on a writable Android runner.

Options:
  --apk PATH       Must be app-release.apk.
  --test-apk PATH  Must be app-release-androidTest.apk.
  --output DIR     Evidence directory.
  --serial ID      adb device or emulator serial.
EOF
            exit 0
            ;;
        *)
            fail "Unknown argument: $1"
            ;;
    esac
done

[[ "$(basename "$apk_path")" == "app-release.apk" ]] ||
    fail "LockLock validation requires the explicitly named app-release.apk."
[[ "$(basename "$test_apk_path")" == "app-release-androidTest.apk" ]] ||
    fail "LockLock validation requires the explicitly named app-release-androidTest.apk."
[[ -s "$apk_path" ]] || fail "Signed release APK was not found: $apk_path"
[[ -s "$test_apk_path" ]] || fail "Release instrumentation APK was not found: $test_apk_path"
command -v adb >/dev/null 2>&1 || fail "adb is required on the dedicated Android runner."

mkdir -p "$output_dir"
rm -f "$output_dir"/*

adb_args=()
if [[ -n "$serial" ]]; then
    adb_args=(-s "$serial")
fi
adb_run() {
    adb "${adb_args[@]}" "$@"
}

adb_run get-state | grep -qx "device" ||
    fail "The dedicated Android runner has no ready device."

cleanup() {
    set +e
    adb_run shell am force-stop "$PACKAGE_NAME" >/dev/null 2>&1
    adb_run shell am force-stop com.android.settings >/dev/null 2>&1
    adb_run shell rm -f "$UI_FAILURE_SCREENSHOT" "$UI_FAILURE_HIERARCHY" >/dev/null 2>&1
}
trap cleanup EXIT

echo "Installing release APKs on Android target ${serial:-default}..."
adb_run install -r -g "$apk_path" > "$output_dir/app-install.log" 2>&1
adb_run install -r "$test_apk_path" > "$output_dir/test-install.log" 2>&1

set +e
adb_run shell am instrument -w -r \
    -e class "$TEST_CLASS" \
    "$TEST_PACKAGE_NAME/$TEST_RUNNER" 2>&1 |
    tee "$output_dir/instrumentation.log"
instrumentation_status="${PIPESTATUS[0]}"
set -e

capture_bounded() {
    local destination="$1"
    shift
    timeout 30s adb_run "$@" 2>&1 |
        head -c 200000 > "$destination" ||
        true
}

capture_bounded "$output_dir/logcat.txt" logcat -d -t 800
capture_bounded "$output_dir/activity-stack.txt" shell dumpsys activity activities
capture_bounded "$output_dir/accessibility.txt" shell dumpsys accessibility
capture_bounded "$output_dir/device-properties.txt" shell getprop
if adb_run shell test -s "$UI_FAILURE_SCREENSHOT" >/dev/null 2>&1; then
    screenshot_size="$(adb_run shell stat -c %s "$UI_FAILURE_SCREENSHOT" 2>/dev/null | tr -d '\r' || true)"
    if [[ "$screenshot_size" =~ ^[0-9]+$ ]] && (( screenshot_size <= 5000000 )); then
        adb_run pull "$UI_FAILURE_SCREENSHOT" "$output_dir/locklock-ui-failure.png" \
            > "$output_dir/locklock-ui-screenshot-pull.log" 2>&1 || true
    else
        printf 'Skipped UI failure screenshot larger than 5000000 bytes (size=%s).\n' \
            "${screenshot_size:-unknown}" > "$output_dir/locklock-ui-screenshot-pull.log"
    fi
fi
if adb_run shell test -s "$UI_FAILURE_HIERARCHY" >/dev/null 2>&1; then
    capture_bounded "$output_dir/locklock-ui-failure.xml" shell cat "$UI_FAILURE_HIERARCHY"
fi

if [[ "$instrumentation_status" -eq 0 ]] &&
    ! grep -Eiq 'FAILURES!!!|INSTRUMENTATION_CODE: -1|INSTRUMENTATION_RESULT: shortMsg=' \
        "$output_dir/instrumentation.log" &&
    grep -Fq 'LOCKLOCK_LIFECYCLE result=PASS' "$output_dir/logcat.txt" &&
    grep -Fq 'LOCKLOCK_ACCESSIBILITY result=PASS' "$output_dir/logcat.txt" &&
    grep -Fq 'LOCKLOCK_UI result=PASS' "$output_dir/logcat.txt"; then
    result="PASS"
else
    result="FAIL"
fi

{
    printf 'target=%s\napk=%s\ntest_apk=%s\n' \
        "${serial:-default}" "$apk_path" "$test_apk_path"
    printf 'instrumentation_status=%s\nresult=%s\n' "$instrumentation_status" "$result"
    printf 'diagnostics=logcat.txt,activity-stack.txt,accessibility.txt,device-properties.txt\n'
    printf 'ui_diagnostics=locklock-ui-failure.png,locklock-ui-failure.xml\n'
} | tee "$output_dir/result.txt"

if [[ "$result" != "PASS" ]]; then
    echo "Android LockLock instrumentation failed. Evidence: $output_dir" >&2
    exit 1
fi
echo "Android LockLock instrumentation passed. Evidence: $output_dir"