---
name: Spam provider selection
description: Current provider tradeoffs for SafeNet's spam-call screening integration.
---

Hiya Protect is the strongest product fit when SafeNet can obtain partner access: it is purpose-built for real-time spam/fraud call protection and offers REST and cache integration. Access is manual and requires provider approval/KYC. A Call Control deployment can use Protect as the primary action decision and Identify as reputation enrichment or fallback, but Protect's current contract and required destination-number context must be confirmed with the vendor.

**Why:** SafeNet needs low-latency, commercially usable call reputation while keeping policy decisions and credentials under SafeNet control.

**How to apply:** Keep the provider behind SafeNet's server-side adapter, prefer a verified cache for the native screening path, never ship provider keys in Android, and fail open on stale or unavailable external data. Do not let conflicting Protect and Identify responses silently create a new policy; define precedence explicitly.