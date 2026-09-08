---
name: Android WebView startup fallback
description: Real-device startup behavior when the packaged WebView is slow or blank
---

Packaged Android builds should retain an opaque native startup fallback until the WebView reports usable content, with the web loader underneath as the app's normal startup state.

**Why:** A hosted emulator smoke test can pass while a physical phone briefly or persistently shows only the dark WebView background when native startup coverage is removed.

**How to apply:** Keep the native fallback visually covering the web loader, hide it only after the WebView has content and the minimum startup duration has elapsed, and let the web loader continue underneath if authentication/configuration is still loading. When comparing against a known-good package, build from that package's full source baseline rather than layering more startup logic onto the current wrapper.

Hosted Android smoke is not proof of physical-device startup: the emulator can fail before the smoke script with `adb: device offline` even after the signed APK builds successfully. Preserve the APK artifact and report the runner failure separately.

**Why:** The legacy-baseline release showed that build success and emulator availability are independent signals; blocking the artifact on an unavailable hosted emulator delayed the real-device comparison.