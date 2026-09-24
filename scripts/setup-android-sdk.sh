#!/usr/bin/env bash
set -euo pipefail

# Install and verify the Android SDK packages required by the Gradle project.
# Keep the versions in android/variables.gradle; this script intentionally
# reads them instead of maintaining a second set of pins.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
variables_file="$project_root/android/variables.gradle"
setup_output_dir="${ANDROID_SDK_SETUP_OUTPUT_DIR:-$project_root/android/app/build/reports/android-sdk-setup}"
readonly max_install_attempts=3
readonly retry_delay_seconds=10
readonly max_diagnostics_bytes=16000
diagnostics_work_dir="${RUNNER_TEMP:-$setup_output_dir}"

fail() {
    local message="$1"
    local reason="${2:-SDK_CONFIGURATION}"
    local diagnostics_file="${3:-}"
    local attempts="${4:-0}"
    local exit_status="${5:-1}"
    echo "ERROR: $message" >&2
    if mkdir -p "$setup_output_dir" 2>/dev/null; then
        printf 'ANDROID_SDK_SETUP_FAILURE\n' > "$setup_output_dir/failure-category.txt"
        {
            printf 'failure_class=INFRASTRUCTURE\n'
            printf 'failure_category=ANDROID_SDK_SETUP_FAILURE\n'
            printf 'failure_stage=pinned-sdk-install\n'
            printf 'failure_reason=%s\n' "$reason"
            printf 'attempts=%s\n' "$attempts"
            printf 'exit_status=%s\n' "$exit_status"
            printf 'message=%s\n' "$message"
        } > "$setup_output_dir/result.txt"
        if [[ -n "$diagnostics_file" && -f "$diagnostics_file" ]]; then
            tail -c "$max_diagnostics_bytes" "$diagnostics_file" > "$setup_output_dir/diagnostics.log" || true
        fi
    fi
    exit "$exit_status"
}

classify_install_failure() {
    local diagnostics_file="$1"

    if grep -Eiq '(failed to find package|package[^[:cntrl:]]*(not available|does not exist|not found)|packages[^[:cntrl:]]*not available|not a valid package)' "$diagnostics_file"; then
        printf 'PACKAGE_UNAVAILABLE\n'
        return
    fi

    # Retry only failures that indicate a temporary repository or download
    # problem. Do not broaden this list to generic sdkmanager failures: a
    # missing pinned package must remain an immediate, actionable blocker.
    if grep -Eiq '(failed to download|unable to download|download[^[:cntrl:]]*(failed|timed out)|timed out|connection (reset|closed|refused)|temporary failure in name resolution|unknown host|http[^[:digit:]]*(408|429|500|502|503|504)|status code[^[:digit:]]*(408|429|5[0-9]{2}))' "$diagnostics_file"; then
        printf 'TRANSIENT_REPOSITORY_OR_DOWNLOAD\n'
    else
        printf 'SDKMANAGER_INSTALL_FAILURE\n'
    fi
}

record_attempt_diagnostics() {
    local source_file="$1"
    local attempt="$2"
    local destination="$setup_output_dir/attempt-${attempt}.log"

    if mkdir -p "$setup_output_dir" 2>/dev/null; then
        tail -c "$max_diagnostics_bytes" "$source_file" > "$destination" || true
    fi
}

run_sdkmanager_install() {
    local output_file="$1"
    shift

    set +e
    "$sdkmanager_bin" "$@" 2>&1 | tee "$output_file"
    local sdkmanager_status="${PIPESTATUS[0]}"
    set -e
    return "$sdkmanager_status"
}

[[ -f "$variables_file" ]] || fail "Android version file was not found: $variables_file"

