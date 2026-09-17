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
profile="${ANDROID_INTERNET_SHARE_DEVICE_PROFILE:-unprofiled}"
client_serial="${ANDROID_INTERNET_SHARE_CLIENT_SERIAL:-}"
output_dir="${ANDROID_INTERNET_SHARE_OUTPUT_DIR:-android/app/build/reports/android-internet-share/latest}"
profile_status="NOT_CHECKED"
expected_manufacturer=""
expected_android=""

usage() {
    cat <<'EOF'
Usage: scripts/android-internet-share-device-test.sh [options]

Runs the focused Internet Share Wi-Fi Direct lifecycle check on one profiled
physical Android device and verifies a second physical Android client can use
the advertised HTTP proxy. Hosted emulators are rejected.

Options:
  --apk PATH       Signed app-release.apk
  --test-apk PATH  Signed app-release-androidTest.apk
  --serial ID      Physical device serial (or set ANDROID_SERIAL)
  --client-serial ID
                   Physical client serial (or set ANDROID_INTERNET_SHARE_CLIENT_SERIAL)
  --profile NAME   Representative device profile
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
        --client-serial)
            [[ $# -ge 2 ]] || { echo "ERROR: --client-serial requires a device serial." >&2; exit 2; }
            client_serial="$2"
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
rm -f "$output_dir"/result.txt "$output_dir"/device-access-result.txt \
    "$output_dir"/adb-devices.txt "$output_dir"/device-details.txt \
    "$output_dir"/device-profile.txt "$output_dir"/instrumentation.log \
    "$output_dir"/logcat.txt "$output_dir"/notification-state.txt \
    "$output_dir"/wifi-direct-state.txt "$output_dir"/client-logcat.txt \
    "$output_dir"/client-connect.log "$output_dir"/client-state.txt \
    "$output_dir"/client-instrumentation.log "$output_dir"/primary-logcat-live.txt \
    "$output_dir"/primary-status.txt

application_apk_sha256="NOT_RECORDED"
instrumentation_apk_sha256="NOT_RECORDED"
if [[ -s "$apk_path" ]]; then
    application_apk_sha256="$(sha256sum "$apk_path" | awk '{ print $1 }')"
fi
if [[ -s "$test_apk_path" ]]; then
    instrumentation_apk_sha256="$(sha256sum "$test_apk_path" | awk '{ print $1 }')"
fi

write_blocked_result() {
    local category="$1"
    local message="$2"
    {
        printf 'validation_mode=real-device\n'
        printf 'device_kind=physical-device\n'
        printf 'target=%s\n' "${serial:-unavailable}"
        printf 'device_profile=%s\nprofile_status=%s\n' "$profile" "$profile_status"
        printf 'device_evidence=BLOCKED\n'
        printf 'failure_class=DEVICE_ACCESS\nfailure_category=%s\n' "$category"
        printf 'application_apk_sha256=%s\ninstrumentation_apk_sha256=%s\n' \
            "$application_apk_sha256" "$instrumentation_apk_sha256"
        printf 'nearby_wifi_permission=NOT_RECORDED\n'
        printf 'start_result=NOT_RECORDED\nstart_outcome=NOT_RECORDED\n'
        printf 'notification_before_stop=NOT_RECORDED\n'
        printf 'stop_result=NOT_RECORDED\nnotification_cleanup=NOT_RECORDED\n'
        printf 'wifi_direct_group_cleanup=NOT_RECORDED\n'
        printf 'client_target=%s\n' "${client_serial:-unavailable}"
        printf 'credential_handoff=NOT_RECORDED\nclient_connection=NOT_RECORDED\n'
        printf 'proxy_advertisement=NOT_RECORDED\nproxy_configuration=NOT_RECORDED\n'
        printf 'proxy_response=NOT_RECORDED\nproxy_https_response=NOT_RECORDED\n'
        printf 'proxy_http_diagnostic=NOT_RECORDED\n'
        printf 'client_proxy_cleanup=NOT_RECORDED\nclient_wifi_cleanup=NOT_RECORDED\n'
        printf 'physical_evidence=BLOCKED\nresult=BLOCKED\nmessage=%s\n' "$message"
    } | tee "$output_dir/device-access-result.txt" "$output_dir/result.txt" >&2
    exit 78
}

command -v adb >/dev/null 2>&1 ||
    write_blocked_result "ADB_UNAVAILABLE" "adb is not installed on the physical-device runner"
[[ "$(basename "$apk_path")" == "app-release.apk" ]] ||
    write_blocked_result "INPUT_FAILURE" "the app input must be named app-release.apk"
[[ "$(basename "$test_apk_path")" == "app-release-androidTest.apk" ]] ||
    write_blocked_result "INPUT_FAILURE" "the test input must be named app-release-androidTest.apk"
[[ -s "$apk_path" ]] ||
    write_blocked_result "INPUT_FAILURE" "signed release APK was not found: $apk_path"
[[ -s "$test_apk_path" ]] ||
    write_blocked_result "INPUT_FAILURE" "signed instrumentation APK was not found: $test_apk_path"

case "$profile" in
    pixel-android-14) expected_manufacturer="google"; expected_android="14" ;;
    samsung-android-13) expected_manufacturer="samsung"; expected_android="13" ;;
    motorola-android-12) expected_manufacturer="motorola"; expected_android="12" ;;
    unprofiled) profile_status="UNPROFILED" ;;
    *) write_blocked_result "INVALID_PROFILE" "unknown device profile '$profile'" ;;
