#!/usr/bin/env bash
set -Eeuo pipefail

readonly PACKAGE_NAME="com.safenet.dns"
readonly TEST_PACKAGE_NAME="${PACKAGE_NAME}.test"
readonly TEST_RUNNER="androidx.test.runner.AndroidJUnitRunner"
readonly TEST_CLASS="${PACKAGE_NAME}.AppLockInstrumentationTest"
readonly DEFAULT_APK="artifacts/android/app-release.apk"
readonly DEFAULT_TEST_APK="artifacts/android-test/app-release-androidTest.apk"
readonly DEFAULT_APK_CHECKSUM="${DEFAULT_APK}.sha256"
readonly DEFAULT_APK_METADATA="${DEFAULT_APK}.metadata"
readonly UI_FAILURE_SCREENSHOT="/data/local/tmp/safenet-locklock-ui-failure.png"
readonly UI_FAILURE_HIERARCHY="/data/local/tmp/safenet-locklock-ui-failure.xml"

apk_path="${ANDROID_APP_LOCK_APK:-$DEFAULT_APK}"
test_apk_path="${ANDROID_APP_LOCK_TEST_APK:-$DEFAULT_TEST_APK}"
apk_checksum_path="${ANDROID_APP_LOCK_APK_CHECKSUM:-}"
apk_metadata_path="${ANDROID_APP_LOCK_APK_METADATA:-}"
output_dir="${ANDROID_APP_LOCK_OUTPUT_DIR:-android/app/build/reports/android-app-lock/latest}"
serial="${ANDROID_SERIAL:-}"
physical_device=false
target_package="${ANDROID_APP_LOCK_TARGET_PACKAGE:-}"
release_ref="${ANDROID_APP_LOCK_RELEASE_REF:-}"
release_sha="${ANDROID_APP_LOCK_RELEASE_SHA:-}"
apk_sha256=""
package_version_name=""
package_version_code=""
artifact_verification="NOT_RUN"
blocked_mode=false
blocked_category=""
blocked_message=""

