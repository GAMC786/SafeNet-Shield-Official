#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_APK="artifacts/android/app-release.apk"
readonly DEFAULT_TEST_APK="artifacts/android-test/app-release-androidTest.apk"
readonly DEFAULT_OUTPUT_DIR="android/app/build/reports/android-dns-ddns-physical"

apk_path="$DEFAULT_APK"
test_apk_path="$DEFAULT_TEST_APK"
output_dir="${ANDROID_DNS_DDNS_OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}"
serial="${ANDROID_SERIAL:-}"

usage() {
    cat <<'EOF'
Usage: scripts/android-dns-ddns-device-test.sh [options]

Verify the signed APK pair, select one physical Android target, and run the
real-device DNS/DDNS smoke lane.

Options:
  --apk PATH       Must be app-release.apk
  --test-apk PATH  Must be app-release-androidTest.apk
  --serial ID      ADB serial; otherwise exactly one physical target is required
  --output DIR     Evidence directory
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

apk_sha256="NOT_RECORDED"
test_apk_sha256="NOT_RECORDED"
if [[ -s "$apk_path" ]]; then
    apk_sha256="$(sha256sum "$apk_path" | awk '{ print $1 }')"
fi
if [[ -s "$test_apk_path" ]]; then
    test_apk_sha256="$(sha256sum "$test_apk_path" | awk '{ print $1 }')"
fi

write_blocked_result() {
    local category="$1"
    local message="$2"
    {
        printf 'validation_mode=real-device\n'
        printf 'device_kind=physical-device\n'
        printf 'target=%s\n' "${serial:-unavailable}"
        printf 'apk=%s\n' "$apk_path"
        printf 'test_apk=%s\n' "$test_apk_path"
        printf 'apk_sha256=%s\n' "$apk_sha256"
        printf 'test_apk_sha256=%s\n' "$test_apk_sha256"
        printf 'failure_class=INFRASTRUCTURE\n'
        printf 'failure_category=%s\n' "$category"
        printf 'dns_resolver_ui=BLOCKED\n'
        printf 'ddns_ui=BLOCKED\n'
        printf 'internet_share_start=BLOCKED\n'
        printf 'internet_share_stop=BLOCKED\n'
        printf 'vpn_package_surface=BLOCKED\n'
        printf 'result=BLOCKED\n'
        printf 'message=%s\n' "$message"
    } | tee "$output_dir/result.txt" "$output_dir/infrastructure-blocker.txt" >&2
    return 78
}

command -v adb >/dev/null 2>&1 ||
    { write_blocked_result "ADB_UNAVAILABLE" "adb is not installed on the labeled physical Android runner"; exit $?; }

if [[ "$(basename "$apk_path")" != "app-release.apk" ]]; then
    write_blocked_result "APK_FILENAME_MISMATCH" "the application artifact must be named app-release.apk"
    exit $?
fi
if [[ "$(basename "$test_apk_path")" != "app-release-androidTest.apk" ]]; then
    write_blocked_result "INSTRUMENTATION_APK_FILENAME_MISMATCH" "the instrumentation artifact must be named app-release-androidTest.apk"
    exit $?
fi
[[ -s "$apk_path" ]] ||
    { write_blocked_result "APK_MISSING" "signed application APK was not downloaded"; exit $?; }
[[ -s "$test_apk_path" ]] ||
    { write_blocked_result "INSTRUMENTATION_APK_MISSING" "signed instrumentation APK was not downloaded"; exit $?; }

verify_checksum() {
    local artifact="$1"
    local checksum_file="$2"
    [[ -s "$checksum_file" ]] ||
        { write_blocked_result "APK_SHA256_MISSING" "checksum sidecar is missing for $(basename "$artifact")"; exit 78; }
    (
        cd "$(dirname "$artifact")"
        sha256sum --check "$(basename "$checksum_file")"
    ) > "$output_dir/$(basename "$artifact").sha256.verify" 2>&1 ||
        { write_blocked_result "APK_SHA256_MISMATCH" "SHA-256 verification failed for $(basename "$artifact")"; exit 78; }
}

verify_checksum "$apk_path" "$apk_path.sha256"
verify_checksum "$test_apk_path" "$test_apk_path.sha256"

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
apksigner_bin="$(command -v apksigner || true)"
if [[ -z "$apksigner_bin" && -n "$sdk_root" && -d "$sdk_root/build-tools" ]]; then
    apksigner_bin="$(find "$sdk_root/build-tools" -type f -name apksigner -perm -u+x | sort -V | tail -n 1)"
fi
if [[ -z "$apksigner_bin" ]]; then
    write_blocked_result "APKSIGNER_UNAVAILABLE" "pinned Android build-tools did not provide apksigner"
    exit $?
fi

if ! "$apksigner_bin" verify --verbose "$apk_path" > "$output_dir/app-release.apk.signature.txt" 2>&1; then
    write_blocked_result "APK_SIGNATURE_INVALID" "signed application APK failed apksigner verification"
    exit $?
fi
if ! "$apksigner_bin" verify --verbose "$test_apk_path" > "$output_dir/app-release-androidTest.apk.signature.txt" 2>&1; then
    write_blocked_result "INSTRUMENTATION_APK_SIGNATURE_INVALID" "signed instrumentation APK failed apksigner verification"
    exit $?
fi
{
    printf 'application_filename=%s\n' "$(basename "$apk_path")"
    printf 'instrumentation_filename=%s\n' "$(basename "$test_apk_path")"
    printf 'application_sha256=%s\n' "$apk_sha256"
    printf 'instrumentation_sha256=%s\n' "$test_apk_sha256"
    printf 'application_signature=PASS\ninstrumentation_signature=PASS\n'
} > "$output_dir/apk-integrity.txt"

adb start-server > "$output_dir/adb-start-server.txt" 2>&1 ||
    { write_blocked_result "ADB_UNAVAILABLE" "adb could not start its server"; exit $?; }

device_is_physical() {
    [[ "$(adb -s "$1" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r')" != "1" ]]
}

if [[ -n "$serial" ]]; then
    if ! adb -s "$serial" get-state 2>/dev/null | tr -d '\r' | grep -qx "device"; then
        write_blocked_result "TARGET_OFFLINE" "the configured physical Android target is not online"
        exit $?
    fi
    if ! device_is_physical "$serial"; then
        write_blocked_result "EMULATOR_TARGET" "the configured target is an emulator, not a physical Android phone"
        exit $?
    fi
else
    mapfile -t online_devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
    physical_devices=()
    for candidate in "${online_devices[@]}"; do
        if device_is_physical "$candidate"; then
            physical_devices+=("$candidate")
        fi
    done
    if [[ "${#physical_devices[@]}" -eq 0 ]]; then
        write_blocked_result "NO_PHYSICAL_DEVICE" "no online physical Android phone was found; emulators are not accepted"
        exit $?
    fi
    if [[ "${#physical_devices[@]}" -ne 1 ]]; then
        write_blocked_result "AMBIGUOUS_TARGET" "more than one physical Android phone is online; pass --serial"
        exit $?
    fi
    serial="${physical_devices[0]}"
fi

printf 'target=%s\n' "$serial" > "$output_dir/physical-target.txt"
export ANDROID_SMOKE_VALIDATION_MODE=real-device
export ANDROID_SMOKE_DEVICE_KIND=physical-device
export ANDROID_SMOKE_RESOLVER_MODE=public
set +e
./scripts/android-smoke-test.sh \
    --apk "$apk_path" \
    --test-apk "$test_apk_path" \
    --serial "$serial" \
    --resolver-mode public \
    --output "$output_dir"
smoke_status=$?
set -e

if [[ -s "$output_dir/result.txt" ]]; then
    smoke_failure_category="$(sed -n 's/^failure_category=//p' "$output_dir/result.txt" | head -n 1)"
    if [[ "$smoke_failure_category" == "PASS" ]]; then
        printf 'failure_class=NONE\nresult=PASS\n' >> "$output_dir/result.txt"
    else
        printf 'failure_class=APPLICATION\nresult=FAIL\n' >> "$output_dir/result.txt"
    fi
fi
exit "$smoke_status"