---
name: DeepCleer integration boundary
description: DeepCleer onboarding and consent requirements for SafeNet cloud moderation.
---

DeepCleer image moderation requires onboarding-provided accessKey, appId, eventId, and tokenId fields, plus a vendor endpoint. Keep the endpoint in a workspace environment variable and the access key in a workspace secret; do not guess a region or persist captured frames.

**Why:** Public docs confirm image, video, livestream, text, and audio products, but this project did not have a subscription or vendor credentials. Treat the provider as unavailable until the full onboarding contract is present.

**How to apply:** Keep the on-device detector usable when cloud access is absent. Require an explicit cloud-sharing consent before forwarding any camera or screen frame, use HTTPS, and disable cloud sharing after provider or request failure.