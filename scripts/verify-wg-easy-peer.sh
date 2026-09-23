#!/usr/bin/env bash
set -euo pipefail

# This script deliberately emits only redacted evidence. The WG-Easy configuration
# and private key stay in a mode-600 temporary file and are never printed.

ADMIN_URL="${WG_EASY_URL:-}"
WIREGUARD_ENDPOINT="${WG_EASY_WIREGUARD_ENDPOINT:-}"
USERNAME="${WG_EASY_ADMIN_USERNAME:-}"
PASSWORD="${WG_EASY_ADMIN_PASSWORD:-}"
RESULT_FILE="${WG_EASY_RESULT_FILE:-/var/lib/wg-easy/safenet-tunnel-check.json}"
WG_CONTAINER="${WG_EASY_CONTAINER_NAME:-wg-easy}"
WG_INTERFACE="${WG_EASY_INTERFACE:-wg0}"
CHECKED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/safenet-wg-check.XXXXXX")"
CONFIG_FILE="${TEMP_DIR}/sfchk.conf"
AUTH_FILE="${TEMP_DIR}/curl.conf"
CLIENT_ID=""
INTERFACE=""
PEER_CREATED=false
PEER_DELETED=false
HANDSHAKE_AT=""
HOST_HANDSHAKE_AT=""
CLEANED_UP=false

json_result() {
  local status="$1"
  local message="$2"
  local exit_code="$3"
  local result
  # jq is used only to safely encode the bounded, non-secret result message.
  result="$(jq -cn \
    --arg status "${status}" \
    --arg checkedAt "${CHECKED_AT}" \
    --arg message "${message}" \
    --arg peerHandshakeAt "${HANDSHAKE_AT}" \
    --arg hostHandshakeAt "${HOST_HANDSHAKE_AT}" \
    --argjson peerCreated "${PEER_CREATED}" \
    --argjson peerDeleted "${PEER_DELETED}" \
    '{status:$status,checkedAt:$checkedAt,peerCreated:$peerCreated,peerDeleted:$peerDeleted,peerHandshakeAt:(if $peerHandshakeAt == "" then null else $peerHandshakeAt end),hostHandshakeAt:(if $hostHandshakeAt == "" then null else $hostHandshakeAt end),message:$message}')"
  if mkdir -p "$(dirname -- "${RESULT_FILE}")" 2>/dev/null; then
    chmod 700 "$(dirname -- "${RESULT_FILE}")" 2>/dev/null || true
    printf '%s\n' "${result}" > "${RESULT_FILE}" 2>/dev/null || true
    chmod 600 "${RESULT_FILE}" 2>/dev/null || true
  fi
  printf '%s\n' "${result}"
  return "${exit_code}"
}

cleanup() {
  [[ "${CLEANED_UP}" == "true" ]] && return 0
  CLEANED_UP=true
  if [[ -n "${INTERFACE}" ]]; then
    wg-quick down "${INTERFACE}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${CLIENT_ID}" ]]; then
    if curl --silent --show-error --fail --max-time 15 --config "${AUTH_FILE}" \
      --request DELETE "${ADMIN_URL}/api/client/${CLIENT_ID}" >/dev/null 2>&1; then
      PEER_DELETED=true
    fi
  fi
  rm -rf -- "${TEMP_DIR}"
}

finish() {
  local status="$1"
  local message="$2"
  local exit_code="$3"
  cleanup
  trap - EXIT
  if [[ "${status}" == "verified" && "${PEER_DELETED}" != "true" ]]; then
    status="failed"
    message="The WireGuard handshake was observed, but WG-Easy could not delete the disposable peer."
    exit_code=1
  fi
  json_result "${status}" "${message}" "${exit_code}"
}
trap 'cleanup' EXIT

if [[ "${EUID}" -ne 0 ]]; then
  finish failed "The WireGuard verifier must run as root on the WG-Easy host." 1
fi
for command in curl jq wg wg-quick docker; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    finish failed "The WG-Easy host is missing the ${command} command." 1
  fi
done
if [[ -z "${ADMIN_URL}" || -z "${WIREGUARD_ENDPOINT}" || -z "${USERNAME}" || -z "${PASSWORD}" ]]; then
  finish failed "WG_EASY_URL, WG_EASY_WIREGUARD_ENDPOINT, WG_EASY_ADMIN_USERNAME, and WG_EASY_ADMIN_PASSWORD are required." 1
