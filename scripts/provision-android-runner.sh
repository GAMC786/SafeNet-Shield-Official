#!/usr/bin/env bash
set -Eeuo pipefail

# Provision or validate the dedicated Linux runner used by tagged Android
# releases. The GitHub Actions runner itself must be registered separately
# with the android-writable-system label.

readonly DEFAULT_API_LEVEL=35
readonly DEFAULT_AVD_NAME="safenet-writable"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
variables_file="$project_root/android/variables.gradle"
api_level="${ANDROID_EMULATOR_API_LEVEL:-$DEFAULT_API_LEVEL}"
avd_name="${ANDROID_AVD_NAME:-$DEFAULT_AVD_NAME}"
check_only=false

usage() {
    cat <<'EOF'
Usage: scripts/provision-android-runner.sh [--check]

Without --check, install the pinned writable-system emulator image and create
the AVD used by the tagged release smoke lane. With --check, verify that the
runner already has the required host capabilities and Android packages.

Environment:
  ANDROID_SDK_ROOT       Android SDK location (or ANDROID_HOME)
  ANDROID_EMULATOR_API_LEVEL  Emulator API level (default: 35)
  ANDROID_AVD_NAME       AVD name (default: safenet-writable)
EOF
}

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --check)
            check_only=true
            shift
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

[[ "$api_level" =~ ^[0-9]+$ ]] || fail "ANDROID_EMULATOR_API_LEVEL must be numeric."
[[ "$avd_name" =~ ^[A-Za-z0-9_.-]+$ ]] ||
    fail "ANDROID_AVD_NAME contains unsupported characters: $avd_name"
[[ -f "$variables_file" ]] || fail "Android version file was not found: $variables_file"
[[ "$(uname -s)" == "Linux" ]] ||
    fail "The writable Android release runner must be Linux."

build_tools_version="$(sed -nE "s/^[[:space:]]*androidBuildToolsVersion[[:space:]]*=[[:space:]]*'([^']+)'.*$/\1/p" "$variables_file")"
[[ "$build_tools_version" =~ ^[0-9]+([.][0-9]+){2}$ ]] ||
    fail "Could not read androidBuildToolsVersion from $variables_file."

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
[[ -n "$sdk_root" ]] || fail "Set ANDROID_SDK_ROOT (or ANDROID_HOME) on the runner."
[[ -d "$sdk_root" ]] || fail "Android SDK directory does not exist: $sdk_root"

find_sdk_tool() {
    local tool="$1"
    local candidate
    if command -v "$tool" >/dev/null 2>&1; then
        command -v "$tool"
        return 0
    fi
    for candidate in \
        "$sdk_root/cmdline-tools/latest/bin/$tool" \
        "$sdk_root/cmdline-tools/bin/$tool" \
        "$sdk_root/build-tools/$build_tools_version/$tool" \
        "$sdk_root/emulator/$tool" \
        "$sdk_root/platform-tools/$tool"; do
        if [[ -x "$candidate" ]]; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

sdkmanager_bin="$(find_sdk_tool sdkmanager || true)"
avdmanager_bin="$(find_sdk_tool avdmanager || true)"
emulator_bin="$(find_sdk_tool emulator || true)"
adb_bin="$(find_sdk_tool adb || true)"
apksigner_bin="$(find_sdk_tool apksigner || true)"
[[ -n "$sdkmanager_bin" ]] || fail "sdkmanager is not available on the runner."
[[ -n "$avdmanager_bin" ]] || fail "avdmanager is not available on the runner."
[[ -n "$emulator_bin" ]] || fail "emulator is not available on the runner."
[[ -n "$adb_bin" ]] || fail "adb is not available on the runner."
[[ -n "$apksigner_bin" ]] || fail "apksigner is not available on the runner."

[[ -c /dev/kvm ]] || fail "/dev/kvm is required for the writable Android emulator."
[[ -r /dev/kvm && -w /dev/kvm ]] ||
    fail "/dev/kvm must be readable and writable by the GitHub runner account."

if [[ "${EUID}" -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 ||
        fail "sudo is required for the fixture's privileged resolver ports."
    sudo -n true >/dev/null 2>&1 ||
        fail "The runner account needs passwordless sudo for the fixture's resolver ports."
fi

readonly system_image="system-images;android-${api_level};aosp_atd;x86_64"
readonly system_image_dir="$sdk_root/system-images/android-${api_level}/aosp_atd/x86_64"
readonly build_tools_dir="$sdk_root/build-tools/$build_tools_version"
avd_home="${ANDROID_AVD_HOME:-}"
if [[ -z "$avd_home" && -n "${ANDROID_SDK_HOME:-}" ]]; then
    avd_home="$ANDROID_SDK_HOME/.android"
fi
avd_home="${avd_home:-$HOME/.android}"
readonly avd_dir="$avd_home/avd/${avd_name}.avd"

if [[ "$check_only" == true ]]; then
    [[ -d "$system_image_dir" ]] ||
        fail "Required system image is missing: $system_image. Run this script without --check."
    [[ -x "$build_tools_dir/apksigner" ]] ||
        fail "Pinned Android build-tools are missing: $build_tools_version. Run this script without --check."
    [[ -f "$avd_dir/config.ini" ]] ||
        fail "Required AVD is missing: $avd_name. Run this script without --check."
    echo "Writable Android runner is ready: API $api_level, $system_image, AVD $avd_name."
    exit 0
fi

echo "Installing writable Android runner packages in $sdk_root"
if ! (set +o pipefail; yes | "$sdkmanager_bin" --sdk_root="$sdk_root" --licenses >/dev/null); then
    fail "Android SDK licenses could not be accepted."
fi
"$sdkmanager_bin" --sdk_root="$sdk_root" --install \
    "platform-tools" \
    "emulator" \
    "build-tools;$build_tools_version" \
    "$system_image"

mkdir -p "$(dirname "$avd_dir")"
printf 'no\n' | "$avdmanager_bin" create avd \
    --force \
    --name "$avd_name" \
    --package "$system_image" \
    --device pixel_2

cat >> "$avd_dir/config.ini" <<'EOF'
hw.gpu.mode=swiftshader_indirect
hw.keyboard=yes
disk.dataPartition.size=2G
fastboot.forceColdBoot=yes
EOF

[[ -d "$system_image_dir" && -x "$build_tools_dir/apksigner" && -f "$avd_dir/config.ini" ]] ||
    fail "Android runner provisioning did not produce the expected image and AVD."
echo "Provisioned writable Android runner: API $api_level, $system_image, AVD $avd_name."