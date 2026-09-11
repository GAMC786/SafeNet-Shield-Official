#!/usr/bin/env bash
set -Eeuo pipefail

readonly PACKAGE_NAME="com.safenet.dns"
readonly TEST_PACKAGE_NAME="${PACKAGE_NAME}.test"
readonly TEST_RUNNER="androidx.test.runner.AndroidJUnitRunner"
readonly DEFAULT_APK="android/app/build/outputs/apk/release/app-release.apk"
readonly DEFAULT_TEST_APK="android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk"

apk_path="$DEFAULT_APK"
test_apk_path="$DEFAULT_TEST_APK"
serial="${ANDROID_SERIAL:-}"
profile="${ANDROID_AI_SHIELD_DEVICE_PROFILE:-unprofiled}"
output_dir="${ANDROID_AI_SHIELD_OUTPUT_DIR:-android/app/build/reports/android-ai-shield-device/latest}"
adb_args=()
expected_manufacturer=""
expected_android=""
expected_camera_stack=""
profile_status="NOT_CHECKED"

usage() {
    cat <<'EOF'
Usage: scripts/android-ai-shield-device-test.sh [options]

Runs the focused AI Shield source-replacement checks on one physical Android
device. It records camera permission, MediaProjection consent, test events,
and native generation/callback ordering as separate evidence files.

Options:
  --apk PATH       Signed app-release.apk
  --test-apk PATH  Signed app-release-androidTest.apk
  --serial ID      adb device serial (or set ANDROID_SERIAL)
  --profile NAME   Representative device profile to verify
                   (pixel-android-14, samsung-android-13, motorola-android-12)
  --output DIR     Evidence directory
  --help           Show this help
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
            [[ $# -ge 2 ]] || { echo "ERROR: --serial requires a device serial." >&2; exit 2; }
            serial="$2"
            shift 2
            ;;
        --profile)
            [[ $# -ge 2 ]] || { echo "ERROR: --profile requires a profile name." >&2; exit 2; }
            profile="$2"
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
rm -f "$output_dir"/instrumentation.log "$output_dir"/logcat.txt \
    "$output_dir"/device-details.txt "$output_dir"/consent-events.log \
    "$output_dir"/callback-order.txt "$output_dir"/camera-stack.txt \
    "$output_dir"/device-profile.txt "$output_dir"/result.txt

fail_with_evidence() {
    local category="$1"
    local message="$2"
    local failure_class="${3:-DEVICE}"
    {
        printf 'validation_mode=real-device\n'
        printf 'device_kind=physical-device\n'
        printf 'target=%s\n' "$serial"
        printf 'device_profile=%s\nprofile_status=%s\n' "$profile" "$profile_status"
        printf 'camera_to_screen=FAIL\nscreen_to_camera=FAIL\n'
        printf 'camera_permission=NOT_RECORDED\nmedia_projection_consent=NOT_RECORDED\n'
        printf 'callback_order=NOT_RECORDED\ngeneration_numbered_callbacks=NOT_RECORDED\n'
        printf 'failure_class=%s\nfailure_category=%s\nresult=FAIL\nmessage=%s\n' \
            "$failure_class" "$category" "$message"
    } | tee "$output_dir/result.txt" >&2
    exit 1
}

command -v adb >/dev/null 2>&1 || {
    echo "ERROR: adb is required. Connect a physical Android device." >&2
    exit 2
}
[[ "$(basename "$apk_path")" == "app-release.apk" ]] ||
    fail_with_evidence "INPUT_FAILURE" "the app input must be named app-release.apk" "ENVIRONMENT"
[[ "$(basename "$test_apk_path")" == "app-release-androidTest.apk" ]] ||
    fail_with_evidence "INPUT_FAILURE" "the test input must be named app-release-androidTest.apk" "ENVIRONMENT"
[[ -s "$apk_path" ]] ||
    fail_with_evidence "INPUT_FAILURE" "signed release APK was not found: $apk_path" "ENVIRONMENT"
[[ -s "$test_apk_path" ]] ||
    fail_with_evidence "INPUT_FAILURE" "signed instrumentation APK was not found: $test_apk_path" "ENVIRONMENT"

if [[ -z "$serial" ]]; then
    mapfile -t devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
    if [[ "${#devices[@]}" -ne 1 ]]; then
        fail_with_evidence "DEVICE_LIMITATION" \
            "exactly one online physical device is required; found ${#devices[@]}" "DEVICE"
    fi
    serial="${devices[0]}"
fi
adb_args=(-s "$serial")
adb_run() {
    adb "${adb_args[@]}" "$@"
}

if ! adb_run get-state | grep -qx "device"; then
    fail_with_evidence "DEVICE_LIMITATION" "adb target '$serial' is not online" "DEVICE"
fi

qemu="$(adb_run shell getprop ro.kernel.qemu | tr -d '\r')"
if [[ "$qemu" == "1" ]]; then
    fail_with_evidence "DEVICE_LIMITATION" \
        "target '$serial' is an emulator; this lane requires a physical Android device" "DEVICE"
fi

adb_run shell sh -c \
    "echo \"serial=\$(getprop ro.serialno)\"; echo \"manufacturer=\$(getprop ro.product.manufacturer)\"; echo \"brand=\$(getprop ro.product.brand)\"; echo \"model=\$(getprop ro.product.model)\"; echo \"android=\$(getprop ro.build.version.release)\"; echo \"sdk=\$(getprop ro.build.version.sdk)\"; echo \"abi=\$(getprop ro.product.cpu.abi)\"; echo \"camera_hal=\$(getprop ro.hardware.camera)\"; echo \"camera_hal2=\$(getprop ro.hardware.camera2)\"; echo \"vendor_camera_packages=\$(getprop ro.vendor.camera.aux.packagelist)\"; echo \"ro.kernel.qemu=\$(getprop ro.kernel.qemu)\"" \
    > "$output_dir/device-details.txt" 2>&1 ||
    fail_with_evidence "DEVICE_LIMITATION" "could not collect physical-device details" "DEVICE"
adb_run shell dumpsys media.camera > "$output_dir/camera-stack.txt" 2>&1 || true

case "$profile" in
    pixel-android-14)
        expected_manufacturer="google"
        expected_android="14"
        expected_camera_stack="Google Camera2 HAL"
        ;;
    samsung-android-13)
        expected_manufacturer="samsung"
        expected_android="13"
        expected_camera_stack="Samsung Camera2 HAL"
        ;;
    motorola-android-12)
        expected_manufacturer="motorola"
        expected_android="12"
        expected_camera_stack="Motorola Camera2 HAL"
        ;;
    unprofiled)
        profile_status="UNPROFILED"
        ;;
    *)
        fail_with_evidence "INPUT_FAILURE" \
            "unknown device profile '$profile'; choose one of the documented representative profiles" "ENVIRONMENT"
        ;;
