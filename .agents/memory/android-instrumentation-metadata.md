---
name: Android instrumentation metadata
description: Release verification boundaries for the separate Android test APK.
---

The instrumentation APK is a separate test package and may report empty version fields or tool-specific badging output even when it is correctly signed and runnable.

**Why:** Treating the test APK like the application APK caused a valid release to fail after its hosted smoke test had already installed and exercised the instrumentation package.

**How to apply:** Verify the instrumentation APK exists, is signed, and has the expected test package identity. Use the hosted or attached-device smoke test to validate its runner and target behavior instead of matching app version metadata or brittle `aapt` text formatting.