esac

adb start-server > "$output_dir/adb-start-server.txt" 2>&1 || {
    write_blocked_result "ADB_UNAVAILABLE" "adb could not start its server"
}
adb devices -l > "$output_dir/adb-devices.txt" 2>&1 || {
    write_blocked_result "ADB_UNAVAILABLE" "adb could not enumerate Android targets"
}

device_is_physical() {
    [[ "$(adb -s "$1" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r')" != "1" ]]
}

if [[ -n "$serial" ]]; then
    adb -s "$serial" get-state 2>/dev/null | tr -d '\r' | grep -qx "device" ||
        write_blocked_result "TARGET_OFFLINE" "the configured physical device is not online"
    device_is_physical "$serial" ||
        write_blocked_result "EMULATOR_TARGET" "the configured target is an emulator"
else
    mapfile -t online_devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
    physical_devices=()
    for candidate in "${online_devices[@]}"; do
        if device_is_physical "$candidate"; then physical_devices+=("$candidate"); fi
    done
    [[ "${#physical_devices[@]}" -gt 0 ]] ||
        write_blocked_result "NO_PHYSICAL_DEVICE" "no online physical Android device was found"
    [[ "${#physical_devices[@]}" -eq 1 ]] ||
        write_blocked_result "AMBIGUOUS_TARGET" "more than one physical Android device is online; pass --serial"
    serial="${physical_devices[0]}"
fi

[[ -n "$client_serial" ]] ||
    write_blocked_result "CLIENT_DEVICE_UNAVAILABLE" \
        "a second physical Android client serial is required"
[[ "$client_serial" != "$serial" ]] ||
    write_blocked_result "CLIENT_TARGET_DUPLICATES_HOST" \
        "the Wi-Fi Direct client must be a different physical device"
adb -s "$client_serial" get-state 2>/dev/null | tr -d '\r' | grep -qx "device" ||
    write_blocked_result "CLIENT_TARGET_OFFLINE" "the configured client device is not online"
device_is_physical "$client_serial" ||
    write_blocked_result "CLIENT_EMULATOR_TARGET" "the configured client target is an emulator"

{
    printf 'serial=%s\n' "$serial"
    printf 'manufacturer=%s\n' "$(adb -s "$serial" shell getprop ro.product.manufacturer | tr -d '\r')"
    printf 'brand=%s\n' "$(adb -s "$serial" shell getprop ro.product.brand | tr -d '\r')"
    printf 'model=%s\n' "$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')"
    printf 'android=%s\n' "$(adb -s "$serial" shell getprop ro.build.version.release | tr -d '\r')"
    printf 'sdk=%s\n' "$(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')"
    printf 'abi=%s\n' "$(adb -s "$serial" shell getprop ro.product.cpu.abi | tr -d '\r')"
    printf 'ro.kernel.qemu=%s\n' "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')"
} | tee "$output_dir/device-details.txt"

