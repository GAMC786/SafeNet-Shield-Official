#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

usage() {
    cat <<'USAGE'
Usage:
  verify-restored-identities.sh \
    --url HEADSCALE_URL \
    --api-key-file API_KEY_FILE \
    --identity MANIFEST \
    --result RESULT_FILE

The API key is read from a file and is never written to the result. The
manifest must contain only:
  android_node_name, android_node_id, android_node_public_key,
  approved_peer_name, approved_peer_id, approved_peer_public_key,
  approved_peer_address
USAGE
}

die() {
    printf '%s: %s\n' "$SCRIPT_NAME" "$1" >&2
    exit 1
}

write_result() {
    local result="$1"
    shift
    mkdir -p "$(dirname "$result")"
    {
        printf 'evidence_schema_version=1\n'
        printf '%s\n' "$@"
    } > "$result"
}

manifest_value() {
    local manifest="$1"
    local key="$2"
    awk -F= -v wanted="$key" '
        $1 == wanted {
            print substr($0, index($0, "=") + 1)
            found = 1
            exit
        }
        END {
            if (!found) exit 1
        }
    ' "$manifest"
}

[[ $# -gt 0 ]] || { usage >&2; exit 2; }
url=""
api_key_file=""
identity=""
result=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --url) url="${2:-}"; shift 2 ;;
        --api-key-file) api_key_file="${2:-}"; shift 2 ;;
        --identity) identity="${2:-}"; shift 2 ;;
        --result) result="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) die "unknown option: $1" ;;
    esac
done

[[ -n "$url" && -n "$api_key_file" && -n "$identity" && -n "$result" ]] ||
    die "--url, --api-key-file, --identity, and --result are required"
[[ -f "$api_key_file" ]] || die "API key file does not exist"
[[ -f "$identity" ]] || die "identity manifest does not exist"
command -v curl >/dev/null 2>&1 || die "required command is unavailable: curl"
command -v node >/dev/null 2>&1 || die "required command is unavailable: node"

android_name="$(manifest_value "$identity" android_node_name)"
android_id="$(manifest_value "$identity" android_node_id)"
android_key="$(manifest_value "$identity" android_node_public_key)"
peer_name="$(manifest_value "$identity" approved_peer_name)"
peer_id="$(manifest_value "$identity" approved_peer_id)"
peer_key="$(manifest_value "$identity" approved_peer_public_key)"
peer_address="$(manifest_value "$identity" approved_peer_address)"
[[ -n "$android_name" && -n "$android_id" && -n "$android_key" &&
    -n "$peer_name" && -n "$peer_id" && -n "$peer_key" && -n "$peer_address" ]] ||
    die "identity manifest is incomplete"

api_key="$(tr -d '\r\n' < "$api_key_file")"
[[ -n "$api_key" ]] || die "API key file is empty"
response="$(mktemp)"
summary="$(mktemp)"
trap 'rm -f "$response" "$summary"' EXIT
http_status="$(
    curl --silent --show-error --location --connect-timeout 5 --max-time 20 \
        -H "Accept: application/json" \
        -H "Authorization: Bearer $api_key" \
        -o "$response" -w '%{http_code}' \
        "${url%/}/api/v1/node" 2>/dev/null || true
)"
unset api_key
[[ "$http_status" =~ ^2[0-9][0-9]$ ]] || {
    write_result "$result" \
        "operation=live-identity-check" \
        "result=BLOCKED" \
        "failure_category=CONTROL_PLANE_UNAVAILABLE" \
        "http_status=${http_status:-000}"
    die "Headscale node API did not return a successful response"
}

# shellcheck disable=SC2016
node \
    -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const expected = Object.fromEntries(
  fs.readFileSync(process.argv[2], "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const nodes = Array.isArray(payload) ? payload : payload.nodes;
if (!Array.isArray(nodes)) throw new Error("node list is not an array");
const find = (name) => nodes.find((node) =>
  [node.name, node.hostname, node.givenName].includes(name)
);
const android = find(expected.android_node_name);
const peer = find(expected.approved_peer_name);
if (!android || !peer) throw new Error("one or more expected nodes are missing");
const value = (node, ...keys) => {
  for (const key of keys) {
    if (node[key] !== undefined && node[key] !== null) return String(node[key]);
  }
  return "";
};
const addresses = (node) =>
  Array.isArray(node.ipAddresses) ? node.ipAddresses.map(String) : [];
const owner = android.user && typeof android.user === "object"
  ? (android.user.name || android.user.displayName || "")
  : String(android.user || "");
const checks = {
  android_name: value(android, "name", "hostname", "givenName") === expected.android_node_name,
  android_id: value(android, "id") === expected.android_node_id,
  android_public_key: value(android, "nodeKey", "publicKey") === expected.android_node_public_key,
  android_owner: owner === "safenet",
  android_online: android.online === true,
  peer_name: value(peer, "name", "hostname", "givenName") === expected.approved_peer_name,
  peer_id: value(peer, "id") === expected.approved_peer_id,
  peer_public_key: value(peer, "nodeKey", "publicKey") === expected.approved_peer_public_key,
  peer_address: addresses(peer).includes(expected.approved_peer_address),
  peer_online: peer.online === true,
};
for (const [key, pass] of Object.entries(checks)) {
  process.stdout.write(`${key}=${pass ? "PASS" : "FAIL"}\n`);
}
if (Object.values(checks).some((pass) => !pass)) process.exit(2);
' "$response" "$identity" > "$summary" 2>/dev/null || {
    write_result "$result" \
        "operation=live-identity-check" \
        "result=FAIL" \
        "failure_category=IDENTITY_MISMATCH" \
        "http_status=$http_status"
    die "restored Headscale identities did not match the pre-replacement manifest"
}

{
    printf 'evidence_schema_version=1\n'
    printf 'operation=live-identity-check\nresult=PASS\n'
    printf 'http_status=%s\n' "$http_status"
    cat "$summary"
    printf 'android_node_identity=PASS\napproved_peer_identity=PASS\n'
    printf 'raw_response=REMOVED\napi_key=REMOVED\n'
} > "$result"
printf 'Restored Headscale Android and approved-peer identities match.\n'