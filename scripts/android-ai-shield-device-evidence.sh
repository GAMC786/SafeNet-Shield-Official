#!/usr/bin/env bash
set -Eeuo pipefail

logcat_path=""
instrumentation_path=""
instrumentation_status="0"
output_path=""
target="unknown"
profile="unprofiled"
profile_status="NOT_CHECKED"

usage() {
    cat <<'EOF'
Usage: scripts/android-ai-shield-device-evidence.sh [options]

Parses captured physical-device AI Shield logs without requiring ADB.

Options:
  --logcat PATH                 Captured AI Shield logcat
  --instrumentation-log PATH    Captured instrumentation output
  --instrumentation-status N    Exit status from am instrument (default: 0)
  --output PATH                 Evidence result file
  --target ID                   Device serial for the result
  --profile NAME                Device profile for the result
  --profile-status STATUS       Profile check status for the result
  --help                        Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --logcat)
            [[ $# -ge 2 ]] || { echo "ERROR: --logcat requires a path." >&2; exit 2; }
            logcat_path="$2"
            shift 2
            ;;
        --instrumentation-log)
            [[ $# -ge 2 ]] || {
                echo "ERROR: --instrumentation-log requires a path." >&2
                exit 2
            }
            instrumentation_path="$2"
            shift 2
            ;;
        --instrumentation-status)
            [[ $# -ge 2 ]] || {
                echo "ERROR: --instrumentation-status requires a value." >&2
                exit 2
            }
            instrumentation_status="$2"
            shift 2
            ;;
        --output)
            [[ $# -ge 2 ]] || { echo "ERROR: --output requires a path." >&2; exit 2; }
            output_path="$2"
            shift 2
            ;;
        --target)
            [[ $# -ge 2 ]] || { echo "ERROR: --target requires a value." >&2; exit 2; }
            target="$2"
            shift 2
            ;;
        --profile)
            [[ $# -ge 2 ]] || { echo "ERROR: --profile requires a value." >&2; exit 2; }
            profile="$2"
            shift 2
            ;;
        --profile-status)
            [[ $# -ge 2 ]] || {
                echo "ERROR: --profile-status requires a value." >&2
                exit 2
            }
            profile_status="$2"
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

[[ -n "$logcat_path" && -r "$logcat_path" ]] || {
    echo "ERROR: a readable --logcat file is required." >&2
    exit 2
}
[[ -n "$instrumentation_path" && -r "$instrumentation_path" ]] || {
    echo "ERROR: a readable --instrumentation-log file is required." >&2
    exit 2
}
[[ -n "$output_path" ]] || {
    echo "ERROR: --output is required." >&2
    exit 2
}

has_log_marker() {
    grep -Fq -- "$1" "$logcat_path"
}

camera_to_screen="FAIL"
screen_to_camera="FAIL"
if has_log_marker "aiShieldRapidCameraToScreenSwitchKeepsNewProjectionActive" &&
    has_log_marker "AI_SHIELD_DEVICE_EVENT event=test_pass source=camera_to_screen"; then
    camera_to_screen="PASS"
fi
if has_log_marker "aiShieldRapidScreenToCameraSwitchKeepsNewCameraActive" &&
    has_log_marker "AI_SHIELD_DEVICE_EVENT event=test_pass source=screen_to_camera"; then
    screen_to_camera="PASS"
fi

camera_permission="PASS"
has_log_marker "AI_SHIELD_DEVICE_EVENT event=camera_permission_granted source=camera" ||
    camera_permission="NOT_RECORDED"
media_projection_consent="PASS"
has_log_marker \
    "AI_SHIELD_DEVICE_EVENT event=media_projection_consent_granted source=screen" ||
    media_projection_consent="NOT_RECORDED"

callback_order="PASS"
callback_lines="$(grep -F 'AI_SHIELD_CALLBACK' "$logcat_path" || true)"
if [[ -z "$callback_lines" ]] ||
    printf '%s\n' "$callback_lines" |
        grep -Evq \
            'AI_SHIELD_CALLBACK[[:space:]]+event=[^[:space:]]+[[:space:]]+source=(camera|screen)[[:space:]]+generation=[0-9]+[[:space:]]+active=(true|false)'; then
    callback_order="NOT_RECORDED"
fi
generation_numbered_callbacks="$callback_order"

failure_class="NONE"
failure_category="PASS"
if [[ "$instrumentation_status" != "0" ]] ||
    grep -Eiq 'FAILURES!!!|INSTRUMENTATION_CODE: -1|INSTRUMENTATION_RESULT: shortMsg=' \
        "$instrumentation_path"; then
    failure_class="APP"
    failure_category="APP_REGRESSION"
    if grep -Eiq \
        'camera_(error|disconnected)|camera capture|could not configure the camera|camera.*unavailable|projection_stopped|projection.*stopped' \
        "$logcat_path" "$instrumentation_path"; then
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

mkdir -p "$(dirname "$output_path")"
{
    printf 'validation_mode=real-device\n'
    printf 'device_kind=physical-device\n'
    printf 'target=%s\n' "$target"
    printf 'device_profile=%s\nprofile_status=%s\n' "$profile" "$profile_status"
    printf 'camera_to_screen=%s\nscreen_to_camera=%s\n' "$camera_to_screen" "$screen_to_camera"
    printf 'camera_permission=%s\nmedia_projection_consent=%s\n' \
        "$camera_permission" "$media_projection_consent"
    printf 'callback_order=%s\ngeneration_numbered_callbacks=%s\ngeneration_guards=UNCHANGED\n' \
        "$callback_order" "$generation_numbered_callbacks"
    printf 'failure_class=%s\nfailure_category=%s\nresult=%s\n' \
        "$failure_class" "$failure_category" \
        "$([[ "$failure_category" == PASS ]] && echo PASS || echo FAIL)"
} | tee "$output_path"

if [[ "$failure_category" != "PASS" ]]; then
    exit 1
fi