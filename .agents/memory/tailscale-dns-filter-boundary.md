---
name: Tailscale DNS filtering boundary
description: Product and architecture constraints for filtering DNS carried through the Android Tailscale tunnel.
---

SafeNet's bundled Tailscale Android bridge has no query-level DNS policy hook, so DNS rules must be enforced on packets read from its TUN device. This phase filters cleartext UDP/53, blocks TCP/53 while the DNS firewall is enabled, and does not inspect encrypted DoH or DoT.

**Why:** The user requested separate DNS and VPN firewall controls, chose to start with DNS filtering, and explicitly chose fail-closed handling for TCP/53. Encrypted DNS contents are not available at the packet boundary.

**How to apply:** Keep enforcement in the real Tailscale packet path; do not add a display-only VPN toggle or claim encrypted-DNS inspection. Treat broader non-DNS VPN rules as a separate follow-up feature.