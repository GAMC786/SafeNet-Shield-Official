---
name: DNS Firewall provider strategy
description: The chosen architecture for applying SafeNet DNS rules through family DNS provider APIs.
---

The user explicitly chose an opt-in SafeNet-hosted filtering resolver for Android Private DNS. Provider-specific APIs remain an alternative when supported, but do not assume arbitrary DNS providers can apply SafeNet rules.

**Why:** The user changed the product direction and asked to try a hosted resolver without restoring Local VPN.

**How to apply:** For hosted Android Private DNS, require a host reachable on fixed public TCP 853 with a valid TLS certificate. Provider API sync avoids SafeNet proxying but only works for integrated providers and supported domain rules.
