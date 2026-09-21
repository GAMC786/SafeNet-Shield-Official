---
name: Android release completion signal
description: How to determine whether a tagged Android release is complete when optional workflow jobs remain queued.
---

The signed Android release is complete when the required `release` job and `verify-published-android-release` job succeed and the formal GitHub Release contains the APK and checksum assets. The overall workflow can remain queued while unrelated optional validation jobs wait for runner capacity.

**Why:** The tagged release workflow publishes only after the hosted smoke gate, while optional validation lanes may be independently queued; treating the aggregate run state as the only signal can delay or misclassify a successfully published release.

**How to apply:** Check the required release jobs directly, then verify the formal release tag, asset names, and checksum. Do not publish a duplicate release or cancel the workflow solely because an optional job remains queued.