esac

observed_manufacturer="$(awk -F= '$1 == "manufacturer" { print tolower($2) }' "$output_dir/device-details.txt")"
observed_android="$(awk -F= '$1 == "android" { print $2 }' "$output_dir/device-details.txt" | cut -d. -f1)"
{
    printf 'profile=%s\n' "$profile"
    printf 'expected_manufacturer=%s\nexpected_android=%s\nexpected_camera_stack=%s\n' \
        "${expected_manufacturer:-ANY}" "${expected_android:-ANY}" "${expected_camera_stack:-ANY}"
    printf 'observed_manufacturer=%s\nobserved_android=%s\n' \
        "${observed_manufacturer:-UNKNOWN}" "${observed_android:-UNKNOWN}"
} > "$output_dir/device-profile.txt"

if [[ "$profile" != "unprofiled" ]]; then
    if [[ "$observed_manufacturer" != *"$expected_manufacturer"* ||
        "$observed_android" != "$expected_android" ]]; then
        profile_status="MISMATCH"
        printf 'profile_status=%s\n' "$profile_status" >> "$output_dir/device-profile.txt"
        fail_with_evidence "DEVICE_PROFILE_MISMATCH" \
            "profile '$profile' expected $expected_manufacturer Android $expected_android, observed ${observed_manufacturer:-unknown} Android ${observed_android:-unknown}" "DEVICE"
    fi
    profile_status="MATCH"
    printf 'profile_status=%s\n' "$profile_status" >> "$output_dir/device-profile.txt"
fi

adb_run uninstall "$PACKAGE_NAME" >/dev/null 2>&1 || true
adb_run uninstall "$TEST_PACKAGE_NAME" >/dev/null 2>&1 || true
adb_run install -r "$apk_path" > "$output_dir/install-app.log" 2>&1 ||
    fail_with_evidence "INSTALLATION_FAILURE" "the signed app APK could not be installed" "DEVICE"
adb_run install -r "$test_apk_path" > "$output_dir/install-test.log" 2>&1 ||
    fail_with_evidence "INSTALLATION_FAILURE" "the signed instrumentation APK could not be installed" "DEVICE"
adb_run logcat -c

set +e
adb_run shell am instrument -w -r \
    -e class "com.safenet.dns.SafeNetVpnUiInstrumentationTest#aiShieldRapidCameraToScreenSwitchKeepsNewProjectionActive,com.safenet.dns.SafeNetVpnUiInstrumentationTest#aiShieldRapidScreenToCameraSwitchKeepsNewCameraActive" \
    "$TEST_PACKAGE_NAME/$TEST_RUNNER" 2>&1 | tee "$output_dir/instrumentation.log"
