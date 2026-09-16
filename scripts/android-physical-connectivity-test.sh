#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_APK="android/app/build/outputs/apk/release/app-release.apk"
readonly DEFAULT_TEST_APK="android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk"
readonly SMOKE_SCRIPT="scripts/android-smoke-test.sh"
readonly TEST_PACKAGE_NAME="com.safenet.dns.test"
readonly TEST_RUNNER="androidx.test.runner.AndroidJUnitRunner"

apk_path="$DEFAULT_APK"
test_apk_path="$DEFAULT_TEST_APK"
serial="${ANDROID_SERIAL:-}"
profile="${ANDROID_PHYSICAL_CONNECTIVITY_PROFILE:-unprofiled}"
output_dir="${ANDROID_PHYSICAL_CONNECTIVITY_OUTPUT_DIR:-android/app/build/reports/android-physical-connectivity/latest}"
expected_manufacturer=""
expected_android=""
profile_status="NOT_CHECKED"

usage() {
    cat <<'EOF'
Usage: scripts/android-physical-connectivity-test.sh [options]

Runs the signed Android connectivity-recovery smoke on one profiled physical
Android device. Hosted emulators are rejected so their results cannot be
reported as physical-device evidence.

Options:
  --apk PATH       Signed app-release.apk
  --test-apk PATH  Signed app-release-androidTest.apk
  --serial ID      Physical device serial (or set ANDROID_SERIAL)
  --profile NAME   Representative device profile
                   (pixel-android-14, samsung-android-13, motorola-android-12)
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
rm -f "$output_dir"/result.txt \
    "$output_dir"/device-access-result.txt \
    "$output_dir"/adb-devices.txt \
    "$output_dir"/physical-device-details.txt \
    "$output_dir"/device-profile.txt \
    "$output_dir"/smoke-run.log \
    "$output_dir"/smoke-result.txt \
    "$output_dir"/physical-connectivity-instrumentation.log \
    "$output_dir"/physical-connectivity-logcat.txt \
    "$output_dir"/physical-connectivity-result.txt

write_device_access_result() {
    local category="$1"
    local message="$2"
    local target="${serial:-unavailable}"
    {
        printf 'validation_mode=real-device\n'
        printf 'device_kind=physical-device\n'
        printf 'target=%s\n' "$target"
        printf 'device_profile=%s\n' "$profile"
        printf 'profile_status=%s\n' "$profile_status"
        printf 'device_access=BLOCKED\n'
        printf 'failure_class=DEVICE_ACCESS\n'
        printf 'failure_category=%s\n' "$category"
        printf 'result=BLOCKED\n'
        printf 'message=%s\n' "$message"
    } | tee "$output_dir/device-access-result.txt" "$output_dir/result.txt" >&2
    echo "Physical Android connectivity smoke was blocked ($category): $message" >&2
    exit 78
}

case "$profile" in
    pixel-android-14)
        expected_manufacturer="google"
        expected_android="14"
        ;;
    samsung-android-13)
        expected_manufacturer="samsung"
        expected_android="13"
        ;;
    motorola-android-12)
        expected_manufacturer="motorola"
        expected_android="12"
        ;;
    unprofiled)
        profile_status="UNPROFILED"
        ;;
    *)
        write_device_access_result "INVALID_PROFILE" \
            "unknown device profile '$profile'; choose one of the documented representative profiles"
        ;;
esac

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
    printf 'brand=%s\n' "$(adb -s "$serial" shell getprop ro.product.brand | tr -d '\r')"
    printf 'model=%s\n' "$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')"
    printf 'android=%s\n' "$(adb -s "$serial" shell getprop ro.build.version.release | tr -d '\r')"
    printf 'sdk=%s\n' "$(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')"
    printf 'abi=%s\n' "$(adb -s "$serial" shell getprop ro.product.cpu.abi | tr -d '\r')"
    printf 'ro.kernel.qemu=%s\n' "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')"
} | tee "$output_dir/physical-device-details.txt"

observed_manufacturer="$(awk -F= '$1 == "manufacturer" { print tolower($2) }' "$output_dir/physical-device-details.txt")"
observed_android="$(awk -F= '$1 == "android" { print $2 }' "$output_dir/physical-device-details.txt" | cut -d. -f1)"
{
    printf 'profile=%s\n' "$profile"
    printf 'expected_manufacturer=%s\nexpected_android=%s\n' \
        "${expected_manufacturer:-ANY}" "${expected_android:-ANY}"
    printf 'observed_manufacturer=%s\nobserved_android=%s\n' \
        "${observed_manufacturer:-UNKNOWN}" "${observed_android:-UNKNOWN}"
} > "$output_dir/device-profile.txt"
if [[ "$profile" != "unprofiled" ]]; then
    if [[ "$observed_manufacturer" != *"$expected_manufacturer"* ||
        "$observed_android" != "$expected_android" ]]; then
        profile_status="MISMATCH"
        printf 'profile_status=%s\n' "$profile_status" >> "$output_dir/device-profile.txt"
        write_device_access_result "DEVICE_PROFILE_MISMATCH" \
            "profile '$profile' expected $expected_manufacturer Android $expected_android, observed ${observed_manufacturer:-unknown} Android ${observed_android:-unknown}"
    fi
    profile_status="MATCH"
    printf 'profile_status=%s\n' "$profile_status" >> "$output_dir/device-profile.txt"
