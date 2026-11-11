#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
source_dir="$project_root/third_party/tailscale-android"
expected_revision="803d93860da0652d501298883fcc61c70973290b"
expected_patch_sha256="f8529aa7b881be4463d29128709eceda7cc60b1a43e427540c0877244b9447ce"
ndk_version="23.1.7779620"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

[[ -d "$source_dir" ]] ||
    fail "Tailscale Android source is missing. Initialize the pinned third_party/tailscale-android submodule."

if [[ -d "$source_dir/.git" || -f "$source_dir/.git" ]]; then
    actual_revision="$(git -C "$source_dir" rev-parse HEAD)"
    [[ "$actual_revision" == "$expected_revision" ]] ||
        fail "Tailscale Android source revision mismatch: expected $expected_revision, found $actual_revision."
else
    indexed_revision="$(git -C "$project_root" ls-tree HEAD third_party/tailscale-android | awk '{print $3}')"
    [[ "$indexed_revision" == "$expected_revision" ]] ||
        fail "Workspace does not pin the expected Tailscale Android source revision."
fi

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
[[ -n "$sdk_root" && -d "$sdk_root" ]] ||
    fail "Android SDK is not configured. Set ANDROID_SDK_ROOT and run npm run android:setup."

ndk_root="$sdk_root/ndk/$ndk_version"
[[ -d "$ndk_root" ]] ||
    fail "Pinned Android NDK $ndk_version is missing from $sdk_root. Run npm run android:setup."

command -v make >/dev/null 2>&1 || fail "GNU make is required to build the Tailscale Android engine."
command -v go >/dev/null 2>&1 || fail "Go is required to build the Tailscale Android engine."

temporary_dir="$(mktemp -d)"
bridge_dir="$source_dir/libtailscale/safenetvpn"
bridge_dir_created=0
restore_build_inputs() {
    for file in go.mod go.sum Makefile tailscale.version; do
        [[ -f "$temporary_dir/original-$file" ]] &&
            cp -p "$temporary_dir/original-$file" "$source_dir/$file"
    done
    if [[ "$bridge_dir_created" == "1" ]]; then
        rm -rf "$bridge_dir"
    fi
    rm -rf "$temporary_dir"
}
trap restore_build_inputs EXIT
patch_template="$temporary_dir/tailscale-android.patch.template"
patch_file="$temporary_dir/tailscale-android.patch"
: > "$patch_template"
for part in 01 02 03 04; do
    part_file="$script_dir/patches/tailscale-android-dns-filter-$part.patch"
    [[ -s "$part_file" ]] || fail "Tailscale firewall patch part $part is missing."
    cat "$part_file" >> "$patch_template"
    printf '\n' >> "$patch_template"
done
actual_patch_sha256="$(sha256sum "$patch_template" | awk '{print $1}')"
[[ "$actual_patch_sha256" == "$expected_patch_sha256" ]] ||
    fail "Tailscale firewall patch checksum mismatch: expected $expected_patch_sha256, found $actual_patch_sha256."
tab="$(printf '\t')"
sed "s/__TAB__/$tab/g" "$patch_template" > "$patch_file"
if grep -q '__TAB__' "$patch_file"; then
    fail "Tailscale firewall patch contains an unresolved tab marker."
fi
if git -C "$source_dir" apply --unidiff-zero --reverse --check "$patch_file" >/dev/null 2>&1; then
    echo "Tailscale firewall patch is already applied."
else
    git -C "$source_dir" apply --unidiff-zero --check "$patch_file" ||
        fail "Tailscale firewall patch does not apply cleanly to pinned revision $expected_revision."
    git -C "$source_dir" apply --unidiff-zero "$patch_file" ||
        fail "Could not apply the Tailscale firewall patch."
fi

for file in go.mod go.sum Makefile tailscale.version; do
    cp -p "$source_dir/$file" "$temporary_dir/original-$file"
done
[[ ! -e "$bridge_dir" ]] || fail "Unexpected existing SafeNet bridge source directory: $bridge_dir"
mkdir -p "$bridge_dir"
cp "$project_root/third_party/netvalve/netstack/bridge.go" \
    "$project_root/third_party/netvalve/netstack/conn.go" \
    "$project_root/third_party/netvalve/netstack/dnscrypt.go" "$bridge_dir/"
bridge_dir_created=1
(
    cd "$source_dir"
    gvisor_version="$(cd "$project_root/third_party/netvalve/netstack" &&
        go list -mod=readonly -m -f '{{.Version}}' github.com/sagernet/gvisor)"
    ./tool/go mod edit -require="github.com/sagernet/gvisor@$gvisor_version"
    ./tool/go mod edit -require="github.com/ameshkov/dnscrypt/v2@v2.4.0"
    ./tool/go mod tidy
    python3 - <<'PY'
from pathlib import Path
path = Path("Makefile")
text = path.read_text()
old = "-o $(ABS_UNSTRIPPED_AAR) ./libtailscale ||"
new = "-o $(ABS_UNSTRIPPED_AAR) ./libtailscale ./libtailscale/safenetvpn ||"
if old not in text:
    raise SystemExit("Tailscale gomobile bind command changed unexpectedly")
path.write_text(text.replace(old, new, 1))
PY
    touch tailscale.version
)

export ANDROID_SDK_ROOT="$sdk_root"
export ANDROID_HOME="$sdk_root"
export ANDROID_NDK_HOME="$ndk_root"
export NDK_ROOT="$ndk_root"

echo "Building Tailscale Android engine from pinned revision $expected_revision"
# The submodule Makefile derives the custom Go wrapper path from PWD.
# Enter it first so gomobile uses Tailscale's runtime fork, not host Go.
(
    cd "$source_dir"
    if [[ "$(uname -s)" == "Linux" ]]; then
        # gomobile detects Apple SDK support by probing xcrun. Some Linux
        # environments provide an xcrun shim that falsely reports Xcode as
        # available, then fails while resolving the iPhone SDK. This build
        # only targets Android, so make that Apple-toolchain probe fail closed.
        # Cross-ABI Go compilation can also exceed Linux /tmp quotas, so keep
        # temporary compiler output on the runner or workspace volume.
        android_work_temp="${RUNNER_TEMP:-$project_root/.tmp-android}"
        mkdir -p "$android_work_temp"
        no_apple_tools_dir="$temporary_dir/no-apple-tools"
        mkdir -p "$no_apple_tools_dir"
        cat > "$no_apple_tools_dir/xcrun" <<'EOF'
#!/usr/bin/env sh
exit 127
EOF
        chmod +x "$no_apple_tools_dir/xcrun"
        TMPDIR="$android_work_temp" GOTMPDIR="$android_work_temp" \
            PATH="$no_apple_tools_dir:$PATH" make libtailscale
    else
        make libtailscale
    fi
)
[[ -s "$source_dir/android/libs/libtailscale.aar" ]] ||
    fail "Tailscale Android build completed without producing libtailscale.aar."