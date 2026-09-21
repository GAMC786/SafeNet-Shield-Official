---
name: Optional push-alert status
description: OneSignal push alerts are optional and may be unavailable without affecting core antivirus protection.
---

Optional push-alert provider failures must be represented as a normal capability status, not as a failed antivirus response or a raw provider error in the user interface.

**Why:** The published app had a stale/unauthorized OneSignal connector that returned HTTP 401 while ClamAV was verified and the antivirus engine was healthy.

**How to apply:** Keep the push-alert status endpoint successful at the app boundary, return a safe explanation such as “not configured,” and explicitly state that core antivirus and ClamAV protection remain active.