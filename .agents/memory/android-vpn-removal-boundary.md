---
name: Android VPN scope
description: Durable boundary between SafeNet DNS filtering and removed full-traffic VPN features.
---

SafeNet's Android DNS filtering may use a DNS-only VpnService so an active resolver and SafeNet blocklists can affect device DNS requests. This path must remain distinct from the removed WireGuard/full-traffic VPN surface: do not claim HTTPS payload inspection, private-proxy inspection, or arbitrary application traffic routing.

**Why:** Resolver selection without a device routing path only changes server-side state and cannot filter the phone. Reintroducing the narrow DNS path fixes that user-visible gap without restoring unrelated tunnel features.

**How to apply:** Keep the DNS service, firewall snapshot sync, resolver bridge, manifest declaration, UI controls, and package smoke checks together. Treat WireGuard services, VPN tiles, arbitrary traffic forwarding, and private-proxy claims as separate removed features.