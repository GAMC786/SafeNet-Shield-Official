#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
android_dir="$project_root/android"
pins_file="$android_dir/variables.gradle"
strongswan_android_dir="$project_root/third_party/strongswan/src/frontends/android"
openssl_build_script="$strongswan_android_dir/openssl/build.sh"
openssl_output_dir="$strongswan_android_dir/app/src/main/jni/openssl"

openssl_version="$(sed -nE "s/^[[:space:]]*strongswanOpenSSLVersion[[:space:]]*=[[:space:]]*'([^']+)'.*/\1/p" \
    "$pins_file" | head -n1)"
openssl_sha256="$(sed -nE "s/^[[:space:]]*strongswanOpenSSLSha256[[:space:]]*=[[:space:]]*'([^']+)'.*/\1/p" \
    "$pins_file" | head -n1)"
min_sdk="${SAFENET_STRONGSWAN_MIN_SDK:-$(sed -nE 's/^[[:space:]]*minSdkVersion[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' \
    "$pins_file" | head -n1)}"
abis="${SAFENET_STRONGSWAN_ANDROID_ABIS:-arm64-v8a armeabi-v7a x86 x86_64}"

[[ "$openssl_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "Could not read a valid OpenSSL source version from $pins_file." >&2
    exit 1
}
[[ "$openssl_sha256" =~ ^[[:xdigit:]]{64}$ ]] || {
    echo "Could not read a valid OpenSSL source checksum from $pins_file." >&2
    exit 1
}
[[ "$min_sdk" =~ ^[0-9]+$ ]] || {
    echo "Could not read a valid Android minSdkVersion from $pins_file." >&2
    exit 1
}
[[ -f "$openssl_build_script" ]] || {
    echo "strongSwan's OpenSSL Android build script was not found: $openssl_build_script" >&2
    exit 1
}

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
ndk_root="${ANDROID_NDK_ROOT:-}"
if [[ -z "$ndk_root" ]]; then
    [[ -n "$sdk_root" ]] || {
        echo "Set ANDROID_NDK_ROOT or ANDROID_SDK_ROOT before preparing OpenSSL." >&2
        exit 1
    }
    ndk_version="$(sed -nE "s/^[[:space:]]*strongswanNdkVersion[[:space:]]*=[[:space:]]*'([^']+)'.*/\1/p" \
        "$pins_file" | head -n1)"
    [[ -n "$ndk_version" ]] || {
        echo "Could not read strongswanNdkVersion from $pins_file." >&2
        exit 1
    }
    ndk_root="$sdk_root/ndk/$ndk_version"
fi
[[ -x "$ndk_root/ndk-build" ]] || {
    echo "Pinned Android NDK was not found at $ndk_root." >&2
    exit 1
}

for tool in curl tar sha256sum make perl nproc; do
    command -v "$tool" >/dev/null || {
        echo "Required OpenSSL build tool is missing: $tool" >&2
        exit 1
    }
done

source_cache_dir="$android_dir/build/openssl-source"
archive_name="openssl-${openssl_version}.tar.gz"
archive_path="$source_cache_dir/$archive_name"
source_dir="$source_cache_dir/openssl-${openssl_version}"
download_url="https://github.com/openssl/openssl/releases/download/openssl-${openssl_version}/${archive_name}"

mkdir -p "$source_cache_dir"
if [[ -f "$archive_path" ]] &&
    ! (cd "$source_cache_dir" &&
        printf '%s  %s\n' "$openssl_sha256" "$archive_name" |
            sha256sum --check --status); then
    rm -f "$archive_path"
fi
if [[ ! -f "$archive_path" ]]; then
    echo "Downloading pinned OpenSSL ${openssl_version} source."
    curl --fail --location --retry 3 --retry-delay 2 \
        --connect-timeout 20 --max-time 600 \
        "$download_url" --output "$archive_path"
fi
(cd "$source_cache_dir" &&
    printf '%s  %s\n' "$openssl_sha256" "$archive_name" |
        sha256sum --check --status) || {
    rm -f "$archive_path"
    echo "OpenSSL ${openssl_version} source failed SHA-256 verification." >&2
    exit 1
}

rm -rf -- "$source_dir"
tar -xzf "$archive_path" -C "$source_cache_dir"
[[ -f "$source_dir/Configure" ]] || {
    echo "OpenSSL source archive did not produce the expected directory: $source_dir" >&2
    exit 1
}

# This directory is an ignored strongSwan build output; remove only its
# generated contents when rebuilding for a different or incomplete pin.
rm -rf -- "$openssl_output_dir"
echo "Building OpenSSL ${openssl_version} libcrypto for Android ABIs: $abis"
ANDROID_NDK_ROOT="$ndk_root" \
    OPENSSL_SRC="$source_dir" \
    NO_DOCKER=1 \
    ABIS="$abis" \
    MIN_SDK="$min_sdk" \
    OUT="$openssl_output_dir" \
    bash "$openssl_build_script"

[[ -s "$openssl_output_dir/Android.mk" ]] || {
    echo "OpenSSL Android.mk was not generated." >&2
    exit 1
}
for abi in $abis; do
    [[ -s "$openssl_output_dir/$abi/libcrypto.a" ]] || {
        echo "OpenSSL libcrypto was not built for ABI $abi." >&2
        exit 1
    }
done
[[ -s "$openssl_output_dir/include/openssl/opensslv.h" ]] || {
    echo "OpenSSL public headers were not copied to $openssl_output_dir." >&2
    exit 1
}

printf '%s %s\n' "$openssl_version" "$openssl_sha256" \
    > "$openssl_output_dir/.safenet-openssl-version"
echo "OpenSSL ${openssl_version} Android static libraries are ready."