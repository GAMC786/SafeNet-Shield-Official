#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_OUTPUT_DIR="android/app/build/reports/netbird-android-mesh/latest"
readonly DEFAULT_CLIENT_PACKAGE="io.netbird.client"
readonly CURL_TIMEOUT_SECONDS=15
readonly ADB_TIMEOUT_SECONDS=30

output_dir="${NETBIRD_ANDROID_MESH_OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}"
serial="${NETBIRD_ANDROID_SERIAL:-${ANDROID_SERIAL:-}}"
client_package="${NETBIRD_ANDROID_CLIENT_PACKAGE:-$DEFAULT_CLIENT_PACKAGE}"
peer_name="${NETBIRD_ANDROID_PEER_NAME:-}"
peer_address="${NETBIRD_ANDROID_PEER_ADDRESS:-}"
management_url="${NETBIRD_MANAGEMENT_URL:-}"
status_url="${NETBIRD_STATUS_URL:-}"
status_token="${NETBIRD_STATUS_TOKEN:-}"
api_token="${NETBIRD_API_TOKEN:-}"
login_server_confirmed="${NETBIRD_ANDROID_MANAGEMENT_URL_CONFIRMED:-}"
persistent_state_confirmed="${NETBIRD_PERSISTENT_STATE_CONFIRMED:-}"
vpn_interface="${NETBIRD_ANDROID_VPN_INTERFACE:-}"

usage() {
  cat <<'EOF'
Usage: scripts/netbird-android-mesh-evidence.sh [options]

Verifies a physical Android phone running the official NetBird Android client
against an external self-hosted NetBird management server. SafeNet's APK is
not a NetBird client and this check does not claim native SafeNet VPN support.

Required environment:
  NETBIRD_MANAGEMENT_URL       Self-hosted management URL
  NETBIRD_API_TOKEN             Scoped NetBird API token (never recorded)
  NETBIRD_STATUS_URL            SafeNet /api/netbird/peer-status endpoint
  NETBIRD_STATUS_TOKEN          SafeNet status endpoint token (never recorded)
  NETBIRD_ANDROID_CLIENT_PACKAGE
                                Optional override (default: io.netbird.client)
  NETBIRD_ANDROID_PEER_NAME     Enrolled peer name
  NETBIRD_ANDROID_PEER_ADDRESS  Approved peer IP or hostname to probe
  NETBIRD_ANDROID_MANAGEMENT_URL_CONFIRMED=pass
  NETBIRD_PERSISTENT_STATE_CONFIRMED=pass

Options: --serial ID --client-package PACKAGE --peer-name NAME
  --peer-address ADDRESS --vpn-interface NAME --management-url URL
  --status-url URL --management-url-confirmed pass
  --persistent-state-confirmed pass --output DIR --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial|--client-package|--peer-name|--peer-address|--vpn-interface|--management-url|--status-url|--management-url-confirmed|--persistent-state-confirmed|--output)
      [[ $# -ge 2 ]] || { echo "ERROR: $1 requires a value." >&2; exit 2; }
      case "$1" in
        --serial) serial="$2";; --client-package) client_package="$2";;
        --peer-name) peer_name="$2";; --peer-address) peer_address="$2";;
        --vpn-interface) vpn_interface="$2";; --management-url) management_url="$2";;
        --status-url) status_url="$2";; --management-url-confirmed) login_server_confirmed="$2";;
        --persistent-state-confirmed) persistent_state_confirmed="$2";;
        --output) output_dir="$2";;
      esac
      shift 2;;
    --help|-h) usage; exit 0;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage >&2; exit 2;;
  esac
done

