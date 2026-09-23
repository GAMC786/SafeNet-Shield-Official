#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
readonly MANIFEST_NAME="restore-manifest.env"

usage() {
    cat <<'USAGE'
Usage:
  backup-restore-check.sh create \
    --source BUNDLE_ROOT --output ARCHIVE \
    --identity MANIFEST [--result RESULT_FILE]
  backup-restore-check.sh restore-check \
    --archive ARCHIVE --target EMPTY_REPLACEMENT_ROOT \
    --identity MANIFEST [--checksum CHECKSUM_FILE] [--result RESULT_FILE]

The identity manifest is deliberately limited to public node identity values:
  android_node_name, android_node_id, android_node_public_key,
  approved_peer_name, approved_peer_id, approved_peer_public_key,
  approved_peer_address

No API keys, cookies, private keys, or raw API responses belong in the
manifest or in the generated result file.
USAGE
}

die() {
    printf '%s: %s\n' "$SCRIPT_NAME" "$1" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

absolute_path() {
    local path="$1"
    if [[ "$path" == /* ]]; then
        printf '%s\n' "$path"
    else
        printf '%s/%s\n' "$PWD" "$path"
    fi
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

validate_manifest() {
    local manifest="$1"
    [[ -f "$manifest" ]] || die "identity manifest does not exist: $manifest"

    local required_key key value
    local -a required_keys=(
        android_node_name
        android_node_id
        android_node_public_key
        approved_peer_name
        approved_peer_id
        approved_peer_public_key
        approved_peer_address
    )

    for required_key in "${required_keys[@]}"; do
        value="$(manifest_value "$manifest" "$required_key" 2>/dev/null || true)"
        [[ -n "$value" ]] ||
            die "identity manifest is missing a value for $required_key"
        [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] ||
            die "identity manifest contains a multiline value for $required_key"
    done

    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        key="${line%%=*}"
        [[ "$line" == *=* ]] || die "identity manifest line is not key=value: $key"
        case "$key" in
            android_node_name|android_node_id|android_node_public_key|\
            approved_peer_name|approved_peer_id|approved_peer_public_key|\
            approved_peer_address)
                ;;
            *)
                die "identity manifest contains an unsupported key: $key"
                ;;
        esac
    done < "$manifest"
}

write_result() {
    local result_file="$1"
    shift
    [[ -z "$result_file" ]] && return 0
    mkdir -p "$(dirname "$result_file")"
    {
        printf 'evidence_schema_version=1\n'
        printf '%s\n' "$@"
    } > "$result_file"
}

create_backup() {
    local source="" output="" identity="" result=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --source) source="${2:-}"; shift 2 ;;
            --output) output="${2:-}"; shift 2 ;;
            --identity) identity="${2:-}"; shift 2 ;;
            --result) result="${2:-}"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown create option: $1" ;;
        esac
    done

    [[ -n "$source" && -n "$output" && -n "$identity" ]] ||
        die "create requires --source, --output, and --identity"
    [[ -d "$source/headscale/lib" ]] ||
        die "missing persistent directory: $source/headscale/lib"
    [[ -d "$source/headplane/data" ]] ||
        die "missing persistent directory: $source/headplane/data"
    [[ -d "$source/caddy/data" ]] ||
        die "missing persistent directory: $source/caddy/data"
    [[ -f "$source/headscale/lib/db.sqlite" ]] ||
        die "Headscale SQLite state is missing: $source/headscale/lib/db.sqlite"
    [[ -f "$source/headscale/lib/noise_private.key" ]] ||
        die "Headscale noise identity is missing: $source/headscale/lib/noise_private.key"
    [[ -f "$source/headscale/lib/derp_server_private.key" ]] ||
        die "embedded DERP identity is missing: $source/headscale/lib/derp_server_private.key"

    validate_manifest "$identity"
    require_command tar
    require_command sha256sum

    local source_abs output_abs identity_abs staging
    source_abs="$(cd "$source" && pwd -P)"
    output_abs="$(absolute_path "$output")"
    identity_abs="$(absolute_path "$identity")"
    [[ "$output_abs" != "$source_abs/"* ]] ||
        die "output archive must not be inside the source bundle"
    mkdir -p "$(dirname "$output_abs")"
    staging="$(mktemp -d)"
    trap 'rm -rf "$staging"' RETURN
    cp "$identity_abs" "$staging/$MANIFEST_NAME"

    tar --create --gzip --file "$output_abs" \
        --directory "$source_abs" \
        headscale/lib headplane/data caddy/data \
        --directory "$staging" "$MANIFEST_NAME"
    sha256sum "$output_abs" > "$output_abs.sha256"

    write_result "$result" \
        "operation=create" \
        "result=PASS" \
        "archive=$(basename "$output_abs")" \
        "archive_sha256=$(awk '{ print \$1 }' "$output_abs.sha256")" \
        "headscale_state=BACKED_UP" \
        "headplane_state=BACKED_UP" \
        "caddy_certificate_data=BACKED_UP" \
        "identity_manifest=INCLUDED"
    printf 'Headscale backup archive created: %s\n' "$output_abs"
}

archive_has_safe_paths() {
    local archive="$1" entry
    while IFS= read -r entry; do
        [[ "$entry" != /* && "$entry" != ../* && "$entry" != */../* && "$entry" != */.. ]] ||
            die "archive contains an unsafe path: $entry"
    done < <(tar --list --file "$archive")
}

restore_check() {
    local archive="" target="" identity="" checksum="" result=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --archive) archive="${2:-}"; shift 2 ;;
            --target) target="${2:-}"; shift 2 ;;
            --identity) identity="${2:-}"; shift 2 ;;
            --checksum) checksum="${2:-}"; shift 2 ;;
            --result) result="${2:-}"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown restore-check option: $1" ;;
        esac
    done

    [[ -n "$archive" && -n "$target" && -n "$identity" ]] ||
        die "restore-check requires --archive, --target, and --identity"
    [[ -f "$archive" ]] || die "backup archive does not exist: $archive"
    [[ ! -e "$target" ]] ||
        die "restore target must not already exist: $target"
    validate_manifest "$identity"
    require_command tar
    require_command sha256sum

    local archive_abs identity_abs checksum_abs target_abs
    archive_abs="$(absolute_path "$archive")"
    identity_abs="$(absolute_path "$identity")"
    target_abs="$(absolute_path "$target")"
    checksum="${checksum:-$archive_abs.sha256}"
    checksum_abs="$(absolute_path "$checksum")"
    [[ -f "$checksum_abs" ]] || die "backup checksum does not exist: $checksum_abs"
    mkdir -p "$target_abs"

    (
        cd "$(dirname "$checksum_abs")"
        sha256sum --check --strict "$(basename "$checksum_abs")"
    ) || die "backup checksum verification failed"
    archive_has_safe_paths "$archive_abs"
    tar --extract --gzip --file "$archive_abs" --directory "$target_abs" --no-same-owner

    [[ -d "$target_abs/headscale/lib" ]] ||
        die "restored Headscale state directory is missing"
    [[ -d "$target_abs/headplane/data" ]] ||
        die "restored Headplane state directory is missing"
    [[ -d "$target_abs/caddy/data" ]] ||
        die "restored Caddy certificate data directory is missing"
    [[ -f "$target_abs/headscale/lib/db.sqlite" ]] ||
        die "restored Headscale SQLite state is missing"
    [[ -f "$target_abs/headscale/lib/noise_private.key" ]] ||
        die "restored Headscale noise identity is missing"
    [[ -f "$target_abs/headscale/lib/derp_server_private.key" ]] ||
        die "restored embedded DERP identity is missing"
    cmp --silent "$identity_abs" "$target_abs/$MANIFEST_NAME" ||
        die "restored identity manifest differs from the pre-replacement manifest"

    write_result "$result" \
        "operation=restore-check" \
        "result=PASS" \
        "archive_sha256=$(awk '{ print \$1 }' "$checksum_abs")" \
        "headscale_state=RESTORED" \
        "headplane_state=RESTORED" \
        "caddy_certificate_data=RESTORED" \
        "android_node_identity=RETAINED_IN_MANIFEST" \
        "approved_peer_identity=RETAINED_IN_MANIFEST" \
        "mesh_proof=REQUIRED_AFTER_STARTUP"
    printf 'Headscale restore archive verified in disposable target: %s\n' "$target_abs"
}

[[ $# -gt 0 ]] || { usage >&2; exit 2; }
command="$1"
shift
case "$command" in
    create) create_backup "$@" ;;
    restore-check) restore_check "$@" ;;
    -h|--help) usage ;;
    *) usage >&2; die "unknown operation: $command" ;;
esac