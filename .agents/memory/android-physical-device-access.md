---
name: Android physical-device access
description: Physical Android validation cannot use a phone connected to the user's computer from the cloud workspace
---

Replit's cloud workspace does not expose a user's local USB device to the workspace's ADB daemon. Physical-install checks therefore require a user-provided device report or an externally accessible device runner; hosted GitHub artifacts alone cannot prove speaker output.

**Why:** ADB installed and started successfully, but `adb devices` remained empty and no USB devices were exposed even after the user connected a phone locally.

**How to apply:** Do not claim a physical Android check passed from this workspace. Provide the exact artifact link and collect the user's device observations, or use a separately connected Android runner.