compile_sdk_version="$(sed -nE 's/^[[:space:]]*compileSdkVersion[[:space:]]*=[[:space:]]*([0-9]+).*$/\1/p' "$variables_file")"
target_sdk_version="$(sed -nE 's/^[[:space:]]*targetSdkVersion[[:space:]]*=[[:space:]]*([0-9]+).*$/\1/p' "$variables_file")"
build_tools_version="$(sed -nE "s/^[[:space:]]*androidBuildToolsVersion[[:space:]]*=[[:space:]]*'([^']+)'.*$/\1/p" "$variables_file")"
tailscale_ndk_version="23.1.7779620"

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
    "ndk;$tailscale_ndk_version"
)
if [[ "$target_sdk_version" != "$compile_sdk_version" ]]; then
    packages+=("platforms;android-$target_sdk_version")
fi

echo "Preparing Android SDK at $sdk_root"
echo "Required packages: ${packages[*]}"

if ! (set +o pipefail; yes | "$sdkmanager_bin" --sdk_root="$sdk_root" --licenses >/dev/null); then
    fail \
        "Android SDK licenses could not be accepted. Run sdkmanager --licenses and try again." \
        "LICENSE_CONFIGURATION"
fi

mkdir -p "$diagnostics_work_dir"
last_install_log=""
last_install_status=1
last_install_reason="SDKMANAGER_INSTALL_FAILURE"
last_install_attempt=0
install_succeeded=false

for ((attempt = 1; attempt <= max_install_attempts; attempt += 1)); do
    attempt_output="$diagnostics_work_dir/android-sdk-install-attempt-${attempt}.log"
    echo "Installing required Android SDK packages (attempt ${attempt}/${max_install_attempts})."

    if run_sdkmanager_install \
        "$attempt_output" \
        --sdk_root="$sdk_root" \
        --install \
        "${packages[@]}"; then
        install_succeeded=true
        last_install_log="$attempt_output"
        last_install_attempt="$attempt"
        break
    else
        last_install_status="$?"
        last_install_log="$attempt_output"
        last_install_attempt="$attempt"
        last_install_reason="$(classify_install_failure "$attempt_output")"
        record_attempt_diagnostics "$attempt_output" "$attempt"

        if [[ "$last_install_reason" != "TRANSIENT_REPOSITORY_OR_DOWNLOAD" ]]; then
            fail \
                "Could not install the required Android SDK package(s): ${packages[*]}. sdkmanager reported a ${last_install_reason} failure; check the pinned package names and SDK repository configuration." \
                "$last_install_reason" \
                "$last_install_log" \
                "$attempt" \
                "$last_install_status"
        fi

        if (( attempt < max_install_attempts )); then
            echo "::warning::Android SDK package installation hit a transient repository/download failure on attempt ${attempt}/${max_install_attempts}; retrying in ${retry_delay_seconds}s." >&2
            sleep "$retry_delay_seconds"
        fi
    fi
done

if [[ "$install_succeeded" != true ]]; then
    fail \
        "Could not install the required Android SDK package(s) after ${max_install_attempts} attempts. sdkmanager reported a ${last_install_reason} failure; check repository availability and the bounded attempt diagnostics." \
        "$last_install_reason" \
        "$last_install_log" \
        "$last_install_attempt" \
        "$last_install_status"
fi

missing_packages=()
for package_path in \
    "platform-tools" \
    "platforms/android-$compile_sdk_version" \
    "build-tools/$build_tools_version" \
    "ndk/$tailscale_ndk_version"; do
    [[ -d "$sdk_root/$package_path" ]] || missing_packages+=("$package_path")
done
if [[ "$target_sdk_version" != "$compile_sdk_version" &&
    ! -d "$sdk_root/platforms/android-$target_sdk_version" ]]; then
    missing_packages+=("platforms/android-$target_sdk_version")
fi

if (( ${#missing_packages[@]} > 0 )); then
    fail \
        "Required Android SDK package(s) are unavailable after installation: ${missing_packages[*]}. Check the SDK channel and Android SDK repository access." \
        "PACKAGE_UNAVAILABLE" \
        "$last_install_log" \
        "$last_install_attempt" \
        "$last_install_status"
fi

echo "Android SDK is ready for compile SDK $compile_sdk_version, target SDK $target_sdk_version, build-tools $build_tools_version, and NDK $tailscale_ndk_version."