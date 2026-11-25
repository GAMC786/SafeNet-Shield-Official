---
name: Android DNS-only VPN path
description: SafeNet's Android user-facing VPN is now the local DNS-only tunnel, not WireGuard.
---

The user chose to replace the Android WireGuard tunnel with SafeNet's local DNS-only VPN. The local tunnel captures direct UDP/TCP port 53 requests and forwards them through the selected resolver; it does not connect to a remote VPN server, and app-owned encrypted DNS or other VPNs may bypass it. Keep WireGuard source/configuration only for compatibility unless the user separately asks to remove it.

**Why:** The user explicitly chose the DNS-only tunnel over retaining WireGuard, accepting the loss of the remote tunnel.

**How to apply:** Expose one Android VPN control for the local DNS filter, require Android VPN consent, show its live state and bypass limits, and never describe it as a remote VPN.