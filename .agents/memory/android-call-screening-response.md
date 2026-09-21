---
name: Android call-screening response validity
description: Android CallResponse rejects notification-suppression flags on allowed calls.
---

Android `CallResponse` treats `skipNotification` and `skipCallLog` as disallowed-call flags. A silenced call must set only `silenceCall`; otherwise the framework can reject the response as an invalid allowed-call state.

**Why:** The builder validates these combinations at runtime, so a seemingly harmless notification flag can turn a valid silence decision into a service failure.

**How to apply:** When changing native call-screening mappings, assert the built response flags on an Android target for allow, silence, block, and unknown actions.