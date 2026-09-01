---
name: Android VPN smoke evidence
description: Keeps instrumentation assertions tied to the running app process and preserves useful network failure evidence.
---

Android instrumentation code runs outside the target application's process, so in-memory service state is not reliable from the test process.

**Why:** A test can observe a false stopped state even while the app's VPN service is running; this hides whether the bridge, permission flow, and service actually work.

**How to apply:** Drive native behavior through the shipped Capacitor bridge or another IPC boundary, and capture device/network state alongside test output so `ENETUNREACH` can be separated from other failures.