fail() {
    local message="$*"
    echo "ERROR: $message" >&2
    if [[ -n "${output_dir:-}" ]]; then
        mkdir -p "$output_dir"
        {
            printf 'release_ref=%s\nrelease_sha=%s\n' \
                "${release_ref:-NOT_RECORDED}" "${release_sha:-NOT_RECORDED}"
            printf 'package_name=%s\nversion_name=%s\nversion_code=%s\n' \
                "$PACKAGE_NAME" "${package_version_name:-NOT_RECORDED}" \
                "${package_version_code:-NOT_RECORDED}"
            printf 'apk=%s\napk_sha256=%s\nartifact_verification=FAIL\n' \
                "$apk_path" "${apk_sha256:-NOT_RECORDED}"
            printf 'result=FAIL\nfailure=%s\n' "$message"
        } > "$output_dir/result.txt"
    fi
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
        --apk-checksum)
            [[ $# -ge 2 ]] || fail "--apk-checksum requires a path."
            apk_checksum_path="$2"
            shift 2
            ;;
        --apk-metadata)
            [[ $# -ge 2 ]] || fail "--apk-metadata requires a path."
            apk_metadata_path="$2"
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
        --physical)
            physical_device=true
            shift
            ;;
        --target-package)
            [[ $# -ge 2 ]] || fail "--target-package requires a package name."
            target_package="$2"
            shift 2
            ;;
        --release-ref)
            [[ $# -ge 2 ]] || fail "--release-ref requires a ref."
            release_ref="$2"
            shift 2
            ;;
        --release-sha)
            [[ $# -ge 2 ]] || fail "--release-sha requires a commit SHA."
            release_sha="$2"
            shift 2
            ;;
        --help|-h)
            cat <<'EOF'
Usage: scripts/android-app-lock-device-test.sh [options]

Installs the explicitly named signed SafeNet APKs and runs the LockLock
instrumentation checks on an Android runner.

Options:
  --apk PATH       Must be app-release.apk.
  --test-apk PATH  Must be app-release-androidTest.apk.
  --apk-checksum PATH  Build-produced SHA-256 file for app-release.apk.
  --apk-metadata PATH  Build-produced release identity metadata for the APK.
  --output DIR     Evidence directory.
  --serial ID      adb device or emulator serial.
  --physical       Require a connected physical phone and run the selected-app proof.
  --target-package Third-party launcher package to protect (optional; auto-detected on phones).
  --release-ref REF  Expected Git ref recorded by the build-android artifact.
  --release-sha SHA  Expected commit recorded by the build-android artifact.
  --blocked         Write bounded BLOCKED evidence without requiring a device or SDK.
  --blocker CODE    Exact infrastructure blocker classification for --blocked.
  --message TEXT    Human-readable blocker message for --blocked.
EOF
            exit 0
            ;;
        --blocked)
            blocked_mode=true
            shift
            ;;
        --blocker)
            [[ $# -ge 2 ]] || fail "--blocker requires a classification."
            blocked_category="$2"
            shift 2
            ;;
        --message)
            [[ $# -ge 2 ]] || fail "--message requires text."
            blocked_message="$2"
            shift 2
            ;;
        *)
            fail "Unknown argument: $1"
            ;;
    esac
done

if [[ -z "$apk_checksum_path" ]]; then
    if [[ "$apk_path" == "$DEFAULT_APK" ]]; then
        apk_checksum_path="$DEFAULT_APK_CHECKSUM"
    else
        apk_checksum_path="${apk_path}.sha256"
    fi
fi
if [[ -z "$apk_metadata_path" ]]; then
    if [[ "$apk_path" == "$DEFAULT_APK" ]]; then
        apk_metadata_path="$DEFAULT_APK_METADATA"
    else
        apk_metadata_path="${apk_path}.metadata"
    fi
fi
mkdir -p "$output_dir"
rm -f "$output_dir"/*

write_bounded_command() {
    local destination="$1"
    shift
    if command -v timeout >/dev/null 2>&1; then
        timeout 30s "$@" 2>&1 | head -c 200000 > "$destination" || true
    else
        "$@" 2>&1 | head -c 200000 > "$destination" || true
    fi
}

write_blocked_result() {
    local category="$1"
    local message="$2"
    local safe_message
    local blocked_release_ref="${release_ref:-}"
    local blocked_release_sha="${release_sha:-}"
    local blocked_package_name="$PACKAGE_NAME"
    local blocked_version_name="NOT_RECORDED"
    local blocked_version_code="NOT_RECORDED"
    local blocked_metadata_sha="NOT_RECORDED"
    local test_apk_sha256="NOT_RECORDED"

    [[ "$category" =~ ^[A-Z0-9_]+$ ]] ||
        fail "Blocked evidence classification must contain only uppercase letters, digits, and underscores."
    safe_message="$(printf '%s' "$message" | tr '\r\n' ' ')"

    metadata_value() {
        local key="$1"
        awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' \
            "$apk_metadata_path" 2>/dev/null || true
    }
    if [[ -s "$apk_metadata_path" ]]; then
        blocked_release_ref="${blocked_release_ref:-$(metadata_value release_ref)}"
        blocked_release_sha="${blocked_release_sha:-$(metadata_value release_sha)}"
        blocked_package_name="$(metadata_value package_name)"
        blocked_version_name="$(metadata_value version_name)"
        blocked_version_code="$(metadata_value version_code)"
        blocked_metadata_sha="$(metadata_value apk_sha256)"
    fi
    blocked_release_ref="${blocked_release_ref:-NOT_RECORDED}"
    blocked_release_sha="${blocked_release_sha:-NOT_RECORDED}"
    blocked_package_name="${blocked_package_name:-NOT_RECORDED}"
    blocked_version_name="${blocked_version_name:-NOT_RECORDED}"
    blocked_version_code="${blocked_version_code:-NOT_RECORDED}"
    blocked_metadata_sha="${blocked_metadata_sha:-NOT_RECORDED}"

    if [[ -s "$apk_path" ]] && command -v sha256sum >/dev/null 2>&1; then
        apk_sha256="$(sha256sum "$apk_path" | awk '{print $1}')"
    fi
    if [[ -s "$test_apk_path" ]] && command -v sha256sum >/dev/null 2>&1; then
        test_apk_sha256="$(sha256sum "$test_apk_path" | awk '{print $1}')"
    fi

    {
        printf 'evidence_schema_version=1\n'
        printf 'validation_mode=physical-device\n'
        printf 'device_kind=physical-device\n'
        printf 'target=%s\n' "${serial:-unavailable}"
        printf 'device_model=NOT_RECORDED\nandroid_version=NOT_RECORDED\n'
        printf 'release_ref=%s\nrelease_sha=%s\n' "$blocked_release_ref" "$blocked_release_sha"
        printf 'package_name=%s\nversion_name=%s\nversion_code=%s\n' \
            "$blocked_package_name" "$blocked_version_name" "$blocked_version_code"
        printf 'apk=%s\ntest_apk=%s\n' "$apk_path" "$test_apk_path"
        printf 'apk_sha256=%s\ntest_apk_sha256=%s\n' "$apk_sha256" "$test_apk_sha256"
        printf 'metadata_apk_sha256=%s\nartifact_verification=NOT_RUN\n' "$blocked_metadata_sha"
        printf 'blocker_class=DEVICE_ACCESS\nblocker_category=%s\n' "$category"
        printf 'failure_class=DEVICE_ACCESS\nfailure_category=%s\n' "$category"
        printf 'result=BLOCKED\nmessage=%s\n' "$safe_message"
        printf 'diagnostics=adb-devices.txt,adb-version.txt,device-properties.txt,runner-metadata.txt\n'
    } | tee "$output_dir/result.txt" "$output_dir/infrastructure-blocker.txt" >&2

    {
        printf 'hostname=%s\n' "$(hostname 2>/dev/null || printf 'NOT_RECORDED')"
        printf 'uname=%s\n' "$(uname -a 2>/dev/null || printf 'NOT_RECORDED')"
        printf 'adb_available=%s\n' \
            "$([[ -n "$(command -v adb 2>/dev/null || true)" ]] && echo true || echo false)"
    } | head -c 200000 > "$output_dir/runner-metadata.txt"
    if command -v adb >/dev/null 2>&1; then
        write_bounded_command "$output_dir/adb-version.txt" adb version
        write_bounded_command "$output_dir/adb-devices.txt" adb devices -l
        if [[ -n "$serial" ]]; then
            write_bounded_command "$output_dir/device-properties.txt" \
                adb -s "$serial" shell getprop
        else
            printf 'No ADB serial was selected during device discovery.\n' \
                > "$output_dir/device-properties.txt"
        fi
    else
        printf 'adb is unavailable on the runner.\n' > "$output_dir/adb-version.txt"
        printf 'adb is unavailable on the runner.\n' > "$output_dir/adb-devices.txt"
        printf 'Device properties were unavailable because adb is not installed.\n' \
            > "$output_dir/device-properties.txt"
    fi
}

if [[ "$blocked_mode" == true ]]; then
    [[ -n "$blocked_category" ]] ||
        fail "--blocked requires --blocker."
    [[ -n "$blocked_message" ]] ||
        fail "--blocked requires --message."
    write_blocked_result "$blocked_category" "$blocked_message"
    exit 78
fi

[[ "$(basename "$apk_path")" == "app-release.apk" ]] ||
    fail "LockLock validation requires the explicitly named app-release.apk."
[[ "$(basename "$test_apk_path")" == "app-release-androidTest.apk" ]] ||
    fail "LockLock validation requires the explicitly named app-release-androidTest.apk."
[[ -s "$apk_path" ]] || fail "Signed release APK was not found: $apk_path"
[[ -s "$test_apk_path" ]] || fail "Release instrumentation APK was not found: $test_apk_path"
[[ -s "$apk_checksum_path" ]] ||
    fail "Build-produced APK checksum was not found: $apk_checksum_path"
[[ -s "$apk_metadata_path" ]] ||
    fail "Build-produced APK metadata was not found: $apk_metadata_path"
command -v sha256sum >/dev/null 2>&1 ||
    fail "sha256sum is required to verify the release artifact."

read_metadata_value() {
    local key="$1"
    local value
    value="$(
        awk -F= -v key="$key" '
            $1 == key { print substr($0, index($0, "=") + 1) }
        ' "$apk_metadata_path"
    )"
    [[ "$(printf '%s\n' "$value" | sed '/^$/d' | wc -l)" -eq 1 ]] ||
        fail "APK metadata must contain exactly one non-empty $key value."
    printf '%s' "$value"
}

metadata_schema_version="$(read_metadata_value schema_version)"
[[ "$metadata_schema_version" == "1" ]] ||
    fail "Unsupported APK metadata schema: $metadata_schema_version"
metadata_release_ref="$(read_metadata_value release_ref)"
metadata_release_sha="$(read_metadata_value release_sha)"
metadata_package_name="$(read_metadata_value package_name)"
package_version_code="$(read_metadata_value version_code)"
package_version_name="$(read_metadata_value version_name)"
metadata_apk_file="$(read_metadata_value apk_file)"
metadata_apk_sha256="$(read_metadata_value apk_sha256)"

[[ "$metadata_apk_file" == "app-release.apk" ]] ||
    fail "APK metadata names an unexpected release file: $metadata_apk_file"
[[ "$metadata_package_name" == "$PACKAGE_NAME" ]] ||
    fail "APK metadata package mismatch: $metadata_package_name"
[[ "$metadata_release_ref" == "$release_ref" || -z "$release_ref" ]] ||
    fail "APK release ref does not match the expected ref: $metadata_release_ref != $release_ref"
[[ "$metadata_release_sha" == "$release_sha" || -z "$release_sha" ]] ||
    fail "APK release commit does not match the expected commit: $metadata_release_sha != $release_sha"
if [[ "$physical_device" == true ]]; then
    [[ -n "$release_ref" ]] ||
        fail "Physical LockLock validation requires the expected release ref."
    [[ -n "$release_sha" ]] ||
        fail "Physical LockLock validation requires the expected release commit."
fi

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
gradle_file="$project_root/android/app/build.gradle"
[[ -s "$gradle_file" ]] || fail "Android release metadata source was not found: $gradle_file"
gradle_version_name="$(
    sed -nE 's/^[[:space:]]*versionName[[:space:]]+"([^"]+)".*$/\1/p' \
        "$gradle_file" | head -n 1
)"
gradle_version_code="$(
    sed -nE 's/^[[:space:]]*versionCode[[:space:]]+([0-9]+).*$/\1/p' \
        "$gradle_file" | head -n 1
)"
[[ "$package_version_name" == "$gradle_version_name" ]] ||
    fail "APK metadata versionName is stale: $package_version_name != $gradle_version_name"
[[ "$package_version_code" == "$gradle_version_code" ]] ||
    fail "APK metadata versionCode is stale: $package_version_code != $gradle_version_code"

checksum_dir="$(dirname "$apk_checksum_path")"
checksum_name="$(basename "$apk_checksum_path")"
(cd "$checksum_dir" && sha256sum --check --status "$checksum_name") ||
    fail "Release APK does not match the build-produced SHA-256 checksum."
apk_sha256="$(sha256sum "$apk_path" | awk '{print $1}')"
[[ "$apk_sha256" == "$metadata_apk_sha256" ]] ||
    fail "Release APK digest does not match build metadata: $apk_sha256 != $metadata_apk_sha256"

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
[[ -n "$sdk_root" ]] || fail "Android SDK is required to verify the signed release APK."
apksigner="$(find "$sdk_root/build-tools" -type f -name apksigner -perm -u+x | sort -V | tail -n 1)"
aapt="$(find "$sdk_root/build-tools" -type f -name aapt -perm -u+x | sort -V | tail -n 1)"
[[ -n "$apksigner" ]] || fail "Android apksigner was not found in $sdk_root/build-tools."
[[ -n "$aapt" ]] || fail "Android aapt was not found in $sdk_root/build-tools."
if ! "$apksigner" verify --verbose "$apk_path" > "$output_dir/apk-signature.txt" 2>&1; then
    fail "Release APK signature verification failed."
fi
if ! "$apksigner" verify --verbose "$test_apk_path" > "$output_dir/test-apk-signature.txt" 2>&1; then
    fail "Release instrumentation APK signature verification failed."
fi
badging="$("$aapt" dump badging "$apk_path" 2> "$output_dir/apk-badging-error.txt")" ||
    fail "Could not read release APK package metadata."
printf '%s\n' "$badging" > "$output_dir/apk-badging.txt"
grep -Fq \
    "package: name='$PACKAGE_NAME' versionCode='$package_version_code' versionName='$package_version_name'" \
    <<< "$badging" ||
    fail "Release APK package/version metadata does not match the build artifact manifest."
test_badging="$("$aapt" dump badging "$test_apk_path" 2> "$output_dir/test-apk-badging-error.txt")" ||
    fail "Could not read release instrumentation APK package metadata."
printf '%s\n' "$test_badging" > "$output_dir/test-apk-badging.txt"
grep -Fq "package: name='${TEST_PACKAGE_NAME}'" <<< "$test_badging" ||
    fail "Release instrumentation APK package metadata is incorrect."
artifact_verification="PASS"

command -v adb >/dev/null 2>&1 || fail "adb is required on the dedicated Android runner."

adb_args=()
if [[ -n "$serial" ]]; then
    adb_args=(-s "$serial")
fi
adb_run() {
    adb "${adb_args[@]}" "$@"
}

adb_run get-state | grep -qx "device" ||
    fail "The dedicated Android runner has no ready device."

device_model="$(adb_run shell getprop ro.product.manufacturer | tr -d '\r')_$(adb_run shell getprop ro.product.model | tr -d '\r')"
android_version="$(adb_run shell getprop ro.build.version.release | tr -d '\r')"
is_emulator="$(adb_run shell getprop ro.kernel.qemu | tr -d '\r')"
if [[ "$physical_device" == true && "$is_emulator" == "1" ]]; then
    fail "Physical LockLock validation rejects an emulator target."
fi
if [[ "$physical_device" == true && "$serial" == emulator-* ]]; then
    fail "Physical LockLock validation rejects emulator serial $serial."
fi

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
instrument_args=(-w -r)
if [[ "$physical_device" == true ]]; then
    instrument_args+=(
        -e class "${TEST_CLASS}#physicalDeviceLocksSelectedThirdPartyAppWithoutDuplicateActivities"
        -e physical_device true
    )
    if [[ -n "$target_package" ]]; then
        instrument_args+=(-e target_package "$target_package")
    fi
else
    instrument_args+=(-e class "$TEST_CLASS")
fi
adb_run shell am instrument "${instrument_args[@]}" \
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
if [[ "$physical_device" == true ]]; then
    capture_bounded "$output_dir/device-policy.txt" shell dumpsys device_policy
    {
        adb_run shell settings get secure enabled_accessibility_services
        adb_run shell dpm list active-admins
    } 2>&1 | head -c 200000 > "$output_dir/permission-state.txt" || true
fi
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

if [[ "$physical_device" == true ]]; then
    detected_target="$(
        sed -n 's/.*LOCKLOCK_PHYSICAL result=PASS.*target_package=\([^ ]*\).*/\1/p' \
            "$output_dir/logcat.txt" | tail -n 1
    )"
    if [[ -n "$detected_target" ]]; then
        target_package="$detected_target"
    fi
    accessibility_state="$(
        sed -n 's/.*LOCKLOCK_PHYSICAL_PERMISSIONS result=PASS.*accessibility=\([^ ]*\).*/\1/p' \
            "$output_dir/logcat.txt" | tail -n 1
    )"
    device_admin_state="$(
        sed -n 's/.*LOCKLOCK_PHYSICAL_PERMISSIONS result=PASS.*device_admin=\([^ ]*\).*/\1/p' \
            "$output_dir/logcat.txt" | tail -n 1
    )"
    {
        adb_run shell dumpsys package "$PACKAGE_NAME"
        if [[ -n "$target_package" && "$target_package" != "$PACKAGE_NAME" ]]; then
            adb_run shell dumpsys package "$target_package"
        fi
    } 2>&1 | head -c 200000 > "$output_dir/package-state.txt" || true
fi

if [[ "$physical_device" == true ]]; then
    if [[ "$instrumentation_status" -eq 0 ]] &&
        ! grep -Eiq 'FAILURES!!!|INSTRUMENTATION_CODE: -1|INSTRUMENTATION_RESULT: shortMsg=' \
            "$output_dir/instrumentation.log" &&
        grep -Fq 'LOCKLOCK_PHYSICAL_PERMISSIONS result=PASS' "$output_dir/logcat.txt" &&
        grep -Fq 'LOCKLOCK_PHYSICAL result=PASS' "$output_dir/logcat.txt" &&
        grep -Fq 'LOCKLOCK_PHYSICAL_APP cycle=1' "$output_dir/logcat.txt" &&
        grep -Fq 'LOCKLOCK_PHYSICAL_APP cycle=2' "$output_dir/logcat.txt" &&
        grep -Fq 'LOCKLOCK_PHYSICAL_APP cycle=3' "$output_dir/logcat.txt" &&
        grep -Fq 'LOCKLOCK_PHYSICAL_RETURN result=PASS' "$output_dir/logcat.txt" &&
        grep -Fq 'LOCKLOCK_PHYSICAL_OTHER_APP result=PASS' "$output_dir/logcat.txt"; then
        result="PASS"
    else
        result="FAIL"
    fi
elif [[ "$instrumentation_status" -eq 0 ]] &&
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
    printf 'release_ref=%s\nrelease_sha=%s\npackage_name=%s\nversion_name=%s\nversion_code=%s\n' \
        "$metadata_release_ref" "$metadata_release_sha" "$metadata_package_name" \
        "$package_version_name" "$package_version_code"
    printf 'apk_sha256=%s\nartifact_verification=%s\n' "$apk_sha256" "$artifact_verification"
    printf 'target=%s\nphysical_device=%s\ndevice_model=%s\nandroid_version=%s\n' \
        "${serial:-default}" "$physical_device" "$device_model" "$android_version"
    printf 'apk=%s\ntest_apk=%s\ntarget_package=%s\n' \
        "$apk_path" "$test_apk_path" "${target_package:-AUTO_DETECTED}"
    if [[ "$physical_device" == true ]]; then
        printf 'accessibility_enabled=%s\ndevice_admin_enabled=%s\n' \
            "${accessibility_state:-NOT_RECORDED}" "${device_admin_state:-NOT_RECORDED}"
        if grep -Fq 'LOCKLOCK_PHYSICAL_RETURN result=PASS' "$output_dir/logcat.txt"; then
            printf 'selected_app_resumed=true\n'
        else
            printf 'selected_app_resumed=false\n'
        fi
        if grep -Fq 'LOCKLOCK_PHYSICAL_OTHER_APP result=PASS' "$output_dir/logcat.txt"; then
            printf 'temporary_unlock_isolated=true\n'
        else
            printf 'temporary_unlock_isolated=false\n'
        fi
    fi
    printf 'instrumentation_status=%s\nresult=%s\n' "$instrumentation_status" "$result"
    printf 'diagnostics=logcat.txt,activity-stack.txt,accessibility.txt,device-properties.txt'
    if [[ "$physical_device" == true ]]; then
        printf ',device-policy.txt,permission-state.txt,package-state.txt'
    fi
    printf '\n'
    printf 'ui_diagnostics=locklock-ui-failure.png,locklock-ui-failure.xml\n'
} | tee "$output_dir/result.txt"

if [[ "$result" != "PASS" ]]; then
    echo "Android LockLock instrumentation failed. Evidence: $output_dir" >&2
    exit 1
fi
echo "Android LockLock instrumentation passed. Evidence: $output_dir"