observed_manufacturer="$(awk -F= '$1 == "manufacturer" { print tolower($2) }' "$output_dir/device-details.txt")"
observed_android="$(awk -F= '$1 == "android" { print $2 }' "$output_dir/device-details.txt" | cut -d. -f1)"
{
    printf 'profile=%s\nexpected_manufacturer=%s\nexpected_android=%s\n' \
        "$profile" "${expected_manufacturer:-ANY}" "${expected_android:-ANY}"
    printf 'observed_manufacturer=%s\nobserved_android=%s\n' \
        "${observed_manufacturer:-UNKNOWN}" "${observed_android:-UNKNOWN}"
} > "$output_dir/device-profile.txt"
if [[ "$profile" != "unprofiled" ]]; then
    if [[ "$observed_manufacturer" != *"$expected_manufacturer"* ||
        "$observed_android" != "$expected_android" ]]; then
        profile_status="MISMATCH"
        printf 'profile_status=%s\n' "$profile_status" >> "$output_dir/device-profile.txt"
        write_blocked_result "DEVICE_PROFILE_MISMATCH" \
            "profile '$profile' expected $expected_manufacturer Android $expected_android"
    fi
    profile_status="MATCH"
    printf 'profile_status=%s\n' "$profile_status" >> "$output_dir/device-profile.txt"
fi

adb -s "$serial" uninstall "$PACKAGE_NAME" >/dev/null 2>&1 || true
adb -s "$serial" uninstall "$TEST_PACKAGE_NAME" >/dev/null 2>&1 || true
adb -s "$serial" install -r "$apk_path" > "$output_dir/install-app.log" 2>&1 ||
    write_blocked_result "INSTALLATION_FAILURE" "the signed app APK could not be installed"
adb -s "$serial" install -r "$test_apk_path" > "$output_dir/install-test.log" 2>&1 ||
    write_blocked_result "INSTALLATION_FAILURE" "the signed instrumentation APK could not be installed"
adb -s "$client_serial" uninstall "$PACKAGE_NAME" >/dev/null 2>&1 || true
adb -s "$client_serial" uninstall "$TEST_PACKAGE_NAME" >/dev/null 2>&1 || true
adb -s "$client_serial" install -r "$apk_path" > "$output_dir/client-install-app.log" 2>&1 ||
    write_blocked_result "CLIENT_INSTALLATION_FAILURE" "the signed app APK could not be installed on the client"
adb -s "$client_serial" install -r "$test_apk_path" > "$output_dir/client-install-test.log" 2>&1 ||
    write_blocked_result "CLIENT_INSTALLATION_FAILURE" "the signed instrumentation APK could not be installed on the client"
adb -s "$serial" logcat -c

primary_status_file="$output_dir/primary-status.txt"
rm -f "$primary_status_file"
redact_credentials() {
    sed -E \
        -e 's/(ssid64|passphrase64)=[^[:space:]]+/\1=[REDACTED]/g' \
        -e 's/(passphrase|password|psk)([=:])[[:space:]]*[^,[:space:]]+/\1\2 [REDACTED]/Ig'
}
set +e
(
    adb -s "$serial" shell am instrument -w -r \
        -e hold-internet-share true \
        -e hold-internet-share-seconds 45 \
        -e class "com.safenet.dns.SafeNetVpnInstrumentationTest#internetShareStartsAndStopsCleanly" \
        "$TEST_PACKAGE_NAME/$TEST_RUNNER" 2>&1 |
        tee "$output_dir/instrumentation.log"
    printf '%s\n' "${PIPESTATUS[0]}" > "$primary_status_file"
) &
primary_pid=$!
set -e

ready_line=""
proxy_line=""
for _ in $(seq 1 60); do
    primary_logcat="$(adb -s "$serial" logcat -d -t 1600 2>/dev/null || true)"
    printf '%s\n' "$primary_logcat" | redact_credentials > "$output_dir/primary-logcat-live.txt"
    ready_line="$(grep -F 'INTERNET_SHARE_READY result=PASS proxy=ADVERTISED' \
        "$output_dir/primary-logcat-live.txt" | tail -n 1 || true)"
    proxy_line="$(grep -E 'INTERNET_SHARE_PROXY result=PASS host=[^ ]+ port=[0-9]+' \
        "$output_dir/primary-logcat-live.txt" | tail -n 1 || true)"
    if [[ -n "$ready_line" && -n "$proxy_line" ]]; then break; fi
    sleep 1
done

