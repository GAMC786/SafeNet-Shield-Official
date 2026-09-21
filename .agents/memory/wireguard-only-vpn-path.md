---
name: WireGuard-only VPN path
description: The dashboard intentionally exposes only the official WireGuard tunnel while keeping resolver management for tunnel DNS settings.
---

The user-facing Android VPN path is WireGuard only. The legacy DNS-only VPN remains available only as native compatibility code so an older running service can be stopped safely; new UI and resolver activation flows must never start it.

**Why:** The DNS-only path and the earlier WireGuard presentation were both observed as non-working in the Android UI, so exposing both controls made protection status ambiguous.

**How to apply:** Treat WireGuard state as the dashboard protection state, keep the WireGuard gateway configuration error visible, and stop any legacy DNS tunnel before starting WireGuard.