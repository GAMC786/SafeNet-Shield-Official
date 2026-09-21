---
name: LockLock app protection boundary
description: Safety and permission rules for the offline LockLock-based app protection flow.
---

Use the offline LockLock-based passcode flow only with explicit user opt-in to Accessibility and Device Administrator permissions. Store salted local hashes, keep recovery local, and protect only the user-selected launchable apps; never capture Android credentials or use a system-wide overlay.

**Why:** The product requirement changed from a SafeNet-only Android credential prompt to LockLock features: selected-app locking, anti-uninstall protection, brute-force cooldowns, and offline recovery. Accessibility and Device Admin are materially broader permissions and must remain visible and user-controlled.

**How to apply:** Keep the native lock surface opaque, de-duplicate foreground events, require a passcode before enable/disable/unlock, keep anti-uninstall opt-in, and verify the permission handoff and recovery flow on a real Android device before release.