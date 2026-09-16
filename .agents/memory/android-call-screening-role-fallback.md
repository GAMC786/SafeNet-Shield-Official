---
name: Android call-screening role fallback
description: Call-screening role requests need a visible fallback when the Android role dialog is unavailable, dismissed, or unsupported by an OEM.
---

The Android call-screening control should attempt RoleManager first, then open Android default-app settings when the role is still not held. The bridge must return the status observed after the settings activity closes, not the stale status from before it opened.

**Why:** A role request can resolve normally without granting the role, and a button that only awaits that result appears to do nothing. Returning stale status also forces users to tap twice after granting the role in Settings.

**How to apply:** Keep the role request and settings fallback behind the shared native command queue, refresh the role after returning from settings, and surface an actionable message when Android still has not selected SafeNet.