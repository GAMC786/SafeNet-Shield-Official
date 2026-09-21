---
name: Android Internet Share failure boundary
description: Wi-Fi Direct and foreground-service startup failures can occur outside the Capacitor call stack
---

Internet Share must catch failures in the Android foreground service and Wi-Fi Direct callbacks, then preserve a user-visible `lastError` instead of allowing the APK process to terminate.

**Why:** Starting the service returns before asynchronous Wi-Fi Direct setup completes, so a JavaScript `try/catch` cannot protect the app from native startup exceptions.

**How to apply:** Keep plugin, foreground-service, Wi-Fi Direct, group-info, and local-proxy startup paths defensive; declare ACCESS_WIFI_STATE and CHANGE_WIFI_STATE alongside the API-level runtime permission; verify the behavior on a physical Android device because the workspace cannot reproduce device-specific Wi-Fi Direct failures.

## Credential handoff

Treat `dumpsys wifi p2p` as a diagnostic view, not the source of truth for client credentials. On Android 10 and newer, an app-defined group credential can provide a supported handoff when OEM diagnostics hide the passphrase; if neither the native API nor the app-defined group provides credentials, report manual Android-settings pairing explicitly.

**Why:** OEM diagnostic output can omit or reformat the passphrase even while the Wi-Fi Direct group remains usable. Persisting the handoff log would expose a live network secret.

**How to apply:** Keep credentials in memory only, transfer them through a short-lived runtime handoff, redact every persisted log, and distinguish successful client access from a bounded credential-handoff block.