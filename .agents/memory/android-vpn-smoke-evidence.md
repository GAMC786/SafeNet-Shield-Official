---
name: Android VPN smoke evidence
description: The lifecycle constraint that keeps Android VPN traffic evidence valid.
---

The instrumentation APK must be built and installed before the app enables its
VPN. Running the full connected Android test task after activation may reinstall
the target APK and tear down the VPN service, causing traffic checks to pass
without testing the active service.

**Why:** The smoke test must prove DNS and ordinary HTTPS behavior while the
same APK's VPN service is active, not merely prove that network access works
after the service has been stopped by test setup.

**How to apply:** Prepare the target and test APKs first; after activation,
invoke the already-installed traffic test with `adb shell am instrument` and
then capture the active and stopped UI states.