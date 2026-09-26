---
name: Windscribe firewall boundary
description: Architectural limits of applying SafeNet's packet firewall to imported Windscribe WireGuard tunnels.
---

The stock WireGuard Android GoBackend does not expose an app-level TUN packet-filter hook; it hands the Android VPN descriptor directly to native WireGuard.

**Why:** SafeNet DNS and non-DNS packet policy runs at the TUN boundary in the Tailscale fork. A settings sync or DNS/route rewrite does not transfer those decisions into Windscribe.

**How to apply:** Do not label Windscribe tunnel traffic as protected from firewall settings alone. Enforcement requires a filtered WireGuard TUN/backend, policy-semantic tests, an Android build, and a real-tunnel verification before showing an active state.