---
name: Android VPN scope
description: SafeNet's phone-only local VPN and DNS-filtering boundary.
---

The user asked SafeNet to replace Windscribe IKEv2 with a phone-only local Android VPN, without an external VPN server or AdGuard VPN Tunnel. DNS filtering should capture direct UDP/TCP port 53 and forward it through AdGuard Family DNS-over-TLS; offer Android Private DNS as System mode. App-owned DoH/DoT can bypass this DNS filtering, and HTTPS payloads are not inspected.

**Why:** the user has no Linux VPN server and explicitly chose protecting only the phone. Android requires VPN consent, and ordinary apps cannot silently change the system Private DNS provider.

**How to apply:** Keep local TCP/UDP forwarding, DNS capture, encrypted Family upstream, Private DNS System mode, clear bypass warnings, and Android verification together. Do not restore Windscribe or AdGuard VPN Tunnel.

**Fail-closed startup rule:** Before installing the Android VPN's default routes, fetch and sync the authenticated firewall snapshot to native storage. Do not start device-wide routing while the native policy is missing or still loading.

**Why:** The native firewall intentionally blocks DNS when its encrypted policy snapshot is absent; enabling the VPN before the Dashboard's asynchronous sync finishes can make the whole phone appear offline.

**How to apply:** The user-triggered start path must await a fresh policy fetch and native sync, and keep the toggle off with a visible error if either step fails.