fi

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

echo "Running physical DNS, WireGuard internet, and dashboard handoff checks..."
set +e
adb -s "$serial" logcat -c >/dev/null 2>&1 || true
adb -s "$serial" shell am instrument -w -r \
    -e resolver-mode public \
    -e plain-primary "${ANDROID_SMOKE_PLAIN_PRIMARY:-1.1.1.1}" \
    -e plain-secondary "${ANDROID_SMOKE_PLAIN_SECONDARY:-8.8.8.8}" \
    -e doh-primary "${ANDROID_SMOKE_DOH_PRIMARY:-https://cloudflare-dns.com/dns-query}" \
    -e doh-secondary "${ANDROID_SMOKE_DOH_SECONDARY:-https://dns.google/dns-query}" \
    -e dot-primary "${ANDROID_SMOKE_DOT_PRIMARY:-cloudflare-dns.com}" \
    -e dot-secondary "${ANDROID_SMOKE_DOT_SECONDARY:-dns.google}" \
    -e ordinary-url "${ANDROID_SMOKE_ORDINARY_URL:-https://example.com/}" \
    -e device-profile "$profile" \
    -e class "com.safenet.dns.SafeNetVpnInstrumentationTest#publicResolverModesKeepOrdinaryHttpsReachable,com.safenet.dns.SafeNetVpnInstrumentationTest#wireGuardFailureCategoryFixtures,com.safenet.dns.SafeNetVpnInstrumentationTest#configuredWireGuardStartsTunnelAndReportsSafeNetGateway,com.safenet.dns.SafeNetVpnUiInstrumentationTest#dashboardSwitchesBetweenDnsAndWireGuardWithoutManualTeardown" \
    "$TEST_PACKAGE_NAME/$TEST_RUNNER" 2>&1 |
    tee "$output_dir/physical-connectivity-instrumentation.log"
physical_instrumentation_status="${PIPESTATUS[0]}"
set -e
adb -s "$serial" shell logcat -d -t 1200 > "$output_dir/physical-connectivity-logcat.txt" 2>&1 || true
adb -s "$serial" shell dumpsys connectivity > "$output_dir/physical-connectivity-network.txt" 2>&1 || true
adb -s "$serial" shell dumpsys vpn > "$output_dir/physical-connectivity-vpn.txt" 2>&1 || true

resolver_plain_status="NOT_RECORDED"
resolver_doh_status="NOT_RECORDED"
resolver_dot_status="NOT_RECORDED"
if grep -Fq 'PHYSICAL_DNS_MODE mode=plain result=PASS dns=PASS ordinary_https=PASS' \
    "$output_dir/physical-connectivity-logcat.txt"; then
    resolver_plain_status="PASS"
fi
if grep -Fq 'PHYSICAL_DNS_MODE mode=doh result=PASS dns=PASS ordinary_https=PASS' \
    "$output_dir/physical-connectivity-logcat.txt"; then
    resolver_doh_status="PASS"
fi
if grep -Fq 'PHYSICAL_DNS_MODE mode=dot result=PASS dns=PASS ordinary_https=PASS' \
    "$output_dir/physical-connectivity-logcat.txt"; then
    resolver_dot_status="PASS"
fi
wireguard_status="NOT_RECORDED"
if grep -Fq 'WIREGUARD_SMOKE result=PASS' \
    "$output_dir/physical-connectivity-logcat.txt" &&
    grep -Fq 'ordinary_https=PASS' "$output_dir/physical-connectivity-logcat.txt"; then
    wireguard_status="PASS"
fi
vpn_handoff_status="NOT_RECORDED"
if grep -Fq 'PHYSICAL_VPN_SWITCH result=PASS dns_to_wireguard=PASS wireguard_to_dns=PASS' \
    "$output_dir/physical-connectivity-logcat.txt"; then
    vpn_handoff_status="PASS"