proxy_host="$(sed -nE 's/.*host=([^ ]+).*/\1/p' <<< "$proxy_line" | tail -n 1)"
proxy_port="$(sed -nE 's/.*port=([0-9]+).*/\1/p' <<< "$proxy_line" | tail -n 1)"
proxy_advertisement="NOT_RECORDED"
if [[ -n "$proxy_host" && -n "$proxy_port" ]]; then proxy_advertisement="PASS"; fi

group_info="$(adb -s "$serial" shell dumpsys wifi p2p 2>/dev/null || true)"
network_name="$(
    grep -Eio 'network[ _-]?name:[[:space:]]*[^,[:space:]]+' <<< "$group_info" |
        head -n 1 | sed -E 's/^[^:]+:[[:space:]]*//'
)"
passphrase="$(
    grep -Eio 'passphrase:[[:space:]]*[^,[:space:]]+' <<< "$group_info" |
        head -n 1 | sed -E 's/^[^:]+:[[:space:]]*//'
)"
credential_handoff="DIAGNOSTIC"
credential_line="$(
    printf '%s\n' "$primary_logcat" |
        grep -E 'INTERNET_SHARE_CREDENTIAL_HANDOFF result=PASS .*ssid64=[^ ]+ passphrase64=[^ ]+' |
        tail -n 1 || true
)"
ssid64="$(sed -nE 's/.*ssid64=([^ ]+).*/\1/p' <<< "$credential_line")"
passphrase64="$(sed -nE 's/.*passphrase64=([^ ]+).*/\1/p' <<< "$credential_line")"
decode_base64() {
    base64 --decode 2>/dev/null <<< "$1" | tr -d '\r\n'
}
handoff_network_name="$(decode_base64 "$ssid64")"
handoff_passphrase="$(decode_base64 "$passphrase64")"
if [[ -n "$handoff_network_name" && -n "$handoff_passphrase" ]]; then
    network_name="$handoff_network_name"
    passphrase="$handoff_passphrase"
    credential_handoff="APP_HANDOFF"
elif [[ -z "$network_name" || -z "$passphrase" ]]; then
    credential_handoff="UNAVAILABLE"
fi
client_connection="NOT_RECORDED"
proxy_configuration="NOT_RECORDED"
proxy_response="NOT_RECORDED"
proxy_https_response="NOT_RECORDED"
proxy_http_diagnostic="NOT_RECORDED"
client_proxy_cleanup="NOT_RECORDED"
client_wifi_cleanup="NOT_RECORDED"
previous_proxy="$(adb -s "$client_serial" shell settings get global http_proxy 2>/dev/null | tr -d '\r' || true)"

if [[ "$proxy_advertisement" == "PASS" && "$credential_handoff" != "UNAVAILABLE" &&
    -n "$network_name" && -n "$passphrase" ]]; then
    if adb -s "$client_serial" shell cmd -w wifi connect-network \
        "$network_name" wpa2 "$passphrase" >/dev/null 2>&1; then
        printf 'connect=PASS\n' > "$output_dir/client-connect.log"
        for _ in $(seq 1 30); do
            client_wifi_state="$(adb -s "$client_serial" shell dumpsys wifi 2>/dev/null || true)"
            client_route_state="$(adb -s "$client_serial" shell ip route 2>/dev/null || true)"
            if grep -Fq "$network_name" <<< "$client_wifi_state" &&
                grep -Eq '192[.]168[.]49[.][0-9]+|192[.]168[.]49[.]0/24' <<< "$client_route_state"; then
                client_connection="PASS"
                break
            fi
            sleep 1
        done
    else
        printf 'connect=FAIL\n' > "$output_dir/client-connect.log"
    fi
elif [[ "$credential_handoff" == "UNAVAILABLE" ]]; then
    printf 'connect=BLOCKED credential_handoff=UNAVAILABLE\n' > "$output_dir/client-connect.log"
    client_connection="BLOCKED_CREDENTIAL_HANDOFF"
fi
printf 'connection=%s\n' "$client_connection" > "$output_dir/client-state.txt"

if [[ "$client_connection" == "PASS" ]]; then
    if adb -s "$client_serial" shell settings put global http_proxy \
        "$proxy_host:$proxy_port" >/dev/null 2>&1; then
        configured_proxy="$(adb -s "$client_serial" shell settings get global http_proxy 2>/dev/null | tr -d '\r' || true)"
        if [[ "$configured_proxy" == "$proxy_host:$proxy_port" ]]; then
            proxy_configuration="PASS"
        fi
    fi
fi

