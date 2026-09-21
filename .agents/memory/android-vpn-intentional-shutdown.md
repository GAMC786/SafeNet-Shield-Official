---
name: Android VPN intentional shutdown
description: Prevent normal SafeNet DNS VPN stops from being reported as unexpected service failures.
---

The Android DNS VPN must mark a user-requested stop before closing its VPN interface. Service destruction can happen immediately after the descriptor closes, so checking intent only in onDestroy is too late.

**Why:** The service previously cleared its stop state before onDestroy ran, causing ordinary toggle-off actions to surface the same “stopped unexpectedly” message as a native failure.

**How to apply:** Keep intentional-stop state separate from interface cleanup, preserve the original exception for unexpected exits, and distinguish VPN revocation from ordinary service destruction.