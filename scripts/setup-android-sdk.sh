#!/usr/bin/env bash
set -euo pipefail

# Install and verify the Android SDK packages required by the Gradle project.
# Keep the versions in android/variables.gradle; this script intentionally
# reads them instead of maintaining a second set of pins.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
variables_file="$project_root/android/variables.gradle"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

[[ -f "$variables_file" ]] || fail "Android version file was not found: $variables_file"

compile_sdk_version="$(sed -nE 's/^[[:space:]]*compileSdkVersion[[:space:]]*=[[:space:]]*([0-9]+).*$/\1/p' "$variables_file")"
target_sdk_version="$(sed -nE 's/^[[:space:]]*targetSdkVersion[[:space:]]*=[[:space:]]*([0-9]+).*$/\1/p' "$variables_file")"
build_tools_version="$(sed -nE "s/^[[:space:]]*androidBuildToolsVersion[[:space:]]*=[[:space:]]*'([^']+)'.*$/\1/p" "$variables_file")"

[[ "$compile_sdk_version" =~ ^[0-9]+$ ]] ||
    fail "Could not read a single compileSdkVersion from $variables_file."
[[ "$target_sdk_version" =~ ^[0-9]+$ ]] ||
    fail "Could not read a single targetSdkVersion from $variables_file."
[[ "$build_tools_version" =~ ^[0-9]+([.][0-9]+){2}$ ]] ||
    fail "Could not read a single androidBuildToolsVersion from $variables_file."

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk_root" && -f "$project_root/android/local.properties" ]]; then
    sdk_root="$(sed -nE 's/^[[:space:]]*sdk\.dir[[:space:]]*=[[:space:]]*//p' \
        "$project_root/android/local.properties" | head -n1)"
    sdk_root="${sdk_root//\\:/\:}"
fi
[[ -n "$sdk_root" ]] ||
    fail "Android SDK location is not configured. Set ANDROID_SDK_ROOT (or ANDROID_HOME), or add sdk.dir to android/local.properties."
[[ -d "$sdk_root" ]] ||
    fail "Android SDK directory does not exist: $sdk_root"

sdkmanager_bin="${SDKMANAGER:-}"
if [[ -z "$sdkmanager_bin" ]]; then
    sdkmanager_bin="$(command -v sdkmanager || true)"
fi
if [[ -z "$sdkmanager_bin" ]]; then
    for candidate in \
        "$sdk_root/cmdline-tools/latest/bin/sdkmanager" \
        "$sdk_root/cmdline-tools/bin/sdkmanager" \
        "$sdk_root/tools/bin/sdkmanager"; do
        if [[ -x "$candidate" ]]; then
            sdkmanager_bin="$candidate"
            break
        fi
    done
fi
[[ -n "$sdkmanager_bin" && -x "$sdkmanager_bin" ]] ||
    fail "sdkmanager was not found. Install the Android SDK Command-line Tools and put sdkmanager on PATH."

packages=(
    "platform-tools"
    "platforms;android-$compile_sdk_version"
    "build-tools;$build_tools_version"
)
if [[ "$target_sdk_version" != "$compile_sdk_version" ]]; then
    packages+=("platforms;android-$target_sdk_version")
fi

echo "Preparing Android SDK at $sdk_root"
echo "Required packages: ${packages[*]}"

if ! (set +o pipefail; yes | "$sdkmanager_bin" --sdk_root="$sdk_root" --licenses >/dev/null); then
    fail "Android SDK licenses could not be accepted. Run sdkmanager --licenses and try again."
fi

if ! "$sdkmanager_bin" --sdk_root="$sdk_root" --install "${packages[@]}"; then
    fail "Could not install the required Android SDK package(s): ${packages[*]}. Check that these pinned packages are available for this SDK."
fi

missing_packages=()
for package_path in \
    "platform-tools" \
    "platforms/android-$compile_sdk_version" \
    "build-tools/$build_tools_version"; do
    [[ -d "$sdk_root/$package_path" ]] || missing_packages+=("$package_path")
done
if [[ "$target_sdk_version" != "$compile_sdk_version" &&
    ! -d "$sdk_root/platforms/android-$target_sdk_version" ]]; then
    missing_packages+=("platforms/android-$target_sdk_version")
fi

if (( ${#missing_packages[@]} > 0 )); then
    fail "Required Android SDK package(s) are unavailable after installation: ${missing_packages[*]}. Check the SDK channel and Android SDK repository access."
fi

echo "Android SDK is ready for compile SDK $compile_sdk_version, target SDK $target_sdk_version, and build-tools $build_tools_version."