fi
if [[ ! "${ADMIN_URL}" =~ ^https?://[^[:space:]/]+(:[0-9]+)?(/.*)?$ ]]; then
  finish failed "WG_EASY_URL must be an HTTP or HTTPS URL." 1
fi
ADMIN_URL="${ADMIN_URL%/}"
if [[ "${WIREGUARD_ENDPOINT}" == */udp ]]; then
  WIREGUARD_ENDPOINT="${WIREGUARD_ENDPOINT%/udp}"
fi
if [[ ! "${WIREGUARD_ENDPOINT}" =~ :[0-9]+$ ]]; then
  finish failed "WG_EASY_WIREGUARD_ENDPOINT must include the WireGuard UDP port." 1
fi

# Keep credentials out of the curl process arguments and out of all output.
escaped_user="${USERNAME//\\/\\\\}"
escaped_user="${escaped_user//\"/\\\"}"
escaped_password="${PASSWORD//\\/\\\\}"
escaped_password="${escaped_password//\"/\\\"}"
printf 'user = "%s:%s"\n' "${escaped_user}" "${escaped_password}" > "${AUTH_FILE}"
chmod 600 "${AUTH_FILE}"

peer_name="safenet-tunnel-check-$(date +%s)"
create_response="$(curl --silent --show-error --fail --max-time 15 --config "${AUTH_FILE}" \
  --header "Accept: application/json" --header "Content-Type: application/json" \
  --data "{\"name\":\"${peer_name}\",\"expiresAt\":null}" \
  "${ADMIN_URL}/api/client" 2>/dev/null)" || finish failed "WG-Easy admin API could not create the disposable peer." 1
CLIENT_ID="$(jq -r '.clientId // empty' <<<"${create_response}")"
if [[ ! "${CLIENT_ID}" =~ ^[0-9]+$ ]]; then
  finish failed "WG-Easy created no disposable peer id." 1
fi
PEER_CREATED=true

if ! curl --silent --show-error --fail --max-time 15 --config "${AUTH_FILE}" \
  --header "Accept: application/octet-stream" \
  --output "${CONFIG_FILE}" "${ADMIN_URL}/api/client/${CLIENT_ID}/configuration" 2>/dev/null; then
  finish failed "WG-Easy returned no disposable peer configuration." 1
fi
if [[ ! -s "${CONFIG_FILE}" ]] ||
  ! grep -q '^\[Interface\]' "${CONFIG_FILE}" ||
  ! grep -q '^\[Peer\]' "${CONFIG_FILE}"; then
  finish failed "WG-Easy returned an invalid disposable peer configuration." 1
fi
config_endpoint="$(awk -F= 'tolower($1) ~ /^[[:space:]]*endpoint[[:space:]]*$/ { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit }' "${CONFIG_FILE}")"
if [[ "${config_endpoint}" != "${WIREGUARD_ENDPOINT}" ]]; then
  finish failed "The disposable peer configuration does not use WG_EASY_WIREGUARD_ENDPOINT." 1
fi
peer_public_key="$(awk -F= 'tolower($1) ~ /^[[:space:]]*publickey[[:space:]]*$/ { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit }' "${CONFIG_FILE}")"
if [[ -z "${peer_public_key}" ]]; then
  finish failed "The disposable peer configuration has no server public key." 1
fi
private_key="$(awk -F= 'tolower($1) ~ /^[[:space:]]*privatekey[[:space:]]*$/ { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit }' "${CONFIG_FILE}")"
if [[ -z "${private_key}" ]]; then
  finish failed "The disposable peer configuration has no private key." 1
fi
client_public_key="$(printf '%s\n' "${private_key}" | wg pubkey)"
unset private_key

# Do not install the peer's routes or DNS settings on the host. Only the UDP
# handshake is under test.
awk '
  /^\[Interface\]/ { in_interface=1; print; next }
  /^\[Peer\]/ { in_interface=0; print; next }
  in_interface && /^[[:space:]]*DNS[[:space:]]*=/ { next }
  in_interface && /^[[:space:]]*Table[[:space:]]*=/ { next }
  { print }
  /^\[Interface\]/ { print "Table = off" }
' "${CONFIG_FILE}" > "${CONFIG_FILE}.safe"
mv "${CONFIG_FILE}.safe" "${CONFIG_FILE}"
chmod 600 "${CONFIG_FILE}"
INTERFACE="$(basename "${CONFIG_FILE}" .conf)"
if ! wg-quick up "${CONFIG_FILE}" >/dev/null 2>&1; then
  finish failed "The disposable peer could not bring up a WireGuard interface; the admin UI may still be online." 1
fi
wg set "${INTERFACE}" peer "${peer_public_key}" persistent-keepalive 10 >/dev/null 2>&1 || true

deadline=$((SECONDS + 25))
while (( SECONDS < deadline )); do
  now="$(date +%s)"
  latest_handshake="$(wg show "${INTERFACE}" latest-handshakes 2>/dev/null | awk '$2 ~ /^[0-9]+$/ && $2 > latest { latest=$2 } END { print latest + 0 }')"
  host_handshake="$(docker exec "${WG_CONTAINER}" wg show "${WG_INTERFACE}" latest-handshakes 2>/dev/null |
    awk -v key="${client_public_key}" '$1 == key && $2 ~ /^[0-9]+$/ { print $2; exit }')"
  if [[ "${latest_handshake}" =~ ^[0-9]+$ ]] &&
    [[ "${host_handshake}" =~ ^[0-9]+$ ]] &&
    (( latest_handshake > 0 && latest_handshake <= now && now - latest_handshake < 20 )) &&
    (( host_handshake > 0 && host_handshake <= now && now - host_handshake < 20 )); then
    HANDSHAKE_AT="$(date -u -d "@${latest_handshake}" +%Y-%m-%dT%H:%M:%SZ)"
    HOST_HANDSHAKE_AT="$(date -u -d "@${host_handshake}" +%Y-%m-%dT%H:%M:%SZ)"
    finish verified "The disposable peer and WG-Easy host both observed a WireGuard handshake through the configured UDP endpoint." 0
  fi
  sleep 1
done
finish failed "WG-Easy admin UI succeeded, but no WireGuard UDP handshake was observed through the configured endpoint." 1