#!/usr/bin/env bash
set -Eeuo pipefail

readonly PACKAGE_NAME="com.safenet.dns"
readonly TEST_PACKAGE_NAME="${PACKAGE_NAME}.test"
readonly TEST_RUNNER="androidx.test.runner.AndroidJUnitRunner"
readonly DEFAULT_APK="android/app/build/outputs/apk/release/app-release.apk"
readonly DEFAULT_TEST_APK="android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk"
readonly FIXTURE_SCRIPT="scripts/android-dns-fixture.py"
readonly FIXTURE_PLAIN_PORT=53
readonly FIXTURE_DOH_PORT=443
readonly FIXTURE_DOT_PORT=853
readonly FIXTURE_HTTP_PORT=18080
readonly PREFLIGHT_REMOTE_CA_PREFIX="/system/etc/security/cacerts/safenet-preflight-"
readonly DEFAULT_EMULATOR_METADATA_VALUE="unavailable"

apk_path="${DEFAULT_APK}"
test_apk_path="${DEFAULT_TEST_APK}"
serial="${ANDROID_SERIAL:-}"
output_dir="${ANDROID_SMOKE_OUTPUT_DIR:-android/app/build/reports/android-smoke/latest}"
preflight_only=false
resolver_mode="${ANDROID_SMOKE_RESOLVER_MODE:-fixture}"
fixture_host="${ANDROID_SMOKE_FIXTURE_HOST:-10.0.2.2}"
plain_primary="${ANDROID_SMOKE_PLAIN_PRIMARY:-1.1.1.1}"
plain_secondary="${ANDROID_SMOKE_PLAIN_SECONDARY:-8.8.8.8}"
doh_secondary="${ANDROID_SMOKE_DOH_SECONDARY:-https://cloudflare-dns.com/dns-query}"
dot_secondary="${ANDROID_SMOKE_DOT_SECONDARY:-cloudflare-dns.com}"
ordinary_url="${ANDROID_SMOKE_ORDINARY_URL:-https://example.com/}"
emulator_api_level="${ANDROID_EMULATOR_API_LEVEL:-$DEFAULT_EMULATOR_METADATA_VALUE}"
emulator_target="${ANDROID_EMULATOR_TARGET:-$DEFAULT_EMULATOR_METADATA_VALUE}"
emulator_arch="${ANDROID_EMULATOR_ARCH:-$DEFAULT_EMULATOR_METADATA_VALUE}"
emulator_system_image="${ANDROID_EMULATOR_SYSTEM_IMAGE:-$DEFAULT_EMULATOR_METADATA_VALUE}"
fixture_tmp=""
fixture_pid=""
preflight_remote_ca=""
openssl_bin="${OPENSSL_BIN:-openssl}"
coverage_label="controlled-fixture"
if [[ "$resolver_mode" == "public" ]]; then
    coverage_label="external-network"
fi

cleanup_fixture() {
    if [[ -n "$fixture_pid" ]] && kill -0 "$fixture_pid" 2>/dev/null; then
        kill "$fixture_pid" 2>/dev/null || true
        wait "$fixture_pid" 2>/dev/null || true
    fi
    if [[ -n "$preflight_remote_ca" ]] &&
        command -v adb >/dev/null 2>&1 &&
        command -v timeout >/dev/null 2>&1; then
        timeout 30s adb "${adb_args[@]}" shell rm -f "$preflight_remote_ca" >/dev/null 2>&1 || true
    fi
    if [[ -n "$fixture_tmp" ]]; then
        rm -rf "$fixture_tmp"
    fi
}
trap cleanup_fixture EXIT

make_temp_dir() {
    local temp_dir
    temp_dir="$(mktemp -d)"
    if command -v cygpath >/dev/null 2>&1; then
        temp_dir="$(cygpath -u "$temp_dir")"
    fi
    printf '%s\n' "$temp_dir"
}

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
  --preflight      Probe Android system trust capabilities without installing APKs or running instrumentation
  --resolver-mode MODE  fixture (default) or public
  --help           Show this help

