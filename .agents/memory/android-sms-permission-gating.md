---
name: Android SMS permission gating
description: Keep SMS status checks aligned with permissions the app can request at runtime.
---

Every incoming SMS classification must require the saved toggle, current default-SMS role, and current `RECEIVE_SMS` grant; mirror that same gate in reported status and enablement. Keep inbox reading (`READ_SMS`) and outgoing messages (`SEND_SMS`) gated by their own permissions; they must not block the incoming filter toggle. Keep `WRITE_SMS` declared for default-provider operations, but do not require it as a runtime grant.

**Why:** Filtering needs delivery of incoming SMS, while inbox browsing and sending are separate features. A combined “all SMS permissions” status can leave filtering disabled when an unrelated permission is missing; trusting only a persisted enabled flag can keep classification active after the receive grant is revoked.

**How to apply:** Keep a receive-only runtime permission request for filter activation and test that the default role plus `RECEIVE_SMS` enables filtering without `READ_SMS` or `SEND_SMS`. Also test role/permission loss so the classifier cannot continue while status reports filtering off. Handle provider-write failures at the inbox operation boundary rather than using `WRITE_SMS` to block filter activation.