fi
wireguard_failure_category="$(
    grep -Eo 'WIREGUARD_FAILURE category=(HANDSHAKE|ROUTE|DNS|NAT|CONFIGURATION|PERMISSION|GATEWAY_CONNECTIVITY)' \
        "$output_dir/physical-connectivity-instrumentation.log" \
        "$output_dir/physical-connectivity-logcat.txt" 2>/dev/null |
        tail -n 1 | cut -d= -f2 || true
)"
wireguard_failure_category="${wireguard_failure_category:-NOT_RECORDED}"
wireguard_handshake_fixture="NOT_RECORDED"
wireguard_route_fixture="NOT_RECORDED"
wireguard_dns_fixture="NOT_RECORDED"
wireguard_nat_fixture="NOT_RECORDED"
for fixture_category in HANDSHAKE ROUTE DNS NAT; do
    fixture_status="NOT_RECORDED"
    if grep -Eq \
        "WIREGUARD_FAILURE_FIXTURE category=${fixture_category} result=PASS" \
        "$output_dir/physical-connectivity-instrumentation.log" \
        "$output_dir/physical-connectivity-logcat.txt" 2>/dev/null; then
        fixture_status="PASS"
    fi
    case "$fixture_category" in
        HANDSHAKE) wireguard_handshake_fixture="$fixture_status" ;;
        ROUTE) wireguard_route_fixture="$fixture_status" ;;
        DNS) wireguard_dns_fixture="$fixture_status" ;;
        NAT) wireguard_nat_fixture="$fixture_status" ;;
    esac
done

ordinary_https_status="NOT_RECORDED"
if [[ "$resolver_plain_status" == "PASS" &&
    "$resolver_doh_status" == "PASS" &&
    "$resolver_dot_status" == "PASS" ]]; then
    ordinary_https_status="PASS"
fi

if [[ "$smoke_status" -eq 0 && "$smoke_category" == "PASS" &&
    "$physical_instrumentation_status" -eq 0 &&
    "$resolver_plain_status" == "PASS" &&
    "$resolver_doh_status" == "PASS" &&
    "$resolver_dot_status" == "PASS" &&
    "$wireguard_status" == "PASS" &&
    "$vpn_handoff_status" == "PASS" &&
    "$wireguard_handshake_fixture" == "PASS" &&
    "$wireguard_route_fixture" == "PASS" &&
    "$wireguard_dns_fixture" == "PASS" &&
    "$wireguard_nat_fixture" == "PASS" ]]; then
    result="PASS"
    failure_class="NONE"
else
    result="FAIL"
    failure_class="APPLICATION"
fi

failure_category="$smoke_category"
if [[ "$failure_category" == "PASS" ]]; then
    if [[ "$resolver_plain_status" != "PASS" ||
        "$resolver_doh_status" != "PASS" ||
        "$resolver_dot_status" != "PASS" ]]; then
        failure_category="PHYSICAL_DNS_CONNECTIVITY"
    elif [[ "$wireguard_status" != "PASS" || "$vpn_handoff_status" != "PASS" ]]; then
        failure_category="${wireguard_failure_category}"
        if [[ "$failure_category" == "NOT_RECORDED" ]]; then
            failure_category="PHYSICAL_VPN_CONNECTIVITY"
        fi
    fi
fi

{
    printf 'validation_mode=real-device\n'
    printf 'device_kind=physical-device\n'
    printf 'target=%s\n' "$serial"
    printf 'device_profile=%s\n' "$profile"
    printf 'profile_status=%s\n' "$profile_status"
    printf 'device_access=PASS\n'
    printf 'failure_class=%s\n' "$failure_class"
    printf 'failure_category=%s\n' "$failure_category"
    printf 'connectivity_recovery=%s\n' "$connectivity_recovery"
    printf 'dns_plain=%s\n' "$resolver_plain_status"
    printf 'dns_doh=%s\n' "$resolver_doh_status"
    printf 'dns_dot=%s\n' "$resolver_dot_status"
    printf 'dns_modes=plain,doh,dot\n'
    printf 'ordinary_https=%s\n' "$ordinary_https_status"
    printf 'wireguard_internet=%s\n' "$wireguard_status"
    printf 'wireguard_gateway_dns=%s\n' "$wireguard_status"
    printf 'vpn_handoff=%s\n' "$vpn_handoff_status"
    printf 'dashboard_handoff=%s\n' "$vpn_handoff_status"
    printf 'wireguard_failure_category=%s\n' "$wireguard_failure_category"
    printf 'wireguard_handshake_failure_fixture=%s\n' "$wireguard_handshake_fixture"
    printf 'wireguard_route_failure_fixture=%s\n' "$wireguard_route_fixture"
    printf 'wireguard_dns_failure_fixture=%s\n' "$wireguard_dns_fixture"
    printf 'wireguard_nat_failure_fixture=%s\n' "$wireguard_nat_fixture"
    printf 'physical_instrumentation_exit_code=%s\n' "$physical_instrumentation_status"
    printf 'smoke_exit_code=%s\n' "$smoke_status"
    printf 'result=%s\n' "$result"
} | tee "$output_dir/physical-connectivity-result.txt" "$output_dir/result.txt"

if [[ "$result" != "PASS" ]]; then
    echo "Physical Android connectivity smoke failed ($smoke_category)." >&2
    echo "Evidence: $output_dir" >&2
    exit 1
fi

echo "Physical Android connectivity smoke passed. Evidence: $output_dir"