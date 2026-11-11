---
name: Android VPN scope
description: SafeNet's phone-only local VPN and DNS-filtering boundary.
---

The user asked SafeNet to replace Windscribe IKEv2 with a phone-only local Android VPN, without an external VPN server or AdGuard VPN Tunnel. DNS filtering should capture direct UDP/TCP port 53 and forward it through AdGuard Family DNS-over-TLS; offer Android Private DNS as System mode. App-owned DoH/DoT can bypass this DNS filtering, and HTTPS payloads are not inspected.

**Why:** the user has no Linux VPN server and explicitly chose protecting only the phone. Android requires VPN consent, and ordinary apps cannot silently change the system Private DNS provider.

**How to apply:** Keep local TCP/UDP forwarding, DNS capture, encrypted Family upstream, Private DNS System mode, clear bypass warnings, and Android verification together. Do not restore Windscribe or AdGuard VPN Tunnel.