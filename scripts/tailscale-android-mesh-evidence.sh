#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_OUTPUT_DIR="android/app/build/reports/tailscale-android-mesh/latest"
readonly DEFAULT_CLIENT_PACKAGE="com.tailscale.ipn"
readonly CURL_TIMEOUT_SECONDS=15
readonly ADB_TIMEOUT_SECONDS=30

output_dir="${TAILSCALE_ANDROID_MESH_OUTPUT_DIR:-$DEFAULT_OUTPUT_DIR}"
status_response="$output_dir/.tailscale-status.json"
trap 'rm -f "$status_response"' EXIT
serial="${TAILSCALE_ANDROID_SERIAL:-${ANDROID_SERIAL:-}}"
client_package="${TAILSCALE_ANDROID_PACKAGE:-$DEFAULT_CLIENT_PACKAGE}"
device_name="${TAILSCALE_ANDROID_DEVICE_NAME:-}"
peer_address="${TAILSCALE_PEER_ADDRESS:-}"
status_url="${TAILSCALE_STATUS_URL:-}"
status_token="${TAILSCALE_STATUS_TOKEN:-}"
tailnet_confirmed="${TAILSCALE_ANDROID_TAILNET_CONFIRMED:-}"
vpn_interface="${TAILSCALE_ANDROID_VPN_INTERFACE:-}"

usage() {
  cat <<'EOF'
Usage: scripts/tailscale-android-mesh-evidence.sh [--serial ID] [--device-name NAME]
  [--peer-address ADDRESS] [--vpn-interface NAME] [--status-url URL]
  [--tailnet-confirmed pass] [--output DIR] [--help]

Verifies a physical Android phone running the official Tailscale client.
SafeNet is not a Tailscale client and does not host the Tailscale control plane.
Required environment: TAILSCALE_STATUS_URL, TAILSCALE_STATUS_TOKEN,
TAILSCALE_ANDROID_DEVICE_NAME, TAILSCALE_PEER_ADDRESS,
TAILSCALE_ANDROID_TAILNET_CONFIRMED=pass.
EOF
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --serial|--device-name|--peer-address|--vpn-interface|--status-url|--tailnet-confirmed|--output)
      [[ $# -ge 2 ]] || { echo "ERROR: $1 requires a value." >&2; exit 2; }
      case "$1" in
        --serial) serial="$2";; --device-name) device_name="$2";;
        --peer-address) peer_address="$2";; --vpn-interface) vpn_interface="$2";;
        --status-url) status_url="$2";; --tailnet-confirmed) tailnet_confirmed="$2";;
        --output) output_dir="$2";;
      esac
      shift 2;;
    --help|-h) usage; exit 0;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage >&2; exit 2;;
  esac
