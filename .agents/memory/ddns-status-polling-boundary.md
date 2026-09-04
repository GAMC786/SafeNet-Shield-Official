---
name: DDNS status polling boundary
description: The selected DDNS refresh cadence applies to client status reads, not provider mutations.
---

The 500 ms DDNS cadence is intentionally limited to refreshing SafeNet's local updater status. It must not cause external DDNS provider writes at that frequency; provider updates remain scheduler- or user-triggered.

**Why:** Frequent provider writes could trigger rate limits or unintended DNS churn, while users still need near-live visibility into the updater's last result.

**How to apply:** Keep the fast interval on the client status query only. Preserve separate server-side scheduler and explicit manual-update paths for provider mutations.