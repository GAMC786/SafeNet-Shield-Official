---
name: Android DNS upstream network
description: The DNS-only Android VPN must keep resolver traffic on the physical network instead of recursively routing it through its own virtual DNS interface.
---

The DNS-only VPN should both bind upstream resolver sockets to the current usable, validated non-VPN network and call VpnService.protect before connecting them. The VPN interface may own only the virtual DNS routes; ordinary internet traffic must remain outside the tunnel. Wi-Fi Direct can temporarily become Android's active network, so refresh the VPN underlying network when sharing starts or stops and never treat an unvalidated local interface as an internet upstream.

**Why:** On Android, protecting a socket is necessary but can be insufficient after Wi-Fi/mobile-network changes. A resolver socket that follows the VPN's route can make every app appear offline even though the VPN interface is running.

**How to apply:** Preserve the validated non-VPN network selection for UDP, TCP, DoT, and DoH upstream sockets. When an app-level proxy shares through Wi-Fi Direct, resolve through SafeNet first, then bind proxy sockets to the validated physical network. Keep the hosted Android smoke test for ordinary HTTPS connectivity and add physical-device evidence when changing routing behavior.

On a physical Pixel 8 Pro, SafeNet's WebView could keep reporting `SERVER CONNECTION UNAVAILABLE` after the DNS VPN was stopped even though Chrome could fetch the production API successfully. Force-stopping and relaunching the app cleared the stale WebView network state and restored `System Status: Online`.

**Why:** Toggling the Android DNS VPN changes the device's network path while the WebView retains its existing DNS/TLS connection state; the UI's polling error can persist after the underlying network has recovered.

**How to apply:** Treat a post-VPN WebView connection failure as recoverable before diagnosing the backend: stop/restart the app and retry the public API. Consider a network-change or query-reset recovery path if this recurs in production.