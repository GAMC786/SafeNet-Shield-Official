---
name: DNS Firewall provider strategy
description: The chosen architecture for applying SafeNet DNS rules through family DNS provider APIs.
---

Keep the DNS Firewall on provider-specific APIs for NextDNS, AdGuard DNS, and CleanBrowsing. Do not replace this setup with a SafeNet-hosted resolver or on-device DNS VPN unless the user explicitly asks.

**Why:** The user asked to keep the current API-based setup rather than switch to SafeNet-hosted or local DNS filtering.

**How to apply:** Extend DNS rule syncing through supported provider APIs; clearly distinguish provider-native family filtering from SafeNet custom rules where an API is unavailable.
