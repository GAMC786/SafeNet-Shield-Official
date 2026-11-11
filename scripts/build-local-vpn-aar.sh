#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
android_dir="$project_root/android"
netstack_dir="$project_root/third_party/netvalve/netstack"
staging_dir="$android_dir/app/build/local-vpn-bridge"
output_dir="$android_dir/app/build/outputs/aar"
output_aar="$output_dir/safenet-localvpn.aar"
android_work_temp="${RUNNER_TEMP:-$android_dir/app/build/local-vpn-go-tmp}"

[[ -f "$netstack_dir/bridge.go" && -f "$netstack_dir/conn.go" ]] || {
    echo "Pinned NetValve bridge sources are missing." >&2
    exit 1
}
sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
[[ -n "$sdk_root" && -d "$sdk_root" ]] || {
    echo "Android SDK is not configured." >&2
    exit 1
}
ndk_root="${ANDROID_NDK_HOME:-$sdk_root/ndk/23.1.7779620}"
[[ -d "$ndk_root" ]] || {
    echo "Android NDK is not configured at $ndk_root." >&2
    exit 1
}
command -v go >/dev/null 2>&1 || {
    echo "Go is required to build the SafeNet Local VPN engine." >&2
    exit 1
}

rm -rf "$staging_dir"
mkdir -p "$staging_dir" "$output_dir"
cp "$netstack_dir/go.mod" "$netstack_dir/go.sum" \
    "$netstack_dir/bridge.go" "$netstack_dir/conn.go" "$staging_dir/"
cp "$project_root/android/local-vpn-bridge/dnscrypt.go" "$staging_dir/"

export ANDROID_SDK_ROOT="$sdk_root"
export ANDROID_HOME="$sdk_root"
export ANDROID_NDK_HOME="$ndk_root"
export GOTOOLCHAIN="${GOTOOLCHAIN:-auto}"
mkdir -p "$android_work_temp"
export TMPDIR="$android_work_temp"
export GOTMPDIR="$android_work_temp"
cd "$staging_dir"

mobile_version="$(go list -m -f '{{.Version}}' golang.org/x/mobile)"
go mod edit -require=github.com/ameshkov/dnscrypt/v2@v2.4.0
go mod tidy
go get -tool "golang.org/x/mobile/cmd/gomobile@$mobile_version"
go get -tool "golang.org/x/mobile/cmd/gobind@$mobile_version"
go mod tidy
go test ./...
go install "golang.org/x/mobile/cmd/gomobile@$mobile_version"
go install "golang.org/x/mobile/cmd/gobind@$mobile_version"
export PATH="$(go env GOPATH)/bin:$PATH"
if [[ "$(uname -s)" == "Linux" ]]; then
    no_apple_tools_dir="$staging_dir/no-apple-tools"
    mkdir -p "$no_apple_tools_dir"
    cat > "$no_apple_tools_dir/xcrun" <<'EOF'
#!/usr/bin/env sh
exit 127
EOF
    chmod +x "$no_apple_tools_dir/xcrun"
    export PATH="$no_apple_tools_dir:$PATH"
fi
gomobile init
gomobile bind -target=android -androidapi 26 -javapkg=dev.netvalve -o "$output_aar" .

[[ -s "$output_aar" ]] || {
    echo "SafeNet Local VPN AAR was not produced." >&2
    exit 1
}
echo "Built SafeNet Local VPN AAR: $output_aar"
