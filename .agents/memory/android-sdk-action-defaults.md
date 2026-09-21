---
name: Android SDK action defaults
description: The android-actions setup action still defaults to the removed tools package.
---

Always provide an explicit package list to every `android-actions/setup-android@v3` step; use `platform-tools` when a separate pinned installer owns the rest of the SDK.

**Why:** The action's default `tools platform-tools` request can fail before the project's pinned SDK installer runs because the Android repository no longer publishes `tools`.

**How to apply:** Check build, release-verification, and other Android workflow jobs for the action whenever the hosted runner or SDK action version changes.