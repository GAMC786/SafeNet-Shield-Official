---
name: OpenLock app protection boundary
description: SafeNet's OpenLock integration boundary and the source project's architectural constraint.
---

SafeNet uses OpenLock's native enforcement model—Usage Access foreground detection, a foreground monitor service, and an overlay lock activity—while retaining SafeNet's existing Java/Capacitor UI and local recovery storage.

**Why:** OpenLock is a standalone MIT-licensed Flutter/Android application, not a hosted API or drop-in Android dependency. Copying the whole app would replace SafeNet's architecture and authentication surface.

**How to apply:** Keep account auth and SafeNet's local passcode/recovery contract unchanged. Treat Usage Access and overlay permission as required opt-ins; do not reintroduce AccessibilityService monitoring for app locking.