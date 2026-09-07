---
name: Stripe startup coordination
description: Shared startup locking and explicit backfill selection are required for autoscaled Stripe initialization.
---

All Stripe startup mutations must run under one stable PostgreSQL advisory lock shared by every instance, including SafeNet plan provisioning, managed webhook reconciliation, and incremental backfill.

**Why:** Autoscale cold starts can overlap Stripe API discovery and cleanup. The installed sync package's no-argument backfill path does not select an object, so it must be called with an explicit object such as `all`.

**How to apply:** Acquire the shared lock through the Stripe sync database client before any startup Stripe mutation, and release it through the lock helper's `finally` path. Keep the sync engine's per-webhook lock in place as defense in depth.