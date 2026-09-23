---
name: WG-Easy hosting boundary
description: The SafeNet web deployment can monitor a real WG-Easy host but cannot host the WireGuard endpoint itself.
---

SafeNet must treat WG-Easy as an external Linux/Docker service. The host needs persistent WireGuard state, NET_ADMIN/SYS_MODULE capabilities, and public UDP access for the WireGuard port; Railway's public proxy is TCP-only.

**Why:** WG-Easy's official compose configuration requires kernel/network capabilities and UDP exposure that the SafeNet autoscale web service does not provide.

**How to apply:** Keep the Dashboard connection truthful: only show an admin action after server-side health checking `WG_EASY_URL`, and use `WG_EASY_WIREGUARD_ENDPOINT` for the client endpoint. Do not implement a local-only toggle.