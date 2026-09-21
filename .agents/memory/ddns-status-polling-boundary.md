---
name: DDNS status polling boundary
description: The selected DDNS refresh cadence applies to client status reads, not provider mutations.
---

The 500 ms DDNS cadence is intentionally limited to refreshing SafeNet's local updater status. It must not cause external DDNS provider writes at that frequency; provider updates remain scheduler- or user-triggered.

SafeNet DDNS is device-managed: the browser or app sends the device's public IPv4, while the hosted scheduler must skip SafeNet records because its own public IP is the Replit server's address. Other providers may continue using the hosted scheduler.

**Why:** Frequent provider writes could trigger rate limits or unintended DNS churn, while users still need near-live visibility into the updater's last result.

**How to apply:** Keep the fast interval on the client status query only. SafeNet client-IP updates may be explicit or tied to the active DDNS page and must not be replaced by server-originated updates. Preserve separate server-side scheduler paths for other providers.