if [[ "$proxy_configuration" == "PASS" ]]; then
    : > "$output_dir/client-instrumentation.log"
    : > "$output_dir/client-logcat.txt"
    adb -s "$client_serial" logcat -c >/dev/null 2>&1 || true
    run_proxy_probe() {
        local protocol="$1"
        local url="$2"
        local response_marker="INTERNET_SHARE_CLIENT_PROXY result=PASS response="
        local status
        set +e
        adb -s "$client_serial" shell am instrument -w -r \
            -e proxy-host "$proxy_host" \
            -e proxy-port "$proxy_port" \
            -e proxy-url "$url" \
            -e class "com.safenet.dns.SafeNetVpnInstrumentationTest#internetShareClientUsesAdvertisedProxy" \
            "$TEST_PACKAGE_NAME/$TEST_RUNNER" 2>&1 |
            tee -a "$output_dir/client-instrumentation.log"
        status="${PIPESTATUS[0]}"
        set -e
        adb -s "$client_serial" logcat -d -t 1200 >> "$output_dir/client-logcat.txt" 2>&1 || true
        if [[ "$status" -eq 0 ]] &&
            grep -Eq "${response_marker}[1-5]XX protocol=${protocol}" \
                "$output_dir/client-logcat.txt" "$output_dir/client-instrumentation.log"; then
            return 0
        fi
        return 1
    }

    if run_proxy_probe "HTTPS" "https://example.com/"; then
        proxy_https_response="PASS"
    else
        proxy_https_response="FAIL"
        # HTTP remains a bounded diagnostic when the proxy cannot complete
        # CONNECT; it never substitutes for the required HTTPS evidence.
        if run_proxy_probe "HTTP" "http://example.com/"; then
            proxy_http_diagnostic="PASS"
        else
            proxy_http_diagnostic="FAIL"
        fi
    fi
    proxy_response="$proxy_https_response"
fi

if [[ "$previous_proxy" == "null" || -z "$previous_proxy" ]]; then
    adb -s "$client_serial" shell settings delete global http_proxy >/dev/null 2>&1 || true
else
    adb -s "$client_serial" shell settings put global http_proxy "$previous_proxy" >/dev/null 2>&1 || true
fi
restored_proxy="$(adb -s "$client_serial" shell settings get global http_proxy 2>/dev/null | tr -d '\r' || true)"
if [[ "$previous_proxy" == "null" || -z "$previous_proxy" ]]; then
    [[ "$restored_proxy" == "null" || -z "$restored_proxy" ]] && client_proxy_cleanup="PASS"
elif [[ "$restored_proxy" == "$previous_proxy" ]]; then
    client_proxy_cleanup="PASS"
fi
if adb -s "$client_serial" shell cmd wifi disconnect >/dev/null 2>&1; then
    client_wifi_cleanup="PASS"
fi

for _ in $(seq 1 70); do
    if ! kill -0 "$primary_pid" 2>/dev/null; then break; fi
    sleep 1
done
if kill -0 "$primary_pid" 2>/dev/null; then
    kill "$primary_pid" 2>/dev/null || true
    adb -s "$serial" shell am force-stop "$PACKAGE_NAME" >/dev/null 2>&1 || true
fi
wait "$primary_pid" 2>/dev/null || true

set +e
instrumentation_status="$(cat "$primary_status_file" 2>/dev/null || true)"
instrumentation_status="${instrumentation_status:-1}"
set -e

adb -s "$serial" logcat -d -t 1600 2>/dev/null | redact_credentials > "$output_dir/logcat.txt" || true
adb -s "$serial" dumpsys notification > "$output_dir/notification-state.txt" 2>&1 || true
adb -s "$serial" dumpsys wifi p2p 2>/dev/null | redact_credentials \
    > "$output_dir/wifi-direct-state.txt" || true

start_result="NOT_RECORDED"
start_outcome="NOT_RECORDED"
nearby_wifi_permission="NOT_RECORDED"
notification_before_stop="NOT_RECORDED"
stop_result="NOT_RECORDED"
notification_cleanup="NOT_RECORDED"
wifi_direct_group_cleanup="NOT_RECORDED"
if grep -Fq "INTERNET_SHARE_START result=PASS" "$output_dir/logcat.txt" \
    "$output_dir/instrumentation.log"; then
    start_result="PASS"
    start_outcome="$(grep -Eo 'INTERNET_SHARE_START result=PASS mode=[A-Z_]+' \
        "$output_dir/logcat.txt" "$output_dir/instrumentation.log" | tail -n 1 | cut -d= -f3 || true)"