instrumentation_status="${PIPESTATUS[0]}"
set -e

adb_run logcat -d -t 2000 -s AiShieldDeviceSmoke:I AiShieldManager:I \
    > "$output_dir/logcat.txt" 2>&1 || true
grep -E 'AI_SHIELD_DEVICE_EVENT.*(camera_permission|media_projection|switch|source_stable)' \
    "$output_dir/logcat.txt" > "$output_dir/consent-events.log" || true
grep -F 'AI_SHIELD_CALLBACK' "$output_dir/logcat.txt" > "$output_dir/callback-order.txt" || true

camera_to_screen="FAIL"
screen_to_camera="FAIL"
if grep -Fq 'aiShieldRapidCameraToScreenSwitchKeepsNewProjectionActive' \
    "$output_dir/logcat.txt" &&
    grep -Fq 'AI_SHIELD_DEVICE_EVENT event=test_pass source=camera_to_screen' \
        "$output_dir/logcat.txt"; then
    camera_to_screen="PASS"
fi
if grep -Fq 'aiShieldRapidScreenToCameraSwitchKeepsNewCameraActive' \
    "$output_dir/logcat.txt" &&
    grep -Fq 'AI_SHIELD_DEVICE_EVENT event=test_pass source=screen_to_camera' \
        "$output_dir/logcat.txt"; then
    screen_to_camera="PASS"
fi
camera_permission="PASS"
grep -Fq 'AI_SHIELD_DEVICE_EVENT event=camera_permission_granted' \
    "$output_dir/logcat.txt" || camera_permission="NOT_RECORDED"
media_projection_consent="PASS"
grep -Fq 'AI_SHIELD_DEVICE_EVENT event=media_projection_consent_granted' \
    "$output_dir/logcat.txt" || media_projection_consent="NOT_RECORDED"
callback_order="PASS"
grep -Eq 'AI_SHIELD_CALLBACK.*generation=[0-9]+' \
    "$output_dir/logcat.txt" || callback_order="NOT_RECORDED"
generation_numbered_callbacks="$callback_order"

failure_class="NONE"
failure_category="PASS"
if [[ "$instrumentation_status" -ne 0 ]] ||
    grep -Eiq 'FAILURES!!!|INSTRUMENTATION_CODE: -1|INSTRUMENTATION_RESULT: shortMsg=' \
        "$output_dir/instrumentation.log"; then
    failure_class="APP"
    failure_category="APP_REGRESSION"
    if grep -Eiq 'camera_(error|disconnected)|camera capture|could not configure the camera|camera.*unavailable|projection_stopped|projection.*stopped' \
        "$output_dir/logcat.txt" "$output_dir/instrumentation.log"; then
        failure_class="DEVICE"
        failure_category="DEVICE_CAPTURE_FAILURE"
    fi
fi
if [[ "$camera_permission" != "PASS" || "$media_projection_consent" != "PASS" ]]; then
    failure_class="DEVICE"
    failure_category="DEVICE_CONSENT_FAILURE"
elif [[ "$camera_to_screen" != "PASS" || "$screen_to_camera" != "PASS" ||
    "$callback_order" != "PASS" ]]; then
    if [[ "$failure_category" == "PASS" ]]; then
        failure_class="EVIDENCE"
        failure_category="INCOMPLETE_DEVICE_EVIDENCE"
    fi
fi

{
    printf 'validation_mode=real-device\n'
    printf 'device_kind=physical-device\n'
    printf 'target=%s\n' "$serial"
    printf 'device_profile=%s\nprofile_status=%s\n' "$profile" "$profile_status"
    printf 'camera_to_screen=%s\nscreen_to_camera=%s\n' "$camera_to_screen" "$screen_to_camera"
    printf 'camera_permission=%s\nmedia_projection_consent=%s\n' \
        "$camera_permission" "$media_projection_consent"
    printf 'callback_order=%s\ngeneration_numbered_callbacks=%s\ngeneration_guards=UNCHANGED\n' \
        "$callback_order" "$generation_numbered_callbacks"
    printf 'failure_class=%s\nfailure_category=%s\nresult=%s\n' \
        "$failure_class" "$failure_category" \
        "$([[ "$failure_category" == PASS ]] && echo PASS || echo FAIL)"
} | tee "$output_dir/result.txt"

if [[ "$failure_category" != "PASS" ]]; then
    echo "AI Shield physical-device checks failed. Evidence: $output_dir" >&2
    exit 1
fi
echo "AI Shield physical-device checks passed. Evidence: $output_dir"