#!/usr/bin/env bash

# Resolve the Android release metadata used by both release workflows.
#
# Contract:
#   - Run from the repository root.
#   - Read the first quoted versionName and the first decimal versionCode from
#     android/app/build.gradle.
#   - Fail with a shared error if either value cannot be resolved.
#   - When --expected-version is provided, compare it with versionName and
#     fail with the configured mismatch prefix when they differ.
#   - With --output FILE, append version_name, version_code, and the
#     compatibility version alias to FILE (normally GITHUB_OUTPUT). Without
#     --output, print those records to stdout.
#
# The version alias is kept because the standalone APK workflow has published
# artifact names based on its existing `version` step output.

set -euo pipefail

expected_version=""
expected_label=""
mismatch_prefix="Android release version mismatch"
output_file=""

usage() {
    cat >&2 <<'USAGE'
Usage: scripts/resolve-android-release-metadata.sh [options]

Options:
  --expected-version VERSION   Require versionName to match VERSION.
  --expected-label LABEL       Label VERSION in mismatch errors.
  --mismatch-prefix PREFIX     Prefix for expected-version mismatch errors.
  --output FILE                Append GitHub output records to FILE.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --expected-version)
            [[ $# -ge 2 ]] || {
                echo "ERROR: --expected-version requires a value." >&2
                usage
                exit 2
            }
            expected_version="$2"
            shift 2
            ;;
        --expected-label)
            [[ $# -ge 2 ]] || {
                echo "ERROR: --expected-label requires a value." >&2
                usage
                exit 2
            }
            expected_label="$2"
            shift 2
            ;;
        --mismatch-prefix)
            [[ $# -ge 2 ]] || {
                echo "ERROR: --mismatch-prefix requires a value." >&2
                usage
                exit 2
            }
            mismatch_prefix="$2"
            shift 2
            ;;
        --output)
            [[ $# -ge 2 ]] || {
                echo "ERROR: --output requires a path." >&2
                usage
                exit 2
            }
            output_file="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: Unknown option: $1" >&2
            usage
            exit 2
            ;;
    esac
done

if [[ -n "$expected_version" && -z "$expected_label" ]]; then
    expected_label="expected version"
fi

android_gradle_file="android/app/build.gradle"
if [[ ! -f "$android_gradle_file" ]]; then
    echo 'Could not resolve versionName and versionCode from android/app/build.gradle.' >&2
    exit 1
fi

android_version_name="$(
    sed -nE 's/^[[:space:]]*versionName[[:space:]]+"([^"]+)".*$/\1/p' \
        "$android_gradle_file" |
        head -n 1
)"
android_version_code="$(
    sed -nE 's/^[[:space:]]*versionCode[[:space:]]+([0-9]+).*$/\1/p' \
        "$android_gradle_file" |
        head -n 1
)"

if [[ -z "$android_version_name" || -z "$android_version_code" ]]; then
    echo 'Could not resolve versionName and versionCode from android/app/build.gradle.' >&2
    exit 1
fi

if [[ -n "$expected_version" && "$expected_version" != "$android_version_name" ]]; then
    echo "$mismatch_prefix: $expected_label=$expected_version, android/app/build.gradle=$android_version_name" >&2
    exit 1
fi

output_records=$(
    cat <<EOF
version_name=$android_version_name
version_code=$android_version_code
version=$android_version_name
EOF
)

if [[ -n "$output_file" ]]; then
    printf '%s\n' "$output_records" >> "$output_file"
else
    printf '%s\n' "$output_records"
fi

echo "Verified Android release metadata: versionName $android_version_name (versionCode $android_version_code)" >&2
