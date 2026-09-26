---
name: Tailscale DNS filtering boundary
description: Product and architecture constraints for filtering DNS carried through the Android Tailscale tunnel.
---

SafeNet's bundled Tailscale Android bridge has no query-level DNS policy hook, so its local DNS rules apply to cleartext UDP/53 packets read from the TUN device. TCP/53 is blocked while the DNS firewall is enabled. Encrypted DoH/DoT stays opaque to SafeNet; a filtering resolver may apply its own upstream policy.

**Why:** The user chose provider-side filtering while keeping encrypted DNS, rather than installing a local TLS-interception certificate. SafeNet's DNS and firewall packet hooks do not expose decrypted DoH/DoT query names.

**How to apply:** Keep local enforcement in the real Tailscale packet path. Offer verified filtered resolver profiles for encrypted DNS, clearly distinguish upstream filtering from SafeNet custom rules, and never claim query-level inspection or install a decryption CA. Treat broader non-DNS VPN rules as separate work.