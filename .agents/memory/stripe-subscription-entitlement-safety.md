---
name: Stripe subscription entitlement safety
description: Durable rules for evaluating SafeNet subscription access and preventing duplicate recurring charges.
---

Treat Stripe’s webhook-synchronized records as the entitlement source of truth, but require the exact approved plan identity, amount, currency, and interval before granting access. Do not treat any active subscription on the same customer as sufficient.

**Why:** A customer can hold unrelated Stripe subscriptions, and concurrent checkout requests can otherwise create duplicate recurring charges before webhook state becomes visible.

**How to apply:** Keep checkout decisions serialized with a shared-database lock, combine that lock with Stripe idempotency, and reuse open checkout sessions. Briefly poll synchronized status after checkout returns so webhook delivery can converge.