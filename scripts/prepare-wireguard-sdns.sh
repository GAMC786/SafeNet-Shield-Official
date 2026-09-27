#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
wireguard_dir="$project_root/third_party/wireguard-android"
payload="$script_dir/patches/wireguard-android-sdns.patch.gz.b64"
runtime_patcher="$script_dir/prepare-wireguard-go-runtime.py"
upstream_commit="58789d6372e8948b87f5c47da7e5f2ad570eb531"
patch_sha256="bb328edfb8b750e06177f7e40d70e00b4310f41f074a05225ffb65ff5ee621b6"
go_version="1.26.5"

if [[ "${1:-}" == "--print-go-version" && $# -eq 1 ]]; then
    printf '%s\n' "$go_version"
    exit 0
fi

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

[[ $# -eq 1 && -n "$1" ]] ||
    fail "Usage: prepare-wireguard-sdns.sh <prepared-Go-root>"
[[ -d "$wireguard_dir/.git" || -f "$wireguard_dir/.git" ]] ||
    fail "WireGuard source is missing. Initialize third_party/wireguard-android first."
[[ -f "$payload" ]] || fail "The pinned WireGuard patch payload is missing: $payload"
[[ -f "$runtime_patcher" ]] || fail "The Go runtime patcher is missing: $runtime_patcher"

actual_commit="$(git -C "$wireguard_dir" rev-parse HEAD 2>/dev/null)" ||
    fail "Could not read the WireGuard submodule revision."
[[ "$actual_commit" == "$upstream_commit" ]] ||
    fail "WireGuard must start at upstream commit $upstream_commit; found $actual_commit."

go_env_prefix=()
if [[ -n "${WIREGUARD_GO_ROOT:-}" ]]; then
    [[ -d "$WIREGUARD_GO_ROOT" ]] ||
        fail "The pinned WireGuard Go root does not exist: $WIREGUARD_GO_ROOT"
    wireguard_source_root="$(cd -- "$WIREGUARD_GO_ROOT" && pwd -P)"
    go_bin="$wireguard_source_root/bin/go"
    [[ -x "$go_bin" ]] ||
        fail "The pinned WireGuard Go root is missing bin/go: $wireguard_source_root"
    go_env_prefix=(env "GOROOT=$wireguard_source_root")
else
    go_bin="$(command -v go || true)"
    [[ -n "$go_bin" ]] || fail "Go $go_version is required to build WireGuard."
fi
go_version_output="$("${go_env_prefix[@]}" "$go_bin" version 2>/dev/null || true)"
[[ "$go_version_output" == *"go$go_version "* ]] ||
    fail "WireGuard requires Go $go_version; found ${go_version_output:-no working Go toolchain}."
source_go_root="$("${go_env_prefix[@]}" "$go_bin" env GOROOT)"
[[ -x "$source_go_root/bin/go" ]] ||
    fail "The Go toolchain did not report a usable GOROOT: $source_go_root"
source_go_root="$(cd -- "$source_go_root" && pwd -P)"

go_root="$1"
go_root_parent="$(dirname -- "$go_root")"
mkdir -p "$go_root_parent"
go_root_parent="$(cd -- "$go_root_parent" && pwd -P)"
go_root="$go_root_parent/$(basename -- "$go_root")"
[[ ! -L "$go_root" ]] ||
    fail "The prepared Go root must not be a symlink: $go_root"
[[ "$go_root" != "$source_go_root" ]] ||
    fail "Refusing to patch the installed Go toolchain in place."

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/prepare-wireguard-sdns.XXXXXX")"
staging_parent=""
cleanup() {
    if [[ -n "$staging_parent" && -d "$staging_parent" ]]; then
        chmod -R u+w "$staging_parent" 2>/dev/null || true
        rm -rf "$staging_parent"
    fi
    rm -rf "$temp_dir"
}
trap cleanup EXIT
patch_file="$temp_dir/wireguard-android-sdns.patch"

python3 - "$payload" "$patch_file" "$patch_sha256" <<'PY'
import base64
import gzip
import hashlib
import sys
from pathlib import Path

payload_path, patch_path, expected_sha256 = sys.argv[1:]
try:
    encoded = "".join(Path(payload_path).read_text(encoding="ascii").split())
    patch = gzip.decompress(base64.b64decode(encoded, validate=True))
except Exception as exc:
    raise SystemExit(f"ERROR: Could not decode the pinned WireGuard patch: {exc}")

actual_sha256 = hashlib.sha256(patch).hexdigest()
if actual_sha256 != expected_sha256:
    raise SystemExit(
        "ERROR: WireGuard patch checksum mismatch: "
        f"expected {expected_sha256}, found {actual_sha256}."
    )
Path(patch_path).write_bytes(patch)
PY

if git -C "$wireguard_dir" apply --check "$patch_file" >/dev/null 2>&1; then
    git -C "$wireguard_dir" apply "$patch_file"
elif ! git -C "$wireguard_dir" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
    fail "The WireGuard source differs from both the pinned upstream and the expected SafeNet patch."
fi

git -C "$wireguard_dir" diff --binary "$upstream_commit" > "$temp_dir/current.patch"
cmp -s "$patch_file" "$temp_dir/current.patch" ||
    fail "Unexpected edits are present in the WireGuard submodule; refusing to build from an unreviewed source tree."

if [[ -e "$go_root" && ! -x "$go_root/bin/go" ]]; then
    if [[ -d "$go_root" ]] &&
        [[ -z "$(find "$go_root" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
        rmdir "$go_root" ||
            fail "Could not clear the empty prepared Go cache directory: $go_root"
    else
        fail "The prepared Go cache exists but has no bin/go: $go_root"
    fi
fi

if [[ -e "$go_root" ]]; then
    [[ -x "$go_root/bin/go" ]] ||
        fail "The prepared Go cache exists but has no bin/go: $go_root"
    existing_go_version="$("$go_root/bin/go" version 2>/dev/null || true)"
    [[ "$existing_go_version" == *"go$go_version "* ]] ||
        fail "The prepared Go cache must use Go $go_version; found ${existing_go_version:-no working Go toolchain}."
    python3 "$runtime_patcher" "$go_root"
else
    staging_parent="$(mktemp -d "$go_root_parent/.wireguard-go.XXXXXX")"
    staging_root="$staging_parent/go-root"
    mkdir -p "$staging_root"
    cp -a "$source_go_root/." "$staging_root/"
    chmod -R u+w "$staging_root"
    python3 "$runtime_patcher" "$staging_root"
    mv "$staging_root" "$go_root"
    rmdir "$staging_parent"
    staging_parent=""
fi

[[ -f "$go_root/.safenet-boottime-patch" ]] ||
    fail "The prepared Go runtime is missing SafeNet's CLOCK_BOOTTIME marker."
echo "WireGuard SDNS source and Go $go_version runtime are prepared."