---
name: Android device verification limits
description: Documents the workspace limitation that prevents local Android runtime smoke tests.
---

This workspace does not provide an attached Android target, emulator, Android SDK, or KVM by default; host-side resolver checks cannot substitute for VPN runtime evidence.

**Why:** Android VPN behavior, permission prompts, route ownership, and device-specific network failures cannot be confirmed from static APK inspection or ordinary host networking.

**How to apply:** Before attempting Android smoke verification, check `adb devices`, emulator/SDK availability, and `/dev/kvm`; if no target exists, report the runtime checks as blocked rather than passing them from host controls.

GitHub-hosted `google_apis` emulator jobs can boot, install signed APKs, and pass the host-side fixture probe while still failing every `adb remount` attempt with an unavailable `gsiservice`. A passing main-branch run does not guarantee that an independent tag runner has the same emulator health.

**Why:** The controlled fixture needs its temporary CA in the Android system trust store, and the hosted API 34 runner can fail that system-overlay operation independently of the application or APK.

**How to apply:** Preserve the explicit `FIXTURE_FAILURE` result and evidence, do not treat APK installation or host-side fixture health as runtime proof, and prefer a fresh runner/known-good emulator image over weakening release validation.