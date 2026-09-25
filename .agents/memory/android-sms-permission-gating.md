---
name: Android SMS permission gating
description: Keep SMS status checks aligned with permissions the app can request at runtime.
---

The permission state used to enable SMS filtering must match the permissions requested through the app's runtime permission alias. Keep `WRITE_SMS` declared in the manifest for default-SMS-provider operations, but do not require it as a runtime grant for the filter toggle; it is not part of the app's runtime permission request.

**Why:** The native status check required `WRITE_SMS` even though the permission prompt requested only `READ_SMS`, `RECEIVE_SMS`, and `SEND_SMS`, leaving the filter disabled after users granted every requested permission.

**How to apply:** When adding or changing SMS permission checks, compare the enablement gate to the runtime alias. Keep provider-write failures handled at the inbox operation boundary rather than using `WRITE_SMS` to block filter activation.