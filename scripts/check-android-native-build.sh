#!/usr/bin/env bash
set -Eeuo pipefail

# Compile the Android sources used by the release lane. Keep this check
# independent from device access so Java/API compatibility fails before smoke
# tests are attempted.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
android_dir="$project_root/android"
build_mode="debug"
skip_release_signing=false
max_diagnostics_bytes=16000

usage() {
    cat >&2 <<'EOF'
Usage: check-android-native-build.sh [--release-instrumentation|--signed-release-instrumentation]
EOF
}

while (($# > 0)); do
    case "$1" in
        --release-instrumentation)
            build_mode="release-instrumentation"
            skip_release_signing=true
            ;;
        --signed-release-instrumentation)
            build_mode="release-instrumentation"
            # The signed application APK has already passed verifyReleaseSigning
            # before the instrumentation APK is assembled.
            skip_release_signing=true
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            usage
            exit 2
            ;;
    esac
    shift
done

output_dir="${ANDROID_NATIVE_BUILD_OUTPUT_DIR:-$android_dir/app/build/reports/android-native-build}"
diagnostics_work_dir="${RUNNER_TEMP:-$output_dir}"
gradle_log="$diagnostics_work_dir/android-native-build-${build_mode}.log"

fail() {
    local message="$1"
    local exit_status="${2:-1}"
    echo "ERROR: $message" >&2
    mkdir -p "$output_dir"
    printf 'ANDROID_NATIVE_BUILD_FAILURE\n' > "$output_dir/failure-category.txt"
    {
        printf 'failure_class=BUILD\n'
        printf 'failure_category=ANDROID_NATIVE_BUILD_FAILURE\n'
        printf 'build_mode=%s\n' "$build_mode"
        printf 'exit_status=%s\n' "$exit_status"
        printf 'message=%s\n' "$message"
    } > "$output_dir/result.txt"
    if [[ -f "$gradle_log" ]]; then
        tail -c "$max_diagnostics_bytes" "$gradle_log" > "$output_dir/diagnostics.log" || true
    fi
    exit "$exit_status"
}

[[ -d "$android_dir" ]] || fail "Android project directory was not found: $android_dir"

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk_root" && -f "$android_dir/local.properties" ]]; then
    sdk_root="$(sed -nE 's/^[[:space:]]*sdk\.dir[[:space:]]*=[[:space:]]*//p' \
        "$android_dir/local.properties" | head -n1)"
    sdk_root="${sdk_root//\\:/\:}"
fi

[[ -n "$sdk_root" ]] ||
    fail "Android SDK location is not configured. Set ANDROID_SDK_ROOT (or ANDROID_HOME), then run npm run android:setup." 1
[[ -d "$sdk_root" ]] ||
    fail "Android SDK directory does not exist: $sdk_root" 1

# Export both names because Gradle and Android tooling use different
# conventions across local shells and hosted runners.
export ANDROID_SDK_ROOT="$sdk_root"
export ANDROID_HOME="$sdk_root"

mkdir -p "$output_dir" "$diagnostics_work_dir"
echo "Compiling Android $build_mode sources with the pinned SDK at $sdk_root"
cd "$android_dir"

gradle_args=(--no-daemon)
if [[ "$build_mode" == "debug" ]]; then
    gradle_args+=(assembleDebug --rerun-tasks)
else
    gradle_args+=(:app:assembleReleaseAndroidTest)
    if [[ "$skip_release_signing" == true ]]; then
        gradle_args+=(-x verifyReleaseSigning)
    fi
    gradle_args+=(--rerun-tasks)
fi

set +e
./gradlew "${gradle_args[@]}" 2>&1 | tee "$gradle_log"
gradle_status="${PIPESTATUS[0]}"
set -e

if [[ "$gradle_status" -ne 0 ]]; then
    fail \
        "Android $build_mode compilation failed with Gradle exit status $gradle_status. Bounded diagnostics were written to $output_dir/diagnostics.log." \
        "$gradle_status"
fi

printf 'ANDROID_NATIVE_BUILD_PASS\n' > "$output_dir/failure-category.txt"
{
    printf 'failure_class=NONE\n'
    printf 'failure_category=PASS\n'
    printf 'build_mode=%s\n' "$build_mode"
    printf 'exit_status=0\n'
} > "$output_dir/result.txt"
tail -c "$max_diagnostics_bytes" "$gradle_log" > "$output_dir/diagnostics.log" || true
echo "Android $build_mode compilation passed."