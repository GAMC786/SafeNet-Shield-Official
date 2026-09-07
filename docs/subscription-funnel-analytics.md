# Subscription checkout funnel analytics

SafeNet's published web app uses Replit-hosted Project Analytics custom events to
measure the subscription journey without sending account or payment identifiers.
The tracker is injected by the publishing proxy; the app does not configure a
website ID or analytics script.

## Events

| Description | Event name |
| --- | --- |
| A checkout URL was successfully created and the browser is about to leave Settings for checkout. | `subscription_checkout_started` |
| The browser returned to Settings from checkout. Use `outcome` to distinguish success from cancellation. | `subscription_checkout_returned` |
| A billing portal URL was successfully created and the browser is about to leave Settings for billing recovery or management. | `billing_portal_opened` |

The events use only the following non-personal properties:

| Property | Values | Purpose |
| --- | --- | --- |
| `location` | `settings_subscription` | Identifies the subscription controls that initiated the event. |
| `outcome` | `success`, `canceled` | Separates the two checkout return paths on `subscription_checkout_returned`. |

No Clerk IDs, Stripe IDs, email addresses, subscription URLs, or free-form user
content are included.

## Funnel

Use the events in this order for a published web funnel:

1. `subscription_checkout_started`
2. `subscription_checkout_returned` where `outcome` is `success`
3. `billing_portal_opened` for later billing recovery or subscription management

The difference between checkout starts and successful returns represents users
who did not complete the return path, including users who abandoned checkout.
Filter `subscription_checkout_returned` by `outcome = canceled` to measure
explicit cancellations separately. A successful return indicates that the
checkout provider sent the browser back; entitlement is confirmed by the
subscription status query and is not inferred from analytics.

Enable analytics in Publishing settings and publish or republish the app before
expecting these custom events in the published web analytics.