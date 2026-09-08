---
name: ISP profile provider fallback
description: Reliability and wording constraints for public-IP-based ISP metadata in the network measurement screen
---

Public-IP ISP metadata is an inference from the device's public address, not a direct carrier connection query. Providers may rate-limit or reject requests, so the UI needs browser-safe fallbacks and a clear retry/error state.

**Why:** The first metadata provider returned HTTP 429 from the workspace environment even though another provider responded with CORS enabled.

**How to apply:** Keep the provider chain client-side so it observes the phone's public IP rather than the server's egress IP, normalize provider-specific fields, avoid storing the profile, and describe the result as inferred.