---
name: DNS native blocklist capability
description: Scope rules for provider-native DNS filters and SafeNet rule synchronization.
---

Only expose DNS-provider-native blocklist controls when the provider documents an account API for them. OpenDNS Home remains resolver-only, uBlockDNS is unsupported without a confirmed account API, and Cloudflare and Umbrella are outside this token-connection flow. Keep native list changes separate from SafeNet-owned rule synchronization.

AdGuard's Server setup ID is for enrolling devices through the AdGuard DNS app. API calls need the DNS server object's `id` from the DNS server listing endpoint; the two identifiers are not interchangeable. Loading server names and IDs with the user's API key and letting them select one resolved repeated 404s from manually entered IDs.

The public AdGuard API can list built-in and existing custom filters, but does not document creating a custom URL filter. Keep custom-list creation in SafeNet or link to AdGuard's dashboard; do not rely on private endpoints.

**Why:** The user asked for documented provider behavior only and explicitly separated native filters from SafeNet rule sync; overstating unsupported controls would mislead users. The successful picker flow also confirmed that provider-returned IDs are safer than asking users to copy similar-looking identifiers.

**How to apply:** Before adding a provider to Firewall list management, verify the provider's first-party API docs and test that toggles preserve unrelated lists and policies. For AdGuard API connections, list available servers with the same key, present the returned names/IDs for selection, and never accept a device setup ID as the API server ID. For custom URL lists, use SafeNet-managed local storage and offer an AdGuard dashboard shortcut.
