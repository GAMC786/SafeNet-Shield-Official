---
name: WG-Easy tunnel verification
description: Keeps WG-Easy admin reachability separate from real UDP handshake evidence.
---

WG-Easy release checks must create a short-lived client through the admin API, observe the handshake from both the temporary peer and the WG-Easy host, and delete the client before reporting success. Private configuration and keys must stay in a mode-600 temporary file.

**Why:** An HTTP response from the WG-Easy dashboard can succeed while UDP 51820 is blocked, and a successful handshake with failed cleanup leaves a real disposable client behind.

**How to apply:** Keep admin UI and WireGuard tunnel states separate in status contracts and UI. Treat cleanup failure as verification failure, and only persist bounded timestamps/booleans/messages.