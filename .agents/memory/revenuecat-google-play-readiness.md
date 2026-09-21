---
name: RevenueCat Google Play readiness
description: RevenueCat can show an active Play product before it can read the live Google Play subscription state.
---

An Android product is not purchasable merely because its RevenueCat product is active and attached to an offering. RevenueCat must also have Google Play Console service-account credentials, and the product store-state lookup must succeed so the subscription/base plan and price can be read.

**Why:** The configured SafeNet Play app had the correct package and an active `premium_monthly:monthly` product, but RevenueCat returned “Missing credentials for the store” for its store-state endpoint.

**How to apply:** Before release, verify the Play app credentials and store state through RevenueCat. Treat missing credentials or a failed store-state lookup as a release blocker; do not fall back to an arbitrary offering package.