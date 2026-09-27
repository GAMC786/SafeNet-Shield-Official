---
name: Windscribe firewall boundary
description: Architectural limits of applying SafeNet's packet firewall to imported Windscribe WireGuard tunnels.
---

The stock WireGuard Android GoBackend does not expose an app-level TUN packet-filter hook; it hands the Android VPN descriptor directly to native WireGuard. SafeNet's custom SDNS wrapper is a packet-level hook, but it currently intercepts only traffic to its virtual resolver addresses and sends it to the SDNS exchanger. It does not evaluate the synced `DnsFirewall` snapshot, and firewall sync only persists the policy in Android storage.

**Why:** DNS redirection to an encrypted resolver is not DNS firewall enforcement. A settings sync or DNS/route rewrite does not transfer Tailscale's firewall decisions into Windscribe.

**How to apply:** Do not claim Windscribe enforces DNS Firewall Rules or Prevent DNS Overrides from settings sync alone. The native Go path needs the policy at startup and on live updates, policy-semantic tests, an Android build, and real-tunnel verification. Keep claims scoped to cleartext DNS; do not imply DoH, DoT, or HTTPS inspection.