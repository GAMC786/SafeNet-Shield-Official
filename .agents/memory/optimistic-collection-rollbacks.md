---
name: Optimistic collection rollbacks
description: Concurrency rule for optimistic updates to collections of independent entities
---

When an optimistic mutation fails, restore only the failed entity's previous value rather than replacing the entire collection snapshot.

**Why:** A second mutation on another entity may already have succeeded or remain pending; restoring a collection-wide snapshot can erase that independent change.

**How to apply:** Keep per-entity mutation ordering and capture the prior entity value in each mutation context. On failure, update only that entity while leaving the rest of the current collection untouched.