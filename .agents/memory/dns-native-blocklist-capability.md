---
name: DNS native blocklist capability
description: Scope rules for provider-native DNS filters and SafeNet rule synchronization.
---

Only expose DNS-provider-native blocklist controls when the provider documents an account API for them. OpenDNS Home remains resolver-only, uBlockDNS is unsupported without a confirmed account API, and Cloudflare and Umbrella are outside this token-connection flow. Keep native list changes separate from SafeNet-owned rule synchronization.

AdGuard's Server setup ID is for enrolling devices through the AdGuard DNS app. API calls need the DNS server object's `id` from the DNS server listing endpoint; the two identifiers are not interchangeable.

**Why:** The user asked for documented provider behavior only and explicitly separated native filters from SafeNet rule sync; overstating unsupported controls would mislead users.

**How to apply:** Before adding a provider to Firewall list management, verify the provider's first-party API docs and test that toggles preserve unrelated lists and policies. For AdGuard connections, use the API server ID rather than a device setup ID.
