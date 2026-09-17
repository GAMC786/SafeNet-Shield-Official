---
name: AndroidX secure app lock boundary
description: Safety rules for the SafeNet-only Android credential safeguard.
---

Use AndroidX BiometricPrompt for SafeNet access and let Android handle biometric or device-credential entry. SafeNet must not capture, store, or proxy those credentials, and the feature must not lock the phone or other applications.

**Why:** The intended use is for a trusted sibling, friend, coworker, or service to complete the Android prompt on the user's behalf without giving SafeNet access to the credential itself. A native recovery path to Android security settings prevents a missing device credential from becoming an app dead end.

**How to apply:** Keep the lock surface native and opaque while authentication is pending, expose an explicit Enter credentials button, block duplicate prompts, and provide a Settings recovery action when Android reports no usable credential. Verify the prompt on a real Android device before release.