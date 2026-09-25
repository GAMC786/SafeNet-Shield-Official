---
name: Android SMS permission gating
description: Keep SMS status checks aligned with permissions the app can request at runtime.
---

Enable incoming-message filtering based on the default-SMS role and `RECEIVE_SMS` only. Keep inbox reading (`READ_SMS`) and outgoing messages (`SEND_SMS`) gated by their own permissions; they must not block the incoming filter toggle. Keep `WRITE_SMS` declared for default-provider operations, but do not require it as a runtime grant.

**Why:** Filtering needs delivery of incoming SMS, while inbox browsing and sending are separate features. A combined “all SMS permissions” status can leave filtering disabled when an unrelated permission is missing.

**How to apply:** Keep a receive-only runtime permission request for filter activation and test that the default role plus `RECEIVE_SMS` enables filtering without `READ_SMS` or `SEND_SMS`. Handle provider-write failures at the inbox operation boundary rather than using `WRITE_SMS` to block filter activation.