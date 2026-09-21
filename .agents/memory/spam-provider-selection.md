---
name: Spam provider selection
description: Current provider tradeoffs for SafeNet's spam-call screening integration.
---

Hiya Protect is the strongest product fit when SafeNet can obtain partner access: it is purpose-built for real-time spam/fraud call protection and offers REST and cache integration. Access is manual and requires provider approval/KYC. Call Control's public Protect page lists a versioned HTTPS GET with caller E.164, optional customer E.164, and `allow`/`block`/`voiceMail` actions, but its prose says POST and omits numeric rate limits; commercial use still requires a developer/enterprise agreement.

**Why:** SafeNet needs low-latency, commercially usable call reputation while keeping policy decisions and credentials under SafeNet control.

**How to apply:** Keep the provider behind SafeNet's server-side adapter, prefer a verified cache for the native screening path, never ship provider keys in Android, and fail open on stale or unavailable external data. Do not let conflicting Protect and Identify responses silently create a new policy; define precedence explicitly.