mkdir -p "$output_dir"
rm -f "$output_dir"/*
safe_message() { printf '%s' "$1" | tr '\r\n' ' ' | cut -c1-400; }
write_bounded_command() {
  local destination="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${ADB_TIMEOUT_SECONDS}s" "$@" 2>&1 | head -c 200000 >"$destination" || true
  else "$@" 2>&1 | head -c 200000 >"$destination" || true; fi
}
write_blocked_result() {
  local category="$1" message; message="$(safe_message "$2")"
  {
    printf 'evidence_schema_version=1\nvalidation_mode=netbird-android-mesh\nresult=BLOCKED\n'
    printf 'failure_class=INFRASTRUCTURE_PREREQUISITE\nfailure_category=%s\nmessage=%s\n' "$category" "$message"
    printf 'management_url=%s\nstatus_url=%s\npeer_name=%s\nclient_package=%s\ntarget=%s\npeer_address=%s\n' \
      "${management_url:-NOT_CONFIGURED}" "${status_url:-NOT_CONFIGURED}" "${peer_name:-NOT_CONFIGURED}" \
      "${client_package:-NOT_CONFIGURED}" "${serial:-unavailable}" "${peer_address:-NOT_CONFIGURED}"
    printf 'management_url_confirmed=%s\npersistent_state_confirmed=%s\npeer_registration=NOT_RECORDED\n'
    printf 'peer_online=NOT_RECORDED\nstatus_adapter=NOT_RECORDED\nencrypted_path=NOT_RECORDED\nclient_build=NOT_RECORDED\n'
    printf 'diagnostics=runner-metadata.txt,curl-availability.txt,adb-version.txt,adb-devices.txt,device-details.txt\n'
  } | tee "$output_dir/result.txt" "$output_dir/infrastructure-blocker.txt" >&2
  {
    printf 'hostname=%s\nuname=%s\ncurl_available=%s\nadb_available=%s\n' "$(hostname 2>/dev/null || echo NOT_RECORDED)" \
      "$(uname -a 2>/dev/null || echo NOT_RECORDED)" "$([[ -n "$(command -v curl 2>/dev/null || true)" ]] && echo true || echo false)" \
      "$([[ -n "$(command -v adb 2>/dev/null || true)" ]] && echo true || echo false)"
  } | head -c 200000 >"$output_dir/runner-metadata.txt"
  if command -v curl >/dev/null 2>&1; then curl --version | head -c 200000 >"$output_dir/curl-availability.txt" || true; else echo "curl unavailable" >"$output_dir/curl-availability.txt"; fi
  if command -v adb >/dev/null 2>&1; then
    write_bounded_command "$output_dir/adb-version.txt" adb version
    write_bounded_command "$output_dir/adb-devices.txt" adb devices -l
    [[ -n "$serial" ]] && write_bounded_command "$output_dir/device-details.txt" adb -s "$serial" shell getprop || echo "No Android serial selected." >"$output_dir/device-details.txt"
  else
    for file in adb-version.txt adb-devices.txt device-details.txt; do echo "adb unavailable" >"$output_dir/$file"; done
  fi
  exit 78
}
block() { write_blocked_result "$1" "$2"; }
[[ -n "$management_url" ]] || block CONTROL_PLANE_UNCONFIGURED "NETBIRD_MANAGEMENT_URL is required."
[[ -n "$api_token" ]] || block CONTROL_PLANE_API_TOKEN_MISSING "NETBIRD_API_TOKEN is required for peer evidence."
[[ -n "$status_url" ]] || block STATUS_API_UNCONFIGURED "NETBIRD_STATUS_URL is required for SafeNet peer status."
[[ -n "$status_token" ]] || block STATUS_API_TOKEN_MISSING "NETBIRD_STATUS_TOKEN is required for SafeNet peer status."
[[ -n "$peer_name" ]] || block ANDROID_PEER_UNCONFIGURED "NETBIRD_ANDROID_PEER_NAME is required."
[[ -n "$peer_address" ]] || block PEER_UNCONFIGURED "NETBIRD_ANDROID_PEER_ADDRESS is required."
[[ "$login_server_confirmed" == pass ]] || block MANAGEMENT_URL_UNCONFIRMED "Confirm the Android client uses the configured self-hosted management URL."
[[ "$persistent_state_confirmed" == pass ]] || block PERSISTENT_STATE_UNCONFIRMED "Confirm external NetBird state is persistent."
command -v curl >/dev/null 2>&1 || block CURL_UNAVAILABLE "curl is required."
command -v node >/dev/null 2>&1 || block NODE_UNAVAILABLE "node is required to parse bounded responses."
command -v adb >/dev/null 2>&1 || block ADB_UNAVAILABLE "adb is required."
url_is_http() { [[ "$1" =~ ^https?://[^/@[:space:]]+(/|$) ]]; }
url_is_http "$management_url" || block CONTROL_PLANE_URL_INVALID "NETBIRD_MANAGEMENT_URL must be HTTP or HTTPS."
url_is_http "$status_url" || block STATUS_URL_INVALID "NETBIRD_STATUS_URL must be HTTP or HTTPS."
management_url="${management_url%/}"; status_url="${status_url%/}"
peer_response="$output_dir/.netbird-peers.json"; status_response="$output_dir/.netbird-status.json"
http_status() { curl --silent --show-error --location --connect-timeout 5 --max-time "$CURL_TIMEOUT_SECONDS" -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo 000; }
peer_http_status="$(http_status -H "Accept: application/json" -H "Authorization: Token $api_token" "$management_url/api/peers")"
[[ "$peer_http_status" =~ ^2[0-9][0-9]$ ]] || block CONTROL_PLANE_UNAVAILABLE "NetBird peer API returned HTTP $peer_http_status."
curl --silent --show-error --location --connect-timeout 5 --max-time "$CURL_TIMEOUT_SECONDS" -H "Accept: application/json" -H "Authorization: Token $api_token" -o "$peer_response" "$management_url/api/peers" 2>/dev/null ||
  block CONTROL_PLANE_PEER_READ_FAILED "NetBird peer data could not be read."
peer_summary="$output_dir/netbird-peer-summary.txt"
node -e '
const fs=require("node:fs"), p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")), n=process.argv[2];
const peers=Array.isArray(p)?p:(Array.isArray(p.peers)?p.peers:[]);
const x=peers.find(v=>[v.name,v.hostname,v.fqdn].includes(n)); if(!x) process.exit(3);
const owner=typeof x.user_id==="string"?x.user_id:(typeof x.user==="string"?x.user:"UNKNOWN");
const online=x.connected===true||x.online===true?"true":x.connected===false||x.online===false?"false":"UNKNOWN";
for(const [k,v] of [["peer_name",x.name||x.hostname||n],["peer_owner",owner||"UNKNOWN"],["peer_online",online],["peer_address",Array.isArray(x.ip_addresses)?x.ip_addresses.join(","):(x.ip||"UNKNOWN")],["peer_last_seen",x.last_seen||x.lastSeen||"UNKNOWN"]]) process.stdout.write(`${k}=${String(v).replace(/[\\r\\n]/g," ")}\n`);
' "$peer_response" "$peer_name" >"$peer_summary" || block ANDROID_PEER_NOT_REGISTERED "NetBird did not return the configured Android peer."
rm -f "$peer_response"
peer_online="$(awk -F= '$1=="peer_online"{print $2;exit}' "$peer_summary")"; peer_owner="$(awk -F= '$1=="peer_owner"{print substr($0,index($0,"=")+1);exit}' "$peer_summary")"
[[ "$peer_online" == true ]] || block ANDROID_PEER_OFFLINE "The NetBird peer is not connected."
[[ -n "$peer_owner" && "$peer_owner" != UNKNOWN ]] || block ANDROID_PEER_OWNER_MISSING "NetBird did not report a peer owner."
status_http_status="$(curl --silent --show-error --location --connect-timeout 5 --max-time "$CURL_TIMEOUT_SECONDS" --get --data-urlencode "name=$peer_name" -H "Accept: application/json" -H "Authorization: Bearer $status_token" -o "$status_response" -w '%{http_code}' "$status_url" 2>/dev/null || echo 000)"
[[ "$status_http_status" =~ ^2[0-9][0-9]$ ]] || block STATUS_API_UNAVAILABLE "SafeNet NetBird peer-status returned HTTP $status_http_status."
status_summary="$output_dir/netbird-status-summary.txt"
node -e '
const fs=require("node:fs"),p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const x=p.peer&&typeof p.peer==="object"?p.peer:p;
const name=x.name||x.peer_name, online=x.status==="online"||x.online===true||x.connected===true?"online":x.status==="offline"||x.online===false||x.connected===false?"offline":"";
if(!name||!online) process.exit(4); for(const [k,v] of [["status_peer_name",name],["status_peer_online",online],["status_peer_owner",x.owner||x.user||"UNKNOWN"]]) process.stdout.write(`${k}=${String(v).replace(/[\\r\\n]/g," ")}\n`);
' "$status_response" >"$status_summary" || block STATUS_API_UNSUPPORTED "SafeNet peer-status returned an unsupported bounded contract."
rm -f "$status_response"
status_peer_name="$(awk -F= '$1=="status_peer_name"{print $2;exit}' "$status_summary")"; status_peer_online="$(awk -F= '$1=="status_peer_online"{print $2;exit}' "$status_summary")"
[[ "$status_peer_name" == "$peer_name" ]] || block STATUS_PEER_MISMATCH "SafeNet peer-status returned a different peer."
[[ "$status_peer_online" == online ]] || block STATUS_PEER_OFFLINE "SafeNet peer-status does not report the peer online."
adb start-server >"$output_dir/adb-start-server.txt" 2>&1 || block ADB_UNAVAILABLE "adb could not start."
adb devices -l >"$output_dir/adb-devices.txt" 2>&1 || block ADB_UNAVAILABLE "adb could not enumerate targets."
if [[ -z "$serial" ]]; then mapfile -t d < <(adb devices | awk 'NR>1&&$2=="device"{print $1}'); [[ "${#d[@]}" -eq 1 ]] || block ANDROID_TARGET_AMBIGUOUS "Exactly one physical Android target is required."; serial="${d[0]}"; fi
adb -s "$serial" get-state 2>/dev/null | tr -d '\r' | grep -qx device || block ANDROID_TARGET_OFFLINE "Android target is not online."
[[ "$(adb -s "$serial" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r')" != 1 ]] || block ANDROID_EMULATOR_TARGET "A physical Android client is required."
{ printf 'serial=%s\nmanufacturer=%s\nmodel=%s\nandroid=%s\nsdk=%s\nro.kernel.qemu=%s\n' "$serial" "$(adb -s "$serial" shell getprop ro.product.manufacturer|tr -d '\r')" "$(adb -s "$serial" shell getprop ro.product.model|tr -d '\r')" "$(adb -s "$serial" shell getprop ro.build.version.release|tr -d '\r')" "$(adb -s "$serial" shell getprop ro.build.version.sdk|tr -d '\r')" "$(adb -s "$serial" shell getprop ro.kernel.qemu|tr -d '\r')"; } | tee "$output_dir/device-details.txt"
adb -s "$serial" shell pm path "$client_package" >"$output_dir/client-package.txt" 2>&1 || block CLIENT_NOT_INSTALLED "The explicit NetBird Android client package is not installed."
client_build="$(adb -s "$serial" shell dumpsys package "$client_package" 2>/dev/null|sed -nE 's/^[[:space:]]*versionName=([^[:space:]]+).*/\1/p'|head -n1|tr -d '\r')"; [[ -n "$client_build" ]] || block CLIENT_BUILD_UNAVAILABLE "NetBird client version unavailable."
printf 'package=%s\nversion_name=%s\n' "$client_package" "$client_build" | tee "$output_dir/client-build.txt"
interfaces="$(adb -s "$serial" shell ip -o link 2>/dev/null|tr -d '\r')"; printf '%s\n' "$interfaces"|head -c 200000 >"$output_dir/vpn-interfaces.txt"
if [[ -z "$vpn_interface" ]]; then vpn_interface="$(printf '%s\n' "$interfaces"|sed -nE 's/^[0-9]+: ([^:]+):.*/\1/p'|grep -E '^(wt|nb|tun|wg)'|head -n1||true)"; fi
[[ -n "$vpn_interface" ]] || block VPN_INTERFACE_MISSING "No NetBird/WireGuard VPN interface was visible."
route_output="$(adb -s "$serial" shell ip route get "$peer_address" 2>&1|tr -d '\r')"; printf '%s\n' "$route_output"|head -c 200000 >"$output_dir/peer-route.txt"
printf '%s\n' "$route_output"|grep -Eq "(^|[[:space:]])dev[[:space:]]+$vpn_interface([[:space:]]|$)" || block PEER_ROUTE_NOT_MESH "Approved peer does not route through NetBird VPN interface."
adb -s "$serial" shell ping -c 3 -W 3 "$peer_address" >"$output_dir/peer-ping.txt" 2>&1 || block PEER_UNREACHABLE "Android client could not reach approved peer."
grep -Eq '[0-9]+ packets transmitted, [0-9]+ (packets )?received' "$output_dir/peer-ping.txt" || block PEER_PROBE_UNVERIFIED "Peer probe lacked a bounded packet result."
{
  printf 'evidence_schema_version=1\nvalidation_mode=netbird-android-mesh\nresult=PASS\nmanagement_url=%s\nstatus_url=%s\n' "$management_url" "$status_url"
  printf 'peer_http_status=%s\nstatus_http_status=%s\npeer_name=%s\npeer_owner=%s\npeer_online=%s\n' "$peer_http_status" "$status_http_status" "$peer_name" "$peer_owner" "$peer_online"
  printf 'status_peer_name=%s\nstatus_peer_online=%s\nmanagement_url_confirmed=%s\npersistent_state_confirmed=%s\n' "$status_peer_name" "$status_peer_online" "$login_server_confirmed" "$persistent_state_confirmed"
  printf 'client_package=%s\nclient_build=%s\ntarget=%s\npeer_address=%s\nvpn_interface=%s\n' "$client_package" "$client_build" "$serial" "$peer_address" "$vpn_interface"
  printf 'peer_registration=PASS\nstatus_adapter=PASS\nencrypted_path=PASS\npeer_probe=PASS\nnative_safenet_vpn=NOT_IMPLEMENTED\n'
} | tee "$output_dir/result.txt"
echo "NetBird Android mesh verification passed. Evidence: $output_dir"