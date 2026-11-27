---
name: Android DNS upstream network
description: The DNS-only Android VPN must keep resolver traffic on the physical network instead of recursively routing it through its own virtual DNS interface.
---

Android VpnService routes by IP prefix, not destination port. To inspect DNS/53 for all apps, SafeNet captures the IPv4 and IPv6 default routes and relays non-DNS TCP/UDP flows. Every relayed socket must bind to the current validated non-VPN network and call VpnService.protect before connecting; otherwise ordinary internet can fail while the VPN is active. Resolver sockets must follow the same network rule. Wi-Fi Direct can temporarily become Android's active network, so refresh the VPN underlying network when sharing starts or stops and never treat an unvalidated local interface as an internet upstream.

**Why:** Protecting a socket prevents it from looping into the VPN, but it does not guarantee that it uses the validated physical network. A full-device VPN route makes any missing or misbound forwarding path look like a device-wide internet outage.

**How to apply:** Bind forwarded TCP and UDP sockets and resolver sockets to the current validated non-VPN network, then protect them before connecting. When an app-level proxy shares through Wi-Fi Direct, resolve through SafeNet first, then bind proxy sockets to the validated physical network. Keep the hosted Android smoke test for ordinary HTTPS connectivity and add physical-device evidence when changing routing behavior.

On a physical Pixel 8 Pro, SafeNet's WebView could keep reporting `SERVER CONNECTION UNAVAILABLE` after the DNS VPN was stopped even though Chrome could fetch the production API successfully. Force-stopping and relaunching the app cleared the stale WebView network state and restored `System Status: Online`.

**Why:** Toggling the Android DNS VPN changes the device's network path while the WebView retains its existing DNS/TLS connection state; the UI's polling error can persist after the underlying network has recovered.

**How to apply:** Treat a post-VPN WebView connection failure as recoverable before diagnosing the backend: stop/restart the app and retry the public API. Consider a network-change or query-reset recovery path if this recurs in production.