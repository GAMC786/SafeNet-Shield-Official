---
name: Stripe subscription entitlement safety
description: Durable rules for evaluating SafeNet subscription access, identity linkage, and duplicate recurring charges.
---

Treat Stripe’s webhook-synchronized records as the entitlement source of truth, but require the exact approved plan identity, amount, currency, and interval before granting access. Do not treat any active subscription on the same customer as sufficient.

**Why:** A customer can hold unrelated Stripe subscriptions, and concurrent checkout requests can otherwise create duplicate recurring charges before webhook state becomes visible.

**How to apply:** Keep checkout decisions serialized with a shared-database lock, combine that lock with Stripe idempotency, and reuse open checkout sessions. Briefly poll synchronized status after checkout returns so webhook delivery can converge.

SafeNet billing must also bind the Stripe customer to the authenticated Clerk user through a unique database identity bridge and carry that identity in Stripe metadata. Customer Portal and entitlement lookups must use that bridge, never an email search.

**Why:** Email-only Customer Portal lookup lets anyone who knows an address manage another customer’s billing, while Stripe customer IDs alone do not prove which SafeNet account owns them.

**How to apply:** Create or reuse one Stripe customer per Clerk user with an idempotent customer-creation request, reconcile the link from signed webhook metadata, and fail closed when the identity is already linked elsewhere.