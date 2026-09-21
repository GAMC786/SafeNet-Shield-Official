---
name: Android DNS physical evidence
description: Physical DNS smoke must prove live VPN routing without changing a reused phone's saved firewall policy.
---

The physical DNS lane should apply its selected block rule to the running VPN service only, then query the virtual DNS endpoint for one REFUSED blocked answer and one successful allowed answer. Plain, DoH, and DoT outcomes must remain individually visible; encrypted protocols may be unavailable when external network access is unavailable.

**Why:** A physical runner may be reused and may have a user's firewall policy already stored. Persisting a test blocklist would change device behavior after the smoke, while treating external DoH/DoT outages as application passes would hide coverage gaps.

**How to apply:** Require pre-granted `VpnService` consent, verify SafeNet owns the active VPN, use bounded protocol markers in logcat/evidence, and classify missing devices, SDKs, consent, or upstream reachability as infrastructure or unsupported coverage rather than DNS filtering success.