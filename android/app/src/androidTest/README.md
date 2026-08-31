# Android smoke test

This directory contains the instrumentation assertions used by the release
smoke test:

- `SafeNetVpnEulaTest` calls the native Capacitor plugin and requires the exact
  `EULA_REQUIRED` rejection before any VPN permission request.
- `SafeNetVpnTrafficTest` resolves `example.com` and makes an HTTPS request.
  Run it only while the APK reports **Protected and connected**; DNS-only VPN
  routing should leave ordinary HTTPS available.

The end-to-end command is run from the repository root:

```bash
npm run android:smoke -- \
  --apk android/app/build/outputs/apk/release/app-release.apk \
  --reset-data
```

Requirements:

- one connected Android device or emulator at API 33 or newer;
- `adb`, `python3`, and the Android SDK/Gradle toolchain;
- a built APK whose mobile backend is reachable from the target;
- when `--reset-data` is used, complete the normal SafeNet DNS sign-in flow
  when the script pauses.

The script captures the UIAutomator tree and command output under
`android/app/build/android-smoke/` (override with
`ANDROID_SMOKE_EVIDENCE_DIR`). The release workflow retains these four files:

- `run.log` — the complete smoke run, ending in `RESULT: PASS`;
- `active-ui.xml` — the UIAutomator tree while protection is active;
- `dns-query.txt` — the resolver check for `example.com`;
- `https-test.txt` — the instrumentation HTTPS assertion.

For a tagged release, retrieve them from the **SafeNet-DNS-Android-Smoke-Evidence**
artifact on the Android smoke job, or from the assets on the GitHub Release.
The release job refuses to publish unless all four files exist and `run.log`
ends with `RESULT: PASS`.

The hosted release check is defined in `.github/workflows/build.yml`. It
provisions a Google APIs API 33 emulator, installs the signed release APK,
builds, signs with the same release key, and installs the instrumentation APK
before enabling the VPN, and uses the public PIN-disabled SafeNet backend so no
interactive sign-in is needed.
The instrumentation APK is invoked directly after installation so it cannot
replace the signed release target with a debug APK.

## Evidence

Environment check on 2026-08-31: **PREFLIGHT BLOCKED** in the current workspace
because `adb`, an Android SDK, and an API 33+ emulator or attached device are
not available. This is not a device pass and must not be used as release
evidence. A real device or hosted-emulator pass is claimed only when its
`run.log` ends with `RESULT: PASS` and the four evidence files are retained.