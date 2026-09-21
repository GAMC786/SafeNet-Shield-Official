---
name: RevenueCat connector API actions
description: RevenueCat project setup relationships use action endpoints for product attachment.
---

RevenueCat management API relationship mutations must use the generated SDK's action routes, such as `actions/attach_products`, rather than POSTing to the read-only `/products` collection.

**Why:** The collection endpoint returns HTTP 405 for relationship mutation even though the operation is documented as a POST; the generated Replit SDK exposes the correct action path.

**How to apply:** Prefer the generated RevenueCat SDK definitions when adding setup or migration automation, and keep relationship setup idempotent when an already-attached product returns a conflict.