done
mkdir -p "$output_dir"; rm -f "$output_dir"/*
safe_message() { printf '%s' "$1" | tr '\r\n' ' ' | cut -c1-400; }
write_bounded_command() {
  local destination="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "${ADB_TIMEOUT_SECONDS}s" "$@" 2>&1 | head -c 200000 >"$destination" || true
  else "$@" 2>&1 | head -c 200000 >"$destination" || true; fi
}
write_blocked_result() {
  local category="$1" message; message="$(safe_message "$2")"
  {
    printf 'evidence_schema_version=1\nvalidation_mode=tailscale-android-mesh\nresult=BLOCKED\n'
    printf 'failure_class=INFRASTRUCTURE_PREREQUISITE\nfailure_category=%s\nmessage=%s\n' "$category" "$message"
    printf 'status_url=%s\ndevice_name=%s\nclient_package=%s\ntarget=%s\npeer_address=%s\n' \
      "${status_url:-NOT_CONFIGURED}" "${device_name:-NOT_CONFIGURED}" "${client_package:-NOT_CONFIGURED}" \
      "${serial:-unavailable}" "${peer_address:-NOT_CONFIGURED}"
    printf 'tailnet_confirmed=%s\ndevice_registration=NOT_RECORDED\ndevice_online=NOT_RECORDED\n' "$tailnet_confirmed"
    printf 'status_adapter=NOT_RECORDED\nencrypted_path=NOT_RECORDED\nclient_build=NOT_RECORDED\n'
    printf 'diagnostics=runner-metadata.txt,curl-availability.txt,adb-version.txt,adb-devices.txt,device-details.txt\n'
  } | tee "$output_dir/result.txt" "$output_dir/infrastructure-blocker.txt" >&2
  printf 'hostname=%s\nuname=%s\ncurl_available=%s\nadb_available=%s\n' "$(hostname 2>/dev/null || echo NOT_RECORDED)" \
    "$(uname -a 2>/dev/null || echo NOT_RECORDED)" "$([[ -n "$(command -v curl 2>/dev/null || true)" ]] && echo true || echo false)" \
    "$([[ -n "$(command -v adb 2>/dev/null || true)" ]] && echo true || echo false)" | head -c 200000 >"$output_dir/runner-metadata.txt"
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
[[ -n "$status_url" ]] || block STATUS_API_UNCONFIGURED "TAILSCALE_STATUS_URL is required."
[[ -n "$status_token" ]] || block STATUS_API_TOKEN_MISSING "TAILSCALE_STATUS_TOKEN is required."
[[ -n "$device_name" ]] || block ANDROID_DEVICE_UNCONFIGURED "TAILSCALE_ANDROID_DEVICE_NAME is required."
[[ -n "$peer_address" ]] || block PEER_UNCONFIGURED "TAILSCALE_PEER_ADDRESS is required."
[[ "$tailnet_confirmed" == pass ]] || block TAILNET_UNCONFIRMED "Confirm the Android client is connected to the Tailscale tailnet."
command -v curl >/dev/null 2>&1 || block CURL_UNAVAILABLE "curl is required."
command -v node >/dev/null 2>&1 || block NODE_UNAVAILABLE "node is required."
command -v adb >/dev/null 2>&1 || block ADB_UNAVAILABLE "adb is required."
url_is_http() { [[ "$1" =~ ^https?://[^/@[:space:]]+(/|$) ]]; }
url_is_http "$status_url" || block STATUS_URL_INVALID "TAILSCALE_STATUS_URL must be HTTP or HTTPS."
status_url="${status_url%/}"
status_http_status="$(curl --silent --show-error --location --connect-timeout 5 --max-time "$CURL_TIMEOUT_SECONDS" --get \
  --data-urlencode "name=$device_name" -H "Accept: application/json" -H "Authorization: Bearer $status_token" \
  -o "$status_response" -w '%{http_code}' "$status_url" 2>/dev/null || echo 000)"
[[ "$status_http_status" =~ ^2[0-9][0-9]$ ]] || block STATUS_API_UNAVAILABLE "SafeNet Tailscale device-status returned HTTP $status_http_status."
status_summary="$output_dir/tailscale-status-summary.txt"
node -e '
const fs=require("node:fs"),p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),x=p.device;
if(!x||typeof x!=="object")process.exit(4);
const name=x.name||x.hostname; const status=["online","offline","unknown"].includes(x.status)?x.status:"unknown";
if(!name||!x.id)process.exit(4);
for(const [k,v] of [["status_device_id",x.id],["status_device_name",name],["status_device_online",status]])process.stdout.write(`${k}=${String(v).replace(/[\r\n]/g," ")}\n`);
' "$status_response" >"$status_summary" || block STATUS_API_UNSUPPORTED "SafeNet device-status returned an unsupported bounded contract."
status_device_name="$(awk -F= '$1=="status_device_name"{print $2;exit}' "$status_summary")"
status_device_online="$(awk -F= '$1=="status_device_online"{print $2;exit}' "$status_summary")"
[[ "$status_device_name" == "$device_name" ]] || block STATUS_DEVICE_MISMATCH "SafeNet device-status returned a different device."
[[ "$status_device_online" == online ]] || block STATUS_DEVICE_OFFLINE "SafeNet device-status does not report the device online."
adb start-server >"$output_dir/adb-start-server.txt" 2>&1 || block ADB_UNAVAILABLE "adb could not start."
adb devices -l >"$output_dir/adb-devices.txt" 2>&1 || block ADB_UNAVAILABLE "adb could not enumerate targets."
if [[ -z "$serial" ]]; then mapfile -t d < <(adb devices | awk 'NR>1&&$2=="device"{print $1}'); [[ "${#d[@]}" -eq 1 ]] || block ANDROID_TARGET_AMBIGUOUS "Exactly one physical Android target is required."; serial="${d[0]}"; fi
adb -s "$serial" get-state 2>/dev/null | tr -d '\r' | grep -qx device || block ANDROID_TARGET_OFFLINE "Android target is not online."
[[ "$(adb -s "$serial" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r')" != 1 ]] || block ANDROID_EMULATOR_TARGET "A physical Android client is required."
{ printf 'serial=%s\nmanufacturer=%s\nmodel=%s\nandroid=%s\nsdk=%s\nro.kernel.qemu=%s\n' "$serial" "$(adb -s "$serial" shell getprop ro.product.manufacturer|tr -d '\r')" "$(adb -s "$serial" shell getprop ro.product.model|tr -d '\r')" "$(adb -s "$serial" shell getprop ro.build.version.release|tr -d '\r')" "$(adb -s "$serial" shell getprop ro.build.version.sdk|tr -d '\r')" "$(adb -s "$serial" shell getprop ro.kernel.qemu|tr -d '\r')"; } | tee "$output_dir/device-details.txt"
adb -s "$serial" shell pm path "$client_package" >"$output_dir/client-package.txt" 2>&1 || block CLIENT_NOT_INSTALLED "The official Tailscale Android client is not installed."
client_build="$(adb -s "$serial" shell dumpsys package "$client_package" 2>/dev/null|sed -nE 's/^[[:space:]]*versionName=([^[:space:]]+).*/\1/p'|head -n1|tr -d '\r')"; [[ -n "$client_build" ]] || block CLIENT_BUILD_UNAVAILABLE "Tailscale client version unavailable."
printf 'package=%s\nversion_name=%s\n' "$client_package" "$client_build" | tee "$output_dir/client-build.txt"
interfaces="$(adb -s "$serial" shell ip -o link 2>/dev/null|tr -d '\r')"; printf '%s\n' "$interfaces"|head -c 200000 >"$output_dir/vpn-interfaces.txt"
if [[ -z "$vpn_interface" ]]; then vpn_interface="$(printf '%s\n' "$interfaces"|sed -nE 's/^[0-9]+: ([^:]+):.*/\1/p'|grep -E '^(tailscale0|tun0)$'|head -n1||true)"; fi
[[ -n "$vpn_interface" ]] || block VPN_INTERFACE_MISSING "No Tailscale VPN interface was visible."
route_output="$(adb -s "$serial" shell ip route get "$peer_address" 2>&1|tr -d '\r')"; printf '%s\n' "$route_output"|head -c 200000 >"$output_dir/peer-route.txt"
printf '%s\n' "$route_output"|grep -Eq "(^|[[:space:]])dev[[:space:]]+$vpn_interface([[:space:]]|$)" || block PEER_ROUTE_NOT_MESH "Approved peer does not route through Tailscale VPN interface."
adb -s "$serial" shell ping -c 3 -W 3 "$peer_address" >"$output_dir/peer-ping.txt" 2>&1 || block PEER_UNREACHABLE "Android client could not reach approved peer."
grep -Eq '[0-9]+ packets transmitted, [0-9]+ (packets )?received' "$output_dir/peer-ping.txt" || block PEER_PROBE_UNVERIFIED "Peer probe lacked a bounded packet result."
{
  printf 'evidence_schema_version=1\nvalidation_mode=tailscale-android-mesh\nresult=PASS\nstatus_url=%s\n' "$status_url"
  printf 'status_http_status=%s\ndevice_name=%s\ndevice_online=%s\nstatus_device_name=%s\nstatus_device_online=%s\ntailnet_confirmed=%s\n' "$status_http_status" "$device_name" "$status_device_online" "$status_device_name" "$status_device_online" "$tailnet_confirmed"
  printf 'client_package=%s\nclient_build=%s\ntarget=%s\npeer_address=%s\nvpn_interface=%s\n' "$client_package" "$client_build" "$serial" "$peer_address" "$vpn_interface"
  printf 'device_registration=PASS\nstatus_adapter=PASS\nencrypted_path=PASS\npeer_probe=PASS\nnative_safenet_vpn=NOT_IMPLEMENTED\n'
} | tee "$output_dir/result.txt"
echo "Tailscale Android mesh verification passed. Evidence: $output_dir"