fi
if grep -Fq "INTERNET_SHARE_CREDENTIAL_HANDOFF result=PASS" "$output_dir/logcat.txt" \
    "$output_dir/instrumentation.log"; then
    credential_handoff="APP_HANDOFF"
fi
if grep -Fq "INTERNET_SHARE_START result=PASS mode=" "$output_dir/logcat.txt" \
    "$output_dir/instrumentation.log"; then
    nearby_wifi_permission="PASS"
fi
if grep -Fq "INTERNET_SHARE_NOTIFICATION before_stop=PASS" "$output_dir/logcat.txt" \
    "$output_dir/instrumentation.log"; then
    notification_before_stop="PASS"
fi
if grep -Fq "INTERNET_SHARE_STOP result=PASS notification=REMOVED group=NULL" \
    "$output_dir/logcat.txt" "$output_dir/instrumentation.log"; then
    stop_result="PASS"
    notification_cleanup="PASS"
    wifi_direct_group_cleanup="PASS"
fi

if [[ "$instrumentation_status" -eq 0 && "$start_result" == "PASS" &&
    "$stop_result" == "PASS" && "$nearby_wifi_permission" == "PASS" &&
    "$credential_handoff" != "UNAVAILABLE" &&
    "$proxy_advertisement" == "PASS" && "$client_connection" == "PASS" &&
    "$proxy_configuration" == "PASS" && "$proxy_https_response" == "PASS" &&
    "$client_proxy_cleanup" == "PASS" && "$client_wifi_cleanup" == "PASS" ]]; then
    result="PASS"
    failure_class="NONE"
    failure_category="PASS"
    physical_evidence="PASS"
else
    result="FAIL"
    failure_class="APPLICATION"
    if [[ "$credential_handoff" == "UNAVAILABLE" ]]; then
        failure_category="CLIENT_CREDENTIAL_HANDOFF"
    else
        failure_category="INTERNET_SHARE_PROXY"
    fi
    physical_evidence="FAIL"
fi

{
    printf 'validation_mode=real-device\n'
    printf 'device_kind=physical-device\ntarget=%s\n' "$serial"
    printf 'device_profile=%s\nprofile_status=%s\n' "$profile" "$profile_status"
    printf 'device_evidence=%s\nfailure_class=%s\nfailure_category=%s\n' \
        "$physical_evidence" \
        "$failure_class" "$failure_category"
    printf 'application_apk_sha256=%s\ninstrumentation_apk_sha256=%s\n' \
        "$application_apk_sha256" "$instrumentation_apk_sha256"
    printf 'nearby_wifi_permission=%s\nstart_result=%s\nstart_outcome=%s\n' \
        "$nearby_wifi_permission" "$start_result" "$start_outcome"
    printf 'notification_before_stop=%s\nstop_result=%s\nnotification_cleanup=%s\n' \
        "$notification_before_stop" "$stop_result" "$notification_cleanup"
    printf 'wifi_direct_group_cleanup=%s\nphysical_evidence=%s\n' \
        "$wifi_direct_group_cleanup" "$physical_evidence"
    printf 'client_target=%s\nclient_connection=%s\n' \
        "$client_serial" "$client_connection"
    printf 'credential_handoff=%s\n' "$credential_handoff"
    printf 'proxy_advertisement=%s\nproxy_configuration=%s\n' \
        "$proxy_advertisement" "$proxy_configuration"
    printf 'proxy_response=%s\nproxy_https_response=%s\nproxy_http_diagnostic=%s\n' \
        "$proxy_response" "$proxy_https_response" "$proxy_http_diagnostic"
    printf 'client_proxy_cleanup=%s\nclient_wifi_cleanup=%s\n' \
        "$client_proxy_cleanup" "$client_wifi_cleanup"
    printf 'instrumentation_exit_code=%s\nresult=%s\n' \
        "$instrumentation_status" "$result"
} | tee "$output_dir/result.txt"

if [[ "$result" != "PASS" ]]; then
    echo "Internet Share physical-device proxy check failed. Evidence: $output_dir" >&2
    exit 1
fi
echo "Internet Share physical-device proxy check passed. Evidence: $output_dir"