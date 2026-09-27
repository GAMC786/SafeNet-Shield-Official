---
name: LockLock app protection boundary
description: Safety and permission rules for the offline LockLock-based app protection flow.
---

SafeNet's app-lock integration keeps the local passcode and recovery flow, and Device Owner is an explicit ADB enrollment rather than an in-app privilege escalation. System restrictions and per-app suspend/hide remain opt-in; removal restores only restrictions and package states SafeNet recorded as its own.

**Why:** The product requirement explicitly includes AppLock's Device Owner features, but the upstream app assumes a different package and credentials, and its broad cleanup could remove policies SafeNet did not apply.

**How to apply:** Keep SafeNet's package identity and recovery boundaries, show Device Owner enrollment requirements before provisioning, gate policy changes on live Device Owner status, and preserve the AppLock MIT notice for adapted behavior.

App-lock enforcement still requires explicit Accessibility and overlay permissions. Keep the native lock surface opaque, do not capture Android credentials or imply arbitrary network inspection, and keep anti-uninstall protection opt-in.

**Why:** Accessibility and Device Owner policies are broad system privileges, while SafeNet's passcode and recovery data remain local.

**How to apply:** Apply live status/navigation bar insets directly to every native overlay when using edge-to-edge, de-duplicate foreground events, require authentication before enable/disable/unlock and protected Quick Settings actions, and verify permission handoff and recovery on a real Android device before release.

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