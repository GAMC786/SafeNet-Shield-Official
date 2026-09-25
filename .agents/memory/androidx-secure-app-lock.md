---
name: LockLock app protection boundary
description: Safety and permission rules for the offline LockLock-based app protection flow.
---

Use the offline LockLock-based passcode flow only with explicit user opt-in to Accessibility and Device Administrator permissions. Store salted local hashes, keep recovery local, and protect only the user-selected launchable apps; never capture Android credentials or use a system-wide overlay.

Use aload0/AppLock as an architecture reference, not as an embedded application dependency. Keep SafeNet's Java opaque lock activity and local recovery boundaries instead of importing its Compose app or system-wide accessibility overlay.

**Why:** The referenced project is a standalone MIT-licensed app and its biometric path still uses Android BiometricPrompt. Importing it wholesale would expand permissions and replace SafeNet's recovery/security boundaries without removing the underlying prompt.

**How to apply:** Adapt only the foreground Accessibility Service and lock-screen lifecycle, retain SafeNet's selected-package store, passcode cooldown, email recovery, and anti-uninstall opt-in, and keep attribution in the third-party notices.

**Why:** The product requirement changed from a SafeNet-only Android credential prompt to LockLock features: selected-app locking, anti-uninstall protection, brute-force cooldowns, and offline recovery. Accessibility and Device Admin are materially broader permissions and must remain visible and user-controlled.

**How to apply:** Keep the native lock surface opaque, apply live status/navigation bar insets directly to every native overlay when the activity uses edge-to-edge, de-duplicate foreground events, require a passcode before enable/disable/unlock and protected Quick Settings actions, keep anti-uninstall opt-in, and verify the permission handoff and recovery flow on a real Android device before release.

Foreground lock launches must record the relaunch timestamp only after `startActivity` succeeds. If Android rejects a background launch during a window transition, coalesce repeated events and retry the same package after a short delay.

**Why:** Recording the package as handled before Android accepts the launch can suppress every later foreground event while the selected app remains visible, leaving the user-facing protection silently bypassed.

**How to apply:** Keep failed launches retryable, guard duplicate activity instances separately from launch-attempt timestamps, and validate this path on a hosted or physical Android runner.

Temporary passcode authorization is a foreground handoff, not a reusable grace period. Keep it available for the authenticated app's return, then revoke it when a confirmed different Activity takes focus.

**Why:** A package-scoped time window can otherwise be reused after leaving the app, while tests that wait past the window miss the bypass.

**How to apply:** Test leaving and reopening within the original allowance window; ignore keyboard and other non-Activity windows, and verify the behavior on a real Android device before release.

The persisted enabled switch is not proof that app launches are being monitored. Any UI that says protection is active must also require a passcode, the Accessibility Service, and overlay permission, and refresh those checks after Android settings returns.

**Why:** Users can save App Lock as enabled before granting its system permissions; reporting that as active hides that selected apps are not yet enforced.

**How to apply:** Keep requested/enabled state separate from runtime enforcement readiness, and show missing permission state prominently without preventing the setup handoff.

Physical quick-switch validation must preserve the protected app's task in the background. Do not force-stop the app between Home and reopening it.

**Why:** Force-stopping removes the background task and turns a quick-switch regression check into a cold-launch check, which can pass without proving the original bypass is fixed.

**How to apply:** Unlock the app, press Home, then reopen its existing task through the launcher or Overview within 15 seconds; assert the lock screen appears before re-authentication.