Fixture mode starts a controlled plain DNS, DoH, DoT, and HTTPS fixture on the
emulator host (10.0.2.2 by default). Public mode uses external resolvers and
is intended only as an explicit external-network check. Resolver endpoints can
be overridden with ANDROID_SMOKE_PLAIN_PRIMARY,
ANDROID_SMOKE_PLAIN_SECONDARY, ANDROID_SMOKE_DOH_SECONDARY, and
ANDROID_SMOKE_DOT_SECONDARY in public mode.
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
        --preflight)
            preflight_only=true
            shift
            ;;
        --resolver-mode)
            [[ $# -ge 2 ]] || { echo "ERROR: --resolver-mode requires fixture or public." >&2; exit 2; }
            resolver_mode="$2"
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

if [[ "$resolver_mode" != "fixture" && "$resolver_mode" != "public" ]]; then
    echo "ERROR: --resolver-mode must be fixture or public; got: $resolver_mode" >&2
    exit 2
fi
if [[ "$resolver_mode" == "fixture" ]] &&
    [[ ! "$fixture_host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    echo "ERROR: ANDROID_SMOKE_FIXTURE_HOST must be an IPv4 address; got: $fixture_host" >&2
    exit 2
fi
if [[ "$resolver_mode" == "fixture" && ! -f "$FIXTURE_SCRIPT" && "$preflight_only" != true ]]; then
    echo "ERROR: Android DNS fixture script not found: $FIXTURE_SCRIPT" >&2
    exit 2
fi

if [[ "$preflight_only" != true && "$(basename "$apk_path")" != "app-release.apk" ]]; then
    echo "ERROR: Android smoke tests require the explicitly named app-release.apk; got: $apk_path" >&2
    exit 2
fi
if [[ "$preflight_only" != true && "$(basename "$test_apk_path")" != "app-release-androidTest.apk" ]]; then
    echo "ERROR: Android smoke tests require the explicitly named app-release-androidTest.apk; got: $test_apk_path" >&2
    exit 2
fi
if [[ "$preflight_only" != true && ! -f "$apk_path" ]]; then
    echo "ERROR: Release APK not found: $apk_path" >&2
    echo "Build android/app/build/outputs/apk/release/app-release.apk first." >&2
    exit 2
fi
if [[ "$preflight_only" != true && ! -f "$test_apk_path" ]]; then
    echo "ERROR: Release instrumentation APK not found: $test_apk_path" >&2
    echo "Build app-release-androidTest.apk with assembleReleaseAndroidTest first." >&2
    exit 2
fi
command -v adb >/dev/null 2>&1 || {
    echo "ERROR: adb is required. Run this lane on an Android SDK runner or emulator host." >&2
    exit 2
}

mkdir -p "$output_dir"
rm -f "$output_dir"/instrumentation.log "$output_dir"/result.txt \
    "$output_dir"/failure-category.txt "$output_dir"/preflight.log \
    "$output_dir"/preflight-result.txt "$output_dir"/emulator-image.txt
printf 'coverage=%s\nresolver_mode=%s\n' "$coverage_label" "$resolver_mode" > "$output_dir/coverage.txt"

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

fixture_failure() {
    local message="$1"
    echo "FIXTURE_FAILURE: $message" | tee "$output_dir/failure-category.txt" >&2
    {
        printf 'target=%s\nresolver_mode=%s\ncoverage=%s\n' \
            "$serial" "$resolver_mode" "$coverage_label"
        if [[ -f "$output_dir/emulator-image.txt" ]]; then
            cat "$output_dir/emulator-image.txt"
        fi
        printf 'failure_category=FIXTURE_FAILURE\nmessage=%s\n' "$message"
    } | tee "$output_dir/result.txt" >&2
    exit 1
}

read_android_property() {
    local property="$1"
    local value
    value="$(timeout 10s adb "${adb_args[@]}" shell getprop "$property" 2>/dev/null | tr -d '\r' || true)"
    if [[ -z "$value" ]]; then
        value="$DEFAULT_EMULATOR_METADATA_VALUE"
    fi
    printf '%s' "$value"
}

record_emulator_image_metadata() {
    local api_level
    local build_fingerprint
    local device_arch

    api_level="$(read_android_property ro.build.version.sdk)"
    device_arch="$(read_android_property ro.product.cpu.abilist)"
    build_fingerprint="$(read_android_property ro.build.fingerprint)"
    cat > "$output_dir/emulator-image.txt" <<EOF
api_level=$api_level
configured_api_level=$emulator_api_level
target=$emulator_target
architecture=$emulator_arch
device_abis=$device_arch
system_image=$emulator_system_image
build_fingerprint=$build_fingerprint
EOF
}

run_system_trust_preflight() {
    local preflight_log="$output_dir/preflight.log"
    local preflight_ca
    local preflight_hash
    local preflight_state
    local cleanup_status

    : > "$preflight_log"
    {
        echo "Android system trust capability preflight"
        echo "target=$serial"
        echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "--- emulator image ---"
        cat "$output_dir/emulator-image.txt"
    } >> "$preflight_log"

    if ! timeout 30s adb "${adb_args[@]}" root >> "$preflight_log" 2>&1 ||
        grep -Eiq 'cannot run as root|production builds' "$preflight_log"; then
        fixture_failure "adb root is unavailable on this emulator; system trust cannot be probed (see $preflight_log)"
    fi

    if ! timeout 45s adb "${adb_args[@]}" remount >> "$preflight_log" 2>&1; then
        fixture_failure "the emulator could not remount its system partition (see $preflight_log)"
    fi

    if ! timeout 30s adb "${adb_args[@]}" reboot >> "$preflight_log" 2>&1; then
        fixture_failure "the emulator could not reboot after the system remount (see $preflight_log)"
    fi
    if ! timeout 180s adb "${adb_args[@]}" wait-for-device >> "$preflight_log" 2>&1; then
        fixture_failure "the emulator did not return after the system remount (see $preflight_log)"
    fi
    for _ in {1..60}; do
        if timeout 5s adb "${adb_args[@]}" get-state 2>/dev/null |
            tr -d '\r' | grep -qE '(^|[[:space:]])device([[:space:]]|$)'; then
            break
        fi
        sleep 1
    done
    preflight_state="$(
        timeout 5s adb "${adb_args[@]}" get-state 2>&1 |
            tr -d '\r' | tee -a "$preflight_log" || true
    )"
    if ! grep -qE '(^|[[:space:]])device([[:space:]]|$)' <<<"$preflight_state"; then
        fixture_failure "the emulator did not become ready after the system remount (see $preflight_log)"
    fi

    if ! timeout 30s adb "${adb_args[@]}" root >> "$preflight_log" 2>&1 ||
        grep -Eiq 'cannot run as root|production builds' "$preflight_log"; then
        fixture_failure "adb root could not be re-enabled after the system remount (see $preflight_log)"
    fi
    if ! timeout 45s adb "${adb_args[@]}" remount >> "$preflight_log" 2>&1; then
        fixture_failure "the emulator could not activate its writable system overlay (see $preflight_log)"
    fi

    command -v "$openssl_bin" >/dev/null 2>&1 || \
        fixture_failure "openssl is required to probe temporary system trust storage (see $preflight_log)"
    fixture_tmp="$(make_temp_dir)"
    preflight_ca="$fixture_tmp/preflight-ca.crt"
    if ! "$openssl_bin" req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
        -subj "/CN=SafeNet Android trust preflight $$" \
        -addext "basicConstraints=critical,CA:true,pathlen:1" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" \
        -keyout "$fixture_tmp/preflight-ca.key" -out "$preflight_ca" \
        >> "$preflight_log" 2>&1; then
        fixture_failure "could not create the temporary preflight CA (see $preflight_log)"
    fi
    if ! preflight_hash="$("$openssl_bin" x509 -subject_hash_old -in "$preflight_ca" -noout 2>>"$preflight_log")" ||
        [[ ! "$preflight_hash" =~ ^[[:xdigit:]]+$ ]]; then
        fixture_failure "could not calculate the temporary preflight CA name (see $preflight_log)"
    fi
    preflight_remote_ca="${PREFLIGHT_REMOTE_CA_PREFIX}${preflight_hash}.0"

    if ! timeout 60s adb "${adb_args[@]}" push "$preflight_ca" "$preflight_remote_ca" \
        >> "$preflight_log" 2>&1; then
        fixture_failure "the Android system CA directory is not writable (see $preflight_log)"
    fi
    if ! timeout 30s adb "${adb_args[@]}" shell chmod 0644 "$preflight_remote_ca" \
        >> "$preflight_log" 2>&1; then
        fixture_failure "the temporary preflight CA permissions could not be set (see $preflight_log)"
    fi
    if ! timeout 30s adb "${adb_args[@]}" shell test -s "$preflight_remote_ca" \
        >> "$preflight_log" 2>&1; then
        fixture_failure "the temporary preflight CA could not be read back (see $preflight_log)"
    fi
    if ! timeout 30s adb "${adb_args[@]}" shell rm -f "$preflight_remote_ca" \
        >> "$preflight_log" 2>&1; then
        fixture_failure "the temporary preflight CA could not be removed (see $preflight_log)"
    fi
    cleanup_status=0
    timeout 30s adb "${adb_args[@]}" shell test -e "$PREFLIGHT_REMOTE_CA_PREFIX${preflight_hash}.0" \
        >> "$preflight_log" 2>&1 || cleanup_status=$?
    if [[ "$cleanup_status" -eq 0 ]]; then
        fixture_failure "the temporary preflight CA remained in the system trust store (see $preflight_log)"
    fi
    if [[ "$cleanup_status" -ne 1 ]]; then
        fixture_failure "the temporary preflight CA cleanup could not be verified (see $preflight_log)"
    fi
    preflight_remote_ca=""

    cat > "$output_dir/preflight-result.txt" <<EOF
target=$serial
$(cat "$output_dir/emulator-image.txt")
adb_root=PASS
system_remount=PASS
ca_storage_write=PASS
temporary_ca_cleanup=PASS
result=PASS
EOF
    echo "Android system trust capability preflight passed. Evidence: $output_dir" | tee -a "$preflight_log"
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

command -v timeout >/dev/null 2>&1 || {
    echo "ERROR: timeout is required to bound Android adb operations." >&2
    exit 2
}

if ! timeout 30s adb "${adb_args[@]}" get-state | grep -qx "device"; then
    echo "ERROR: adb target '$serial' is not online." >&2
    exit 3
fi

record_emulator_image_metadata

if [[ "$preflight_only" == true ]]; then
    run_system_trust_preflight
    exit 0
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

android_package_available() {
    local package_path
    package_path="$(timeout 5s adb "${adb_args[@]}" shell cmd package path android 2>&1 || true)"
    [[ "$package_path" == package:* ]]
}

android_framework_ready=false
android_framework_ready_streak=0
for _ in {1..120}; do
    if timeout 5s adb "${adb_args[@]}" shell service check mount 2>&1 |
        grep -q "found" &&
        timeout 5s adb "${adb_args[@]}" shell service check package 2>&1 |
        grep -q "found" &&
        android_package_available; then
        ((android_framework_ready_streak += 1))
        if ((android_framework_ready_streak >= 5)); then
            android_framework_ready=true
            break
        fi
    else
        android_framework_ready_streak=0
    fi
    sleep 1
done
if [[ "$android_framework_ready" != true ]]; then
    echo "ERROR: Android package and storage services did not become ready." >&2
    exit 3
fi

install_release_apk() {
    local install_path="$1"
    for _ in {1..3}; do
        if timeout 120s adb "${adb_args[@]}" install -r "$install_path"; then
            return 0
        fi
        sleep 5
    done
    return 1
}

remount_system() {
    local log_path="$1"
    for _ in {1..3}; do
        if timeout 60s adb "${adb_args[@]}" remount >> "$log_path" 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

echo "Installing release APKs on Android target $serial before fixture setup..."
timeout 30s adb "${adb_args[@]}" uninstall "$PACKAGE_NAME" >/dev/null 2>&1 || true
timeout 30s adb "${adb_args[@]}" uninstall "$TEST_PACKAGE_NAME" >/dev/null 2>&1 || true
if ! install_release_apk "$apk_path"; then
    echo "ERROR: Release APK could not be installed after bounded retries." >&2
    exit 1
fi
if ! install_release_apk "$test_apk_path"; then
    echo "ERROR: Release instrumentation APK could not be installed after bounded retries." >&2
    exit 1
fi

if [[ "$resolver_mode" == "fixture" ]]; then
    fixture_tmp="$(make_temp_dir)"
    fixture_ready="$fixture_tmp/ready.json"
    fixture_ca="$fixture_tmp/fixture-ca.crt"
    fixture_ca_key="$fixture_tmp/fixture-ca.key"
    fixture_server_csr="$fixture_tmp/fixture-server.csr"
    fixture_server_cert="$fixture_tmp/fixture-server.crt"
    fixture_server_key="$fixture_tmp/fixture-server.key"
    fixture_ca_hash_file="$fixture_tmp/fixture-ca.hash"
    fixture_adb_log="$output_dir/fixture-adb.log"
    fixture_log="$output_dir/fixture.log"

    command -v "$openssl_bin" >/dev/null 2>&1 || \
        fixture_failure "openssl is required to create the temporary fixture certificate"
    command -v python3 >/dev/null 2>&1 || \
        fixture_failure "python3 is required to run the resolver fixture"

    "$openssl_bin" req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 \
        -subj "/CN=SafeNet Android DNS fixture CA" \
        -addext "basicConstraints=critical,CA:true,pathlen:1" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" \
        -keyout "$fixture_ca_key" -out "$fixture_ca" >/dev/null 2>&1 || \
        fixture_failure "could not create the temporary fixture CA"
    "$openssl_bin" req -new -newkey rsa:2048 -nodes \
        -subj "/CN=$fixture_host" \
        -keyout "$fixture_server_key" -out "$fixture_server_csr" >/dev/null 2>&1 || \
        fixture_failure "could not create the temporary fixture server key"
    cat > "$fixture_tmp/server.ext" <<EOF
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:$fixture_host
EOF
    "$openssl_bin" x509 -req -sha256 -days 2 \
        -in "$fixture_server_csr" -CA "$fixture_ca" -CAkey "$fixture_ca_key" \
        -CAcreateserial -out "$fixture_server_cert" -extfile "$fixture_tmp/server.ext" \
        >/dev/null 2>&1 || fixture_failure "could not sign the temporary fixture certificate"
    "$openssl_bin" x509 -subject_hash_old -in "$fixture_ca" -noout > "$fixture_ca_hash_file" || \
        fixture_failure "could not calculate the fixture CA trust-store name"
    fixture_ca_hash="$(head -n 1 "$fixture_ca_hash_file")"
    fixture_ca_store="$fixture_tmp/$fixture_ca_hash.0"
    cp "$fixture_ca" "$fixture_ca_store"

    : > "$fixture_adb_log"
    if ! timeout 30s adb "${adb_args[@]}" root >> "$fixture_adb_log" 2>&1 ||
        grep -Eiq 'cannot run as root|production builds' "$fixture_adb_log"; then
        fixture_failure "the emulator must allow adb root to trust the temporary TLS CA"
    fi
    if ! remount_system "$fixture_adb_log"; then
        fixture_failure "the emulator could not remount its system partition for the temporary TLS CA"
    fi
    command -v timeout >/dev/null 2>&1 || \
        fixture_failure "timeout is required to bound Android reboot waits"
    timeout 30s adb "${adb_args[@]}" reboot >> "$fixture_adb_log" 2>&1 || \
        fixture_failure "the emulator could not reboot after remounting for the temporary TLS CA"
    if ! timeout 180s adb "${adb_args[@]}" wait-for-device >> "$fixture_adb_log" 2>&1; then
        fixture_failure "the emulator did not return after remounting for the temporary TLS CA"
    fi
    for _ in {1..60}; do
        if timeout 5s adb "${adb_args[@]}" get-state 2>/dev/null | grep -qx "device"; then
            break
        fi
        sleep 1
    done
    if ! timeout 5s adb "${adb_args[@]}" get-state 2>/dev/null | grep -qx "device"; then
        fixture_failure "the emulator did not become ready after remounting for the temporary TLS CA"
    fi
    if ! timeout 30s adb "${adb_args[@]}" root >> "$fixture_adb_log" 2>&1; then
        fixture_failure "adb root could not be re-enabled after remounting for the temporary TLS CA"
    fi
    if ! remount_system "$fixture_adb_log"; then
        fixture_failure "the emulator could not activate its writable system overlay for the temporary TLS CA"
    fi
    if ! timeout 60s adb "${adb_args[@]}" push "$fixture_ca_store" \
        "/system/etc/security/cacerts/$fixture_ca_hash.0" \
        >> "$fixture_adb_log" 2>&1; then
        fixture_failure "the temporary TLS CA could not be installed in the emulator"
    fi
    if ! timeout 30s adb "${adb_args[@]}" shell chmod 0644 \
        "/system/etc/security/cacerts/$fixture_ca_hash.0" \
        >> "$fixture_adb_log" 2>&1; then
        fixture_failure "the temporary TLS CA permissions could not be set"
    fi
    timeout 30s adb "${adb_args[@]}" reboot >> "$fixture_adb_log" 2>&1 || \
        fixture_failure "the emulator could not reboot after installing the temporary TLS CA"
    if ! timeout 180s adb "${adb_args[@]}" wait-for-device >> "$fixture_adb_log" 2>&1; then
        fixture_failure "the emulator did not return after installing the temporary TLS CA"
    fi
    for _ in {1..60}; do
        if timeout 5s adb "${adb_args[@]}" get-state 2>/dev/null | grep -qx "device"; then
            break
        fi
        sleep 1
    done
    if ! timeout 5s adb "${adb_args[@]}" get-state 2>/dev/null | grep -qx "device"; then
        fixture_failure "the emulator did not become ready after installing the temporary TLS CA"
    fi
    package_service_ready=false
    package_service_ready_streak=0
    for _ in {1..90}; do
        if timeout 5s adb "${adb_args[@]}" shell service check mount 2>&1 |
            grep -q "found" &&
            timeout 5s adb "${adb_args[@]}" shell service check package 2>&1 |
            grep -q "found" &&
            android_package_available; then
            ((package_service_ready_streak += 1))
            if ((package_service_ready_streak >= 5)); then
                package_service_ready=true
                break
            fi
        else
            package_service_ready_streak=0
        fi
        sleep 1
    done
    if [[ "$package_service_ready" != true ]]; then
        fixture_failure "the Android package service did not become ready after installing the temporary TLS CA"
    fi

    fixture_privilege=()
    if [[ "${EUID}" -ne 0 ]]; then
        command -v sudo >/dev/null 2>&1 || \
            fixture_failure "sudo is required to bind the fixture's standard resolver ports"
        fixture_privilege=(sudo -n)
    fi
    "${fixture_privilege[@]}" python3 "$FIXTURE_SCRIPT" \
        --plain-port "$FIXTURE_PLAIN_PORT" \
        --doh-port "$FIXTURE_DOH_PORT" \
        --dot-port "$FIXTURE_DOT_PORT" \
        --http-port "$FIXTURE_HTTP_PORT" \
        --certificate "$fixture_server_cert" \
        --key "$fixture_server_key" \
        --ready-file "$fixture_ready" > "$fixture_log" 2>&1 &
    fixture_pid=$!
    for _ in {1..30}; do
        if [[ -s "$fixture_ready" ]] && kill -0 "$fixture_pid" 2>/dev/null; then
            break
        fi
        if ! kill -0 "$fixture_pid" 2>/dev/null; then
            fixture_failure "the resolver fixture process exited during startup; see $fixture_log"
        fi
        sleep 1
    done
    if [[ ! -s "$fixture_ready" ]]; then
        fixture_failure "the resolver fixture did not become ready; see $fixture_log"
    fi
    if ! python3 "$FIXTURE_SCRIPT" --probe --host 127.0.0.1 \
        --plain-port "$FIXTURE_PLAIN_PORT" \
        --doh-port "$FIXTURE_DOH_PORT" \
        --dot-port "$FIXTURE_DOT_PORT" \
        --http-port "$FIXTURE_HTTP_PORT" > "$output_dir/fixture-probe.txt" 2>&1; then
        fixture_failure "the resolver fixture failed its host-side health check"
    fi

    plain_primary="$fixture_host"
    plain_secondary="$fixture_host"
    doh_secondary="https://$fixture_host/dns-query"
    dot_secondary="$fixture_host"
    ordinary_url="https://$fixture_host:$FIXTURE_HTTP_PORT/"
fi

capture device-details adb "${adb_args[@]}" shell sh -c \
    'echo "serial=$(getprop ro.serialno)"; echo "manufacturer=$(getprop ro.product.manufacturer)"; echo "model=$(getprop ro.product.model)"; echo "android=$(getprop ro.build.version.release)"; echo "sdk=$(getprop ro.build.version.sdk)"; echo "abi=$(getprop ro.product.cpu.abi)"'
capture network-connectivity adb "${adb_args[@]}" shell dumpsys connectivity
capture network-ip-route adb "${adb_args[@]}" shell sh -c 'ip addr; echo "--- routes ---"; ip route'
capture network-proc-route adb "${adb_args[@]}" shell cat /proc/net/route

echo "Running SafeNet DNS instrumentation..."
set +e
adb_run shell am instrument -w -r \
    -e class com.safenet.dns.SafeNetVpnInstrumentationTest \
    -e plain-primary "$plain_primary" \
    -e plain-secondary "$plain_secondary" \
    -e doh-secondary "$doh_secondary" \
    -e dot-secondary "$dot_secondary" \
    -e ordinary-url "$ordinary_url" \
    -e resolver-mode "$resolver_mode" \
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
fixture_process_failed=0
if [[ "$resolver_mode" == "fixture" ]] &&
    { [[ -z "$fixture_pid" ]] || ! kill -0 "$fixture_pid" 2>/dev/null; }; then
    fixture_process_failed=1
    test_failed=1
fi

failure_category="PASS"
if [[ "$test_failed" -ne 0 ]]; then
    evidence="$output_dir/instrumentation.log $output_dir/post-test-connectivity $output_dir/post-test-vpn $output_dir/post-test-logcat"
    if [[ "$resolver_mode" == "fixture" ]] &&
        { [[ "$fixture_process_failed" -ne 0 ]] ||
          grep -Eiq 'FIXTURE_FAILURE|Android DNS fixture failure' "$output_dir/instrumentation.log" "$fixture_log"; }; then
        failure_category="FIXTURE_FAILURE"
    elif grep -Eiq 'ENETUNREACH|Network is unreachable' $evidence; then
        failure_category="ENETUNREACH"
    elif grep -Eiq 'EAI_AGAIN|UnknownHost|UnknownHostException|timed out|timeout|ECONNREFUSED|Connection reset|network unavailable' $evidence; then
        failure_category="UNRELATED_NETWORK_FAILURE"
    else
        failure_category="NON_NETWORK_FAILURE"
    fi
fi
printf '%s\n' "$failure_category" | tee "$output_dir/failure-category.txt"
printf 'target=%s\napk=%s\nresolver_mode=%s\ncoverage=%s\ninstrumentation_status=%s\nfailure_category=%s\n' \
    "$serial" "$apk_path" "$resolver_mode" "$coverage_label" "$instrumentation_status" "$failure_category" | tee "$output_dir/result.txt"

if [[ "$test_failed" -ne 0 ]]; then
    echo "Android DNS smoke tests failed ($failure_category)." >&2
    echo "Evidence: $output_dir" >&2
    if [[ "$instrumentation_status" -eq 0 ]]; then
        exit 1
    fi
    exit "$instrumentation_status"
fi

echo "Android DNS smoke tests passed. Evidence: $output_dir"