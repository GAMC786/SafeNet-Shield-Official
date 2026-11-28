---
name: Android VPN intentional shutdown
description: Prevent normal SafeNet DNS VPN stops from being reported as unexpected service failures.
---

The Android DNS VPN must mark a user-requested stop before closing its VPN interface. Service destruction can happen immediately after the descriptor closes, so checking intent only in onDestroy is too late.

Persist the user's protection intent separately from the resolver settings. Clear it on an explicit stop or VPN permission revocation; when the dashboard observes an inactive service with intent still enabled, it may make one recovery attempt for the current resolver and show that it is reconnecting.

**Why:** The service previously cleared its stop state before onDestroy ran, causing ordinary toggle-off actions to surface the same “stopped unexpectedly” message as a native failure.

**How to apply:** Keep intentional-stop state separate from interface cleanup, preserve the original exception for unexpected exits, and distinguish VPN revocation from ordinary service destruction. Bound dashboard recovery attempts so a bad resolver or revoked permission cannot create a retry loop.