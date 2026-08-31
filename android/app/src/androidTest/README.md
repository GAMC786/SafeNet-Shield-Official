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
  --apk android/app/build/outputs/apk/debug/app-debug.apk \
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
`ANDROID_SMOKE_EVIDENCE_DIR`). The directory is build output and is not
committed; attach its `run.log`, `dns-query.txt`, and `https-test.txt` to the
Android release record. A run is complete only when the output ends with
`RESULT: PASS`.

## Evidence

Environment check on 2026-08-31: **BLOCKED** in the current workspace because
`adb`, an Android SDK, and an API 33+ emulator or attached device are not
available. The instrumentation and `adb` runner are ready to execute on the
next supported Android target; no device pass is claimed for this workspace.