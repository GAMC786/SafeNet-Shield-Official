# Android DNS protection verification — v1.0.7

**Date:** 2026-09-01  
**Result:** Blocked for Android runtime verification; no physical device or emulator was available in the workspace.

## Release artifact

- Repository: `GAMC786/SafeNet-Shield-Official`
- Release: `v1.0.7`
- Asset: `app-release.apk`
- Published asset size: 3,848,318 bytes
- GitHub asset digest: `sha256:5cdc3ef54f2185b189981d6375d2b1b9860c20b4a530928cc23fa0a6cb7ad91b`
- Download URL: https://github.com/GAMC786/SafeNet-Shield-Official/releases/download/v1.0.7/app-release.apk
- APK inspection found an APK Signing Block with the Android v2 signing ID (`0x7109871a`).
- Embedded app ID: `com.safenet.dns`
- Embedded mobile backend: `https://safe-net-shield-official.replit.app`

The downloaded file matched the GitHub asset digest. The APK was removed after inspection; the digest above is sufficient to retrieve the same immutable release asset.

## Android target preflight

| Check | Result |
|---|---|
| ADB 35.0.1 installed | Pass |
| `adb devices -l` | No devices listed; raw capture: `adb-devices.txt` |
| `adb install -r app-release.apk` | Blocked, exit 1: `adb: no devices/emulators found`; raw capture: `adb-install-attempt.txt` |
| Emulator binary | Missing |
| SDK manager / AVD manager | Missing |
| `/dev/kvm` | Missing |
| `connectedAndroidTest` | Blocked, exit 1: Android SDK location not found |

## Control-network checks from the workspace

These checks validate the resolver endpoints from the host only. They are not Android VPN results.

| Path | Result |
|---|---|
| Plain DNS to `1.1.1.1:53` | Pass — DNS response ID `0x4242`, RCODE 0, 2 answers, 61 bytes |
| DoH POST to `https://dns.google/dns-query` | Pass — HTTP 200, DNS RCODE 0, 2 answers, 61 bytes |
| DoT TLS to `1.1.1.1:853` with `cloudflare-dns.com` SNI | Pass — certificate authorized, DNS RCODE 0, 2 answers, 61 bytes |
| Unreachable IPv6 control `2001:db8::1:443` | Not reproduced — host returned `EAFNOSUPPORT`, not `ENETUNREACH` |
| Unreachable IPv4 controls `192.0.2.1:443` / `198.18.0.1:443` | Not reproduced — both timed out |

## Static implementation review

The checked-in implementation contains the requested behaviors, but none were runtime-confirmed on Android:

- EULA gate: plugin rejects start with `EULA_REQUIRED` until the current EULA version is accepted.
- VPN permission: plugin uses `VpnService.prepare()` and resumes through the activity result callback.
- DNS-only routing: service adds only the virtual DNS `/32` route and virtual DNS server; it does not add a default route.
- Upstream loop avoidance: plain, DoH, and DoT sockets are protected from the VPN.
- Resolver fallback: configured addresses are attempted in order for each resolver type.
- Clean stop: plugin stops the service and service teardown closes the VPN descriptor and worker.

## Coverage gaps found

- `scripts/android-smoke-test.sh` is not present in this checkout.
- `android/app/src/androidTest/` contains only the template context test, which still expects `com.getcapacitor.app`; it does not exercise the SafeNet VPN flow.

## Conclusion

The v1.0.7 release artifact is the correct published signed APK and its plain DNS, DoH, and DoT endpoints are reachable from the host. The required EULA, permission, DNS-only routing, ordinary connectivity, fallback, clean-stop, and Android `ENETUNREACH` checks remain **unverified** because this environment has no attached Android target, emulator, Android SDK, or KVM support.