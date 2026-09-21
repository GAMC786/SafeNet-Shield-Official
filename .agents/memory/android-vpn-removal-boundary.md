---
name: Android VPN scope
description: Durable boundary between SafeNet DNS filtering and removed full-traffic VPN features.
---

SafeNet's Android DNS filtering uses Android Private DNS, not a SafeNet-owned VpnService. The app can open Android's Private DNS settings and report active only when the selected compatible DNS-over-TLS hostname matches. Do not claim HTTPS payload inspection, private-proxy inspection, or arbitrary application traffic routing.

**Why:** Android does not allow a normal app to silently change the system Private DNS provider, while a DNS VPN creates a separate consent and lifecycle path that SafeNet no longer exposes. The user must confirm the hostname in Android settings.

**How to apply:** Keep the Private DNS bridge, EULA, compatible resolver-hostname mapping, UI controls, and package smoke checks together. Treat VPN services, VPN permissions, VPN tiles, arbitrary traffic forwarding, and private-proxy claims as removed features.