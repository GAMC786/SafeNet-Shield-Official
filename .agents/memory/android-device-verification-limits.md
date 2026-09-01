---
name: Android device verification limits
description: Documents the workspace limitation that prevents local Android runtime smoke tests.
---

This workspace does not provide an attached Android target, emulator, Android SDK, or KVM by default; host-side resolver checks cannot substitute for VPN runtime evidence.

**Why:** Android VPN behavior, permission prompts, route ownership, and device-specific network failures cannot be confirmed from static APK inspection or ordinary host networking.

**How to apply:** Before attempting Android smoke verification, check `adb devices`, emulator/SDK availability, and `/dev/kvm`; if no target exists, report the runtime checks as blocked rather than passing them from host controls.