---
name: Android Internet Share failure boundary
description: Wi-Fi Direct and foreground-service startup failures can occur outside the Capacitor call stack
---

Internet Share must catch failures in the Android foreground service and Wi-Fi Direct callbacks, then preserve a user-visible `lastError` instead of allowing the APK process to terminate.

**Why:** Starting the service returns before asynchronous Wi-Fi Direct setup completes, so a JavaScript `try/catch` cannot protect the app from native startup exceptions.

**How to apply:** Keep plugin, foreground-service, Wi-Fi Direct, group-info, and local-proxy startup paths defensive; verify the behavior on a physical Android device because the workspace cannot reproduce device-specific Wi-Fi Direct failures.