---
name: App Lock email recovery
description: Security boundary and operational requirements for the Android App Lock email-assisted passcode reset.
---

Email-assisted recovery is an authenticated, server-side one-time-code flow. It can reset the Android-local App Lock passcode, but it must never mark the native session authenticated, finish the lock activity as successful, or unlock a protected package.

**Why:** Email verification proves access to the SafeNet account, not possession of the Android device or permission to open protected apps. The local biometric, device credential, passcode, or offline recovery answer must remain the final unlock step.

**How to apply:** Keep codes short-lived, single-use, attempt-limited, and stored only as keyed hashes. Configure the Clerk email sender with a verified address before enabling live delivery, and verify the complete flow on a signed Android build because the workspace may not have an Android SDK or a physical device.