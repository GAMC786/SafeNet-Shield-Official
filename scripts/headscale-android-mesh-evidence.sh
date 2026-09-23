#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_CLIENT_PACKAGE="com.tailscale.ipn"
readonly DEFAULT_OUTPUT_DIR="android/app/build/reports/headscale-android-mesh/latest"
readonly CURL_TIMEOUT_SECONDS=15
readonly ADB_TIMEOUT_SECONDS=30

output_dir="${HEADSCALE_ANDROID_MESH_OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}"
serial="${HEADSCALE_ANDROID_SERIAL:-${ANDROID_SERIAL:-}}"
client_package="${HEADSCALE_ANDROID_CLIENT_PACKAGE:-$DEFAULT_CLIENT_PACKAGE}"
node_name="${HEADSCALE_ANDROID_NODE_NAME:-}"
peer_address="${HEADSCALE_ANDROID_PEER_ADDRESS:-}"
headplane_node_status="${HEADSCALE_HEADPLANE_NODE_STATUS:-}"
headplane_node_owner="${HEADSCALE_HEADPLANE_NODE_OWNER:-}"
login_server_confirmed="${HEADSCALE_ANDROID_LOGIN_SERVER_CONFIRMED:-}"
persistent_state_confirmed="${HEADSCALE_PERSISTENT_STATE_CONFIRMED:-}"
vpn_interface="${HEADSCALE_ANDROID_VPN_INTERFACE:-}"

