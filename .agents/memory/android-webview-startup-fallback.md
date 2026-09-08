---
name: Android WebView startup fallback
description: Real-device startup behavior when the packaged WebView is slow or blank
---

Packaged Android builds should retain an opaque native startup fallback until the WebView reports usable content, with the web loader underneath as the app's normal startup state.

**Why:** A hosted emulator smoke test can pass while a physical phone briefly or persistently shows only the dark WebView background when native startup coverage is removed.

**How to apply:** Keep the native fallback visually covering the web loader, hide it only after the WebView has content and the minimum startup duration has elapsed, and let the web loader continue underneath if authentication/configuration is still loading.