#!/usr/bin/env bash

# Verify the assets users download from a published GitHub Release.
#
# The release job validates build outputs before upload. This verifier performs
# the second, independent check against the formal release assets so an upload
# mix-up or post-upload corruption cannot go unnoticed.

set -Eeuo pipefail

assets_dir=""
expected_version=""
expected_version_code=""
sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
verification_failure=""

usage() {
    cat >&2 <<'USAGE'
Usage: scripts/verify-android-release-assets.sh [options]

Options:
  --assets-dir DIR             Directory containing downloaded release assets.
  --expected-version VERSION   Expected Android versionName.
  --expected-version-code CODE Expected Android versionCode.
  --sdk-root DIR               Android SDK root containing build-tools.
  --help                       Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --assets-dir)
            [[ $# -ge 2 ]] || { echo "ERROR: --assets-dir requires a path." >&2; usage; exit 2; }
            assets_dir="$2"
            shift 2
            ;;
        --expected-version)
            [[ $# -ge 2 ]] || { echo "ERROR: --expected-version requires a value." >&2; usage; exit 2; }
            expected_version="$2"
            shift 2
            ;;
        --expected-version-code)
            [[ $# -ge 2 ]] || { echo "ERROR: --expected-version-code requires a value." >&2; usage; exit 2; }
            expected_version_code="$2"
            shift 2
            ;;
        --sdk-root)
            [[ $# -ge 2 ]] || { echo "ERROR: --sdk-root requires a path." >&2; usage; exit 2; }
            sdk_root="$2"
            shift 2
            ;;
        --help|-h)
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

if [[ -z "$assets_dir" || -z "$expected_version" || -z "$expected_version_code" ]]; then
    echo "ERROR: --assets-dir, --expected-version, and --expected-version-code are required." >&2
    usage
    exit 2
fi

summary_file="${GITHUB_STEP_SUMMARY:-}"

write_summary() {
    local exit_status="$?"
    if [[ -n "$summary_file" ]]; then
        {
            echo "## Published Android release asset verification"
            echo
            if [[ "$exit_status" -eq 0 ]]; then
                echo "- **Status:** passed"
            else
                echo "- **Status:** failed"
            fi
            echo "- **Expected versionName:** \`$expected_version\`"
            echo "- **Expected versionCode:** \`$expected_version_code\`"
            echo "- **Expected application package:** \`com.safenet.dns\`"
            echo "- **Assets checked:** signed app APK, signed instrumentation APK, three checksum files, smoke evidence archive, and smoke result"
            if [[ -n "$verification_failure" ]]; then
                echo "- **Failure:** $verification_failure"
            fi
        } >> "$summary_file" || true
    fi
    return "$exit_status"
}

trap write_summary EXIT

fail() {
    verification_failure="$1"
    echo "::error title=Published Android release verification failed::$1" >&2
    exit 1
}

require_file() {
    local file="$1"
    local description="$2"
    [[ -s "$file" ]] || fail "$description is missing or empty: $file"
}

apk="$assets_dir/app-release.apk"
test_apk="$assets_dir/app-release-androidTest.apk"
apk_checksum="$assets_dir/app-release.apk.sha256"
test_apk_checksum="$assets_dir/app-release-androidTest.apk.sha256"
smoke_archive="$assets_dir/SafeNet-DNS-Android-smoke-evidence.tar.gz"
smoke_result="$assets_dir/SafeNet-DNS-Android-smoke-result.txt"
smoke_checksum="$assets_dir/SafeNet-DNS-Android-smoke-evidence.sha256"

require_file "$apk" "Signed application APK"
require_file "$test_apk" "Signed instrumentation APK"
require_file "$apk_checksum" "Application APK checksum"
require_file "$test_apk_checksum" "Instrumentation APK checksum"
require_file "$smoke_archive" "Smoke evidence archive"
require_file "$smoke_result" "Smoke result asset"
require_file "$smoke_checksum" "Smoke evidence checksum"

verify_checksum_file() {
    local checksum_file="$1"
    shift
    local line=""
    local line_count=0
    local hash=""
    local name=""
    local expected=""
    local found=false
    local -a checksum_lines=()

    mapfile -t checksum_lines < "$checksum_file"
    for line in "${checksum_lines[@]}"; do
        [[ "$line" =~ ^([[:xdigit:]]{64})[[:space:]]{2}(.+)$ ]] ||
            fail "Malformed checksum entry in $(basename "$checksum_file"): $line"
        hash="${BASH_REMATCH[1]}"
        name="${BASH_REMATCH[2]}"
        [[ "$hash" =~ ^[[:xdigit:]]{64}$ ]] || fail "Invalid SHA-256 digest in $(basename "$checksum_file")"
        found=false
        for expected in "$@"; do
            if [[ "$name" == "$expected" ]]; then
                found=true
                break
            fi
        done
        [[ "$found" == true ]] ||
            fail "Unexpected file in $(basename "$checksum_file"): $name"
        line_count=$((line_count + 1))
    done

    [[ "$line_count" -eq "$#" ]] ||
        fail "Checksum file $(basename "$checksum_file") must contain exactly $(( $# )) entries; found $line_count"

    (
        cd "$(dirname "$checksum_file")"
        sha256sum --check --strict "$(basename "$checksum_file")"
    ) || fail "Checksum verification failed for $(basename "$checksum_file")"
}

verify_checksum_file "$apk_checksum" "app-release.apk"
verify_checksum_file "$test_apk_checksum" "app-release-androidTest.apk"
verify_checksum_file \
    "$smoke_checksum" \
    "SafeNet-DNS-Android-smoke-evidence.tar.gz" \
    "SafeNet-DNS-Android-smoke-result.txt"

[[ -d "$sdk_root/build-tools" ]] ||
    fail "Android SDK build-tools directory is unavailable: ${sdk_root:-unset}"
apksigner="$(find "$sdk_root/build-tools" -type f -name apksigner -perm -u+x | sort -V | tail -n 1)"
aapt="$(find "$sdk_root/build-tools" -type f -name aapt -perm -u+x | sort -V | tail -n 1)"
[[ -n "$apksigner" ]] || fail "Android apksigner was not found under $sdk_root/build-tools"
[[ -n "$aapt" ]] || fail "Android aapt was not found under $sdk_root/build-tools"

"$apksigner" verify --verbose "$apk" ||
    fail "Signed application APK signature verification failed."
"$apksigner" verify --verbose "$test_apk" ||
    fail "Signed instrumentation APK signature verification failed."

require_badging() {
    local artifact="$1"
    local expected="$2"
    local description="$3"
    local badging
    badging="$("$aapt" dump badging "$artifact")" ||
        fail "Could not read $description metadata."
    if ! grep -Fq "$expected" <<< "$badging"; then
        echo "Actual badging for $artifact:" >&2
        printf '%s\n' "$badging" >&2
        fail "$description metadata mismatch. Expected: $expected"
    fi
}

require_badging \
    "$apk" \
    "package: name='com.safenet.dns' versionCode='$expected_version_code' versionName='$expected_version'" \
    "Android application APK"
require_badging \
    "$test_apk" \
    "package: name='com.safenet.dns.test'" \
    "Android instrumentation APK package"

command -v unzip >/dev/null 2>&1 || fail "unzip is required to inspect the application APK."
unzip -l "$apk" | grep -Fq "assets/public/" ||
    fail "Android application APK does not contain the bundled web assets."

archive_entries="$(tar -tzf "$smoke_archive")" ||
    fail "Smoke evidence archive is not a readable gzip tar archive."
[[ -n "$archive_entries" ]] || fail "Smoke evidence archive is empty."
while IFS= read -r entry; do
    normalized="${entry#./}"
    [[ -z "$normalized" ]] && continue
    case "$normalized" in
        /*|..|../*|*/../*|*/..)
            fail "Smoke evidence archive contains an unsafe path: $entry"
            ;;
    esac
done <<< "$archive_entries"

archive_has_entry() {
    local expected_entry="$1"
    grep -Fqx "./$expected_entry" <<< "$archive_entries" ||
        grep -Fqx "$expected_entry" <<< "$archive_entries"
}

archive_has_entry "android-smoke-result.txt" ||
    fail "Smoke evidence archive is missing android-smoke-result.txt."
archive_has_entry "release-record.txt" ||
    fail "Smoke evidence archive is missing release-record.txt."

archive_result="$(mktemp)"
trap 'rm -f "$archive_result"; write_summary' EXIT
tar -xOzf "$smoke_archive" ./android-smoke-result.txt > "$archive_result" 2>/dev/null ||
    tar -xOzf "$smoke_archive" android-smoke-result.txt > "$archive_result" 2>/dev/null ||
    fail "Could not extract android-smoke-result.txt from smoke evidence archive."
cmp -s "$smoke_result" "$archive_result" ||
    fail "Published smoke result does not match the copy in the evidence archive."
grep -Eq '^validation_mode=[^[:space:]]+' "$smoke_result" ||
    fail "Published smoke result is missing validation_mode."
grep -Eq '^failure_category=[^[:space:]]+' "$smoke_result" ||
    fail "Published smoke result is missing failure_category."

echo "Verified published Android release assets: checksums, signatures, package metadata, and smoke evidence."