usage() {
    cat <<'EOF'
Usage: scripts/headscale-android-mesh-evidence.sh [options]

Verifies a real Tailscale-compatible Android client joined an external
Headscale mesh and can reach an approved peer through its VPN interface.
The SafeNet APK is not a Headscale client; install/configure Tailscale or
another compatible Android client on the selected phone first.

Required environment:
  HEADSCALE_URL                 Headscale API/login-server URL
  HEADPLANE_URL                 Headplane URL
  HEADSCALE_API_KEY             Server-side API key (never written to evidence)
  HEADSCALE_DERP_URL            Public DERP health URL or DERP map endpoint
  HEADSCALE_ANDROID_NODE_NAME   Registered Headscale node name
  HEADSCALE_ANDROID_PEER_ADDRESS
                                Approved mesh peer IP or hostname
  HEADSCALE_PERSISTENT_STATE_CONFIRMED=pass
                                External Headscale config/database is persistent

The operator must also confirm the Headplane node view and the Android
login-server setting. Pass those confirmations with:
  --headplane-node-status pass
  --headplane-node-owner OWNER
  --login-server-confirmed pass

Options:
  --serial ID                  Physical Android serial (or ANDROID_SERIAL)
  --client-package PACKAGE     Tailscale-compatible package name
  --node-name NAME             Registered Headscale node name
  --peer-address ADDRESS       Approved peer to probe through the mesh
  --vpn-interface NAME         Expected VPN interface (otherwise auto-detected)
  --headplane-node-status pass Confirm Headplane shows the node and status
  --headplane-node-owner OWNER Owner shown for the node in Headplane
  --login-server-confirmed pass
                               Confirm the client is configured for HEADSCALE_URL
  --persistent-state-confirmed pass
                               Confirm the external Headscale config/database is persistent
  --output DIR                 Bounded evidence directory
  --help                       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --serial)
            [[ $# -ge 2 ]] || { echo "ERROR: --serial requires a device ID." >&2; exit 2; }
            serial="$2"
            shift 2
            ;;
        --client-package)
            [[ $# -ge 2 ]] || { echo "ERROR: --client-package requires a package name." >&2; exit 2; }
            client_package="$2"
            shift 2
            ;;
        --node-name)
            [[ $# -ge 2 ]] || { echo "ERROR: --node-name requires a node name." >&2; exit 2; }
            node_name="$2"
            shift 2
            ;;
        --peer-address)
            [[ $# -ge 2 ]] || { echo "ERROR: --peer-address requires an address." >&2; exit 2; }
            peer_address="$2"
            shift 2
            ;;
        --vpn-interface)
            [[ $# -ge 2 ]] || { echo "ERROR: --vpn-interface requires an interface name." >&2; exit 2; }
            vpn_interface="$2"
            shift 2
            ;;
        --headplane-node-status)
            [[ $# -ge 2 ]] || { echo "ERROR: --headplane-node-status requires pass." >&2; exit 2; }
            headplane_node_status="$2"
            shift 2
            ;;
        --headplane-node-owner)
            [[ $# -ge 2 ]] || { echo "ERROR: --headplane-node-owner requires an owner." >&2; exit 2; }
            headplane_node_owner="$2"
            shift 2
            ;;
        --login-server-confirmed)
            [[ $# -ge 2 ]] || { echo "ERROR: --login-server-confirmed requires pass." >&2; exit 2; }
            login_server_confirmed="$2"
            shift 2
            ;;
        --persistent-state-confirmed)
            [[ $# -ge 2 ]] || { echo "ERROR: --persistent-state-confirmed requires pass." >&2; exit 2; }
            persistent_state_confirmed="$2"
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
rm -f "$output_dir"/*

safe_message() {
    printf '%s' "$1" | tr '\r\n' ' ' | cut -c1-400
}

write_bounded_command() {
    local destination="$1"
    shift
    if command -v timeout >/dev/null 2>&1; then
        timeout "${ADB_TIMEOUT_SECONDS}s" "$@" 2>&1 | head -c 200000 > "$destination" || true
    else
        "$@" 2>&1 | head -c 200000 > "$destination" || true
    fi
}

write_blocked_result() {
    local category="$1"
    local message
    message="$(safe_message "$2")"
    [[ "$category" =~ ^[A-Z0-9_]+$ ]] ||
        { echo "ERROR: invalid blocker category '$category'." >&2; exit 2; }
    {
        printf 'evidence_schema_version=1\n'
        printf 'validation_mode=headscale-android-mesh\n'
        printf 'result=BLOCKED\n'
        printf 'failure_class=INFRASTRUCTURE_PREREQUISITE\n'
        printf 'failure_category=%s\n' "$category"
        printf 'message=%s\n' "$message"
        printf 'headscale_url=%s\n' "${HEADSCALE_URL:-NOT_CONFIGURED}"
        printf 'headplane_url=%s\n' "${HEADPLANE_URL:-NOT_CONFIGURED}"
        printf 'derp_url=%s\n' "${HEADSCALE_DERP_URL:-NOT_CONFIGURED}"
        printf 'node_name=%s\n' "${node_name:-NOT_CONFIGURED}"
        printf 'client_package=%s\n' "$client_package"
        printf 'target=%s\n' "${serial:-unavailable}"
        printf 'peer_address=%s\n' "${peer_address:-NOT_CONFIGURED}"
        printf 'headplane_node_status=%s\n' "${headplane_node_status:-NOT_RECORDED}"
        printf 'headplane_node_owner=%s\n' "${headplane_node_owner:-NOT_RECORDED}"
        printf 'login_server_confirmed=%s\n' "${login_server_confirmed:-NOT_RECORDED}"
        printf 'persistent_state_confirmed=%s\n' "${persistent_state_confirmed:-NOT_RECORDED}"
        printf 'node_registration=NOT_RECORDED\n'
        printf 'node_online=NOT_RECORDED\n'
        printf 'encrypted_path=NOT_RECORDED\n'
        printf 'client_build=NOT_RECORDED\n'
        printf 'diagnostics=runner-metadata.txt,curl-availability.txt,adb-version.txt,adb-devices.txt,device-details.txt\n'
    } | tee "$output_dir/result.txt" "$output_dir/infrastructure-blocker.txt" >&2

    {
        printf 'hostname=%s\n' "$(hostname 2>/dev/null || printf 'NOT_RECORDED')"
        printf 'uname=%s\n' "$(uname -a 2>/dev/null || printf 'NOT_RECORDED')"
        printf 'curl_available=%s\n' \
            "$([[ -n "$(command -v curl 2>/dev/null || true)" ]] && echo true || echo false)"
        printf 'adb_available=%s\n' \
            "$([[ -n "$(command -v adb 2>/dev/null || true)" ]] && echo true || echo false)"
    } | head -c 200000 > "$output_dir/runner-metadata.txt"
    if command -v curl >/dev/null 2>&1; then
        curl --version | head -c 200000 > "$output_dir/curl-availability.txt" || true
    else
        printf 'curl is unavailable on the runner.\n' > "$output_dir/curl-availability.txt"
    fi
    if command -v adb >/dev/null 2>&1; then
        write_bounded_command "$output_dir/adb-version.txt" adb version
        write_bounded_command "$output_dir/adb-devices.txt" adb devices -l
        if [[ -n "$serial" ]]; then
            write_bounded_command "$output_dir/device-details.txt" adb -s "$serial" shell getprop
        else
            printf 'No Android serial was selected.\n' > "$output_dir/device-details.txt"
        fi
    else
        printf 'adb is unavailable on the runner.\n' > "$output_dir/adb-version.txt"
        printf 'adb is unavailable on the runner.\n' > "$output_dir/adb-devices.txt"
        printf 'Device properties were unavailable because adb is not installed.\n' \
            > "$output_dir/device-details.txt"
    fi
    exit 78
}

block() {
    write_blocked_result "$1" "$2"
}

[[ -n "${HEADSCALE_URL:-}" ]] ||
    block "CONTROL_PLANE_UNCONFIGURED" "HEADSCALE_URL is required for the custom Headscale login server."
[[ -n "${HEADPLANE_URL:-}" ]] ||
    block "HEADPLANE_UNCONFIGURED" "HEADPLANE_URL is required to verify the node administration view."
[[ -n "${HEADSCALE_API_KEY:-}" ]] ||
    block "CONTROL_PLANE_API_KEY_MISSING" "HEADSCALE_API_KEY is required for authenticated node evidence."
[[ -n "${HEADSCALE_DERP_URL:-}" ]] ||
    block "DERP_ENDPOINT_UNCONFIGURED" "HEADSCALE_DERP_URL is required before an encrypted path can be claimed."
[[ -n "$node_name" ]] ||
    block "ANDROID_NODE_UNCONFIGURED" "HEADSCALE_ANDROID_NODE_NAME identifies the Android node to verify."
[[ -n "$peer_address" ]] ||
    block "PEER_UNCONFIGURED" "HEADSCALE_ANDROID_PEER_ADDRESS identifies the approved mesh peer to probe."
[[ "$headplane_node_status" == "pass" ]] ||
    block "HEADPLANE_NODE_UNCONFIRMED" "Headplane must visibly show the Android node and its current status."
[[ -n "$headplane_node_owner" ]] ||
    block "HEADPLANE_OWNER_UNCONFIRMED" "Headplane ownership must be recorded for the Android node."
[[ "$login_server_confirmed" == "pass" ]] ||
    block "LOGIN_SERVER_UNCONFIRMED" "The Android client must be confirmed against the configured custom login server."
[[ "$persistent_state_confirmed" == "pass" ]] ||
    block "PERSISTENT_STATE_UNCONFIRMED" "The external Headscale config and database must be confirmed persistent."
command -v curl >/dev/null 2>&1 ||
    block "CURL_UNAVAILABLE" "curl is required to check Headscale, Headplane, and DERP endpoints."
command -v node >/dev/null 2>&1 ||
    block "NODE_UNAVAILABLE" "node is required to parse the bounded Headscale node response."
command -v adb >/dev/null 2>&1 ||
    block "ADB_UNAVAILABLE" "adb is required to inspect and probe the Android client."

url_is_http() {
    [[ "$1" =~ ^https?://[^/@[:space:]]+(/|$) ]]
}
url_is_http "$HEADSCALE_URL" ||
    block "CONTROL_PLANE_URL_INVALID" "HEADSCALE_URL must be an HTTP or HTTPS URL."
url_is_http "$HEADPLANE_URL" ||
    block "HEADPLANE_URL_INVALID" "HEADPLANE_URL must be an HTTP or HTTPS URL."
url_is_http "$HEADSCALE_DERP_URL" ||
    block "DERP_URL_INVALID" "HEADSCALE_DERP_URL must be an HTTP or HTTPS URL."

headscale_url="${HEADSCALE_URL%/}"
headplane_url="${HEADPLANE_URL%/}"
derp_url="${HEADSCALE_DERP_URL%/}"
node_response="$output_dir/.headscale-node-response.json"

http_status() {
    local url="$1"
    shift
    curl --silent --show-error --location --connect-timeout 5 \
        --max-time "$CURL_TIMEOUT_SECONDS" -o /dev/null -w '%{http_code}' "$@" "$url" 2>/dev/null || printf '000'
}

headscale_status="$(http_status "$headscale_url/api/v1/node" \
    -H "Accept: application/json" -H "Authorization: Bearer $HEADSCALE_API_KEY")"
[[ "$headscale_status" =~ ^2[0-9][0-9]$ ]] ||
    block "CONTROL_PLANE_UNAVAILABLE" "Headscale node API did not return a successful response (HTTP $headscale_status)."
curl --silent --show-error --location --connect-timeout 5 --max-time "$CURL_TIMEOUT_SECONDS" \
    -H "Accept: application/json" -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -o "$node_response" "$headscale_url/api/v1/node" 2>/dev/null ||
    block "CONTROL_PLANE_NODE_READ_FAILED" "Headscale node data could not be read after the health check."

headplane_status="$(http_status "$headplane_url")"
[[ "$headplane_status" =~ ^2[0-9][0-9]$ ]] ||
    block "HEADPLANE_UNAVAILABLE" "Headplane did not return a successful response (HTTP $headplane_status)."

derp_status="$(http_status "$derp_url")"
[[ "$derp_status" =~ ^2[0-9][0-9]$ ]] ||
    block "DERP_UNAVAILABLE" "The configured DERP health endpoint did not return a successful response (HTTP $derp_status)."

node_summary="$output_dir/headscale-node-summary.txt"
node_parse_status=0
# The JavaScript is single-quoted so Bash cannot expand its template literals.
# shellcheck disable=SC2016
node \
    -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const requested = process.argv[2];
const nodes = Array.isArray(payload) ? payload : (Array.isArray(payload.nodes) ? payload.nodes : []);
const node = nodes.find((item) =>
  [item.name, item.hostname, item.givenName].some((value) => value === requested)
);
if (!node) process.exit(3);
const owner = typeof node.user === "string"
  ? node.user
  : (node.user && (node.user.name || node.user.displayName || node.user.id)) || "";
const addresses = Array.isArray(node.ipAddresses) ? node.ipAddresses.join(",") : "";
const online = node.online === true ? "true" : node.online === false ? "false" : "UNKNOWN";
const fields = [
  ["node_name", node.name || node.hostname || requested],
  ["node_owner", owner || "UNKNOWN"],
  ["node_online", online],
  ["node_addresses", addresses || "UNKNOWN"],
  ["node_last_seen", node.lastSeen || "UNKNOWN"],
];
for (const [key, value] of fields) {
  process.stdout.write(`${key}=${String(value).replace(/[\\r\\n]/g, " ")}\n`);
}
' "$node_response" "$node_name" > "$node_summary" || node_parse_status=$?
rm -f "$node_response"
[[ "$node_parse_status" -eq 0 ]] ||
    block "ANDROID_NODE_NOT_REGISTERED" "Headscale did not return the configured Android node '$node_name'."

node_online="$(awk -F= '$1 == "node_online" { print $2; exit }' "$node_summary")"
node_owner="$(awk -F= '$1 == "node_owner" { print substr($0, index($0, "=") + 1); exit }' "$node_summary")"
[[ "$node_online" == "true" ]] ||
    block "ANDROID_NODE_OFFLINE" "The registered Android node is not online in Headscale."
[[ -n "$node_owner" && "$node_owner" != "UNKNOWN" ]] ||
    block "ANDROID_NODE_OWNER_MISSING" "Headscale did not report an owner for the registered Android node."
[[ "$node_owner" == "$headplane_node_owner" ]] ||
    block "HEADPLANE_OWNER_MISMATCH" "Headplane ownership does not match the authenticated Headscale node record."

adb start-server > "$output_dir/adb-start-server.txt" 2>&1 ||
    block "ADB_UNAVAILABLE" "adb could not start its server."
adb devices -l > "$output_dir/adb-devices.txt" 2>&1 ||
    block "ADB_UNAVAILABLE" "adb could not enumerate Android targets."
if [[ -z "$serial" ]]; then
    mapfile -t online_devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
    [[ "${#online_devices[@]}" -eq 1 ]] ||
        block "ANDROID_TARGET_AMBIGUOUS" "Exactly one online Android target is required; pass --serial."
    serial="${online_devices[0]}"
fi
adb -s "$serial" get-state 2>/dev/null | tr -d '\r' | grep -qx "device" ||
    block "ANDROID_TARGET_OFFLINE" "The selected Android target is not online."
[[ "$(adb -s "$serial" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r')" != "1" ]] ||
    block "ANDROID_EMULATOR_TARGET" "A physical Android client is required for Headscale mesh evidence."

{
    printf 'serial=%s\n' "$serial"
    printf 'manufacturer=%s\n' "$(adb -s "$serial" shell getprop ro.product.manufacturer | tr -d '\r')"
    printf 'model=%s\n' "$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')"
    printf 'android=%s\n' "$(adb -s "$serial" shell getprop ro.build.version.release | tr -d '\r')"
    printf 'sdk=%s\n' "$(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')"
    printf 'ro.kernel.qemu=%s\n' "$(adb -s "$serial" shell getprop ro.kernel.qemu | tr -d '\r')"
} | tee "$output_dir/device-details.txt"

adb -s "$serial" shell pm path "$client_package" > "$output_dir/client-package.txt" 2>&1 ||
    block "CLIENT_NOT_INSTALLED" "The Tailscale-compatible Android client package is not installed."
client_build="$(adb -s "$serial" shell dumpsys package "$client_package" 2>/dev/null |
    sed -nE 's/^[[:space:]]*versionName=([^[:space:]]+).*/\1/p' | head -n 1 | tr -d '\r')"
[[ -n "$client_build" ]] ||
    block "CLIENT_BUILD_UNAVAILABLE" "The Android client version could not be collected."
printf 'package=%s\nversion_name=%s\n' "$client_package" "$client_build" |
    tee "$output_dir/client-build.txt"

interface_listing="$(adb -s "$serial" shell ip -o link 2>/dev/null | tr -d '\r')"
printf '%s\n' "$interface_listing" | head -c 200000 > "$output_dir/vpn-interfaces.txt"
if [[ -z "$vpn_interface" ]]; then
    vpn_interface="$(printf '%s\n' "$interface_listing" |
        sed -nE 's/^[0-9]+: ([^:]+):.*/\1/p' |
        grep -E '^(tailscale|tun|wg)' | head -n 1 || true)"
fi
[[ -n "$vpn_interface" ]] ||
    block "VPN_INTERFACE_MISSING" "No Tailscale/WireGuard VPN interface was visible on the Android client."

route_output="$(adb -s "$serial" shell ip route get "$peer_address" 2>&1 | tr -d '\r')"
printf '%s\n' "$route_output" | head -c 200000 > "$output_dir/peer-route.txt"
printf '%s\n' "$route_output" | grep -Eq "(^|[[:space:]])dev[[:space:]]+$vpn_interface([[:space:]]|$)" ||
    block "PEER_ROUTE_NOT_MESH" "The approved peer does not route through the detected VPN interface."

ping_output="$output_dir/peer-ping.txt"
adb -s "$serial" shell ping -c 3 -W 3 "$peer_address" > "$ping_output" 2>&1 ||
    block "PEER_UNREACHABLE" "The Android client could not reach the approved peer through the mesh."
grep -Eq '[0-9]+ packets transmitted, [0-9]+ (packets )?received' "$ping_output" ||
    block "PEER_PROBE_UNVERIFIED" "The Android peer probe did not contain a bounded packet result."

{
    printf 'evidence_schema_version=1\n'
    printf 'validation_mode=headscale-android-mesh\n'
    printf 'result=PASS\n'
    printf 'headscale_url=%s\nheadplane_url=%s\nderp_url=%s\n' "$headscale_url" "$headplane_url" "$derp_url"
    printf 'headscale_http_status=%s\nheadplane_http_status=%s\nderp_http_status=%s\n' \
        "$headscale_status" "$headplane_status" "$derp_status"
    printf 'node_name=%s\nnode_owner=%s\nnode_online=%s\n' "$node_name" "$node_owner" "$node_online"
    printf 'headplane_node_status=%s\nheadplane_node_owner=%s\n' \
        "$headplane_node_status" "$headplane_node_owner"
    printf 'login_server_confirmed=%s\n' "$login_server_confirmed"
    printf 'persistent_state_confirmed=%s\n' "$persistent_state_confirmed"
    printf 'client_package=%s\nclient_build=%s\n' "$client_package" "$client_build"
    printf 'target=%s\npeer_address=%s\nvpn_interface=%s\n' "$serial" "$peer_address" "$vpn_interface"
    printf 'node_registration=PASS\nheadplane_node=PASS\nencrypted_path=PASS\npeer_probe=PASS\n'
} | tee "$output_dir/result.txt"
echo "Headscale Android mesh verification passed. Evidence: $output_dir"