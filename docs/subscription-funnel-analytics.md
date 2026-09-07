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

## Published verification record

Verification run on September 7, 2026 against
`https://safe-net-shield-official.replit.app`:

- **Publishing and tracker: confirmed.** The deployment is public with a
  successful build, and the published HTML contains Replit's injected tracker.
  A transport probe sent a `subscription_checkout_returned` event successfully
  and the request contained only `outcome` and `location` from the documented
  property set.
- **Return UI: confirmed.** Visiting Settings with
  `subscription=canceled` and `subscription=success` displayed the expected
  cancellation and successful-return messages.
- **Checkout start and billing portal: not confirmed.** The published Settings
  page correctly requires a SafeNet account before showing those actions. In an
  unauthenticated browser, both billing endpoints returned `401` with the
  documented sign-in message, so no checkout or portal event should be counted
  from that run.
- **Published analytics query: no funnel events were present in the 30-day
  window before this verification, and the query was still empty after a
  20-second recheck following the transport probe.** This is consistent with
  the missing authenticated billing run, but the transport success alone does
  not confirm analytics ingestion. If an authenticated rerun remains empty,
  inspect the Publishing analytics pane, republish with analytics enabled, and
  repeat the query after generating fresh activity.

### Action required for a complete production verification

Sign in to the published app with a dedicated non-production SafeNet/Clerk
account, then exercise checkout start, cancel the hosted Checkout page, repeat
with a successful test payment, and open the billing portal. Query Project
Analytics afterward for all three event names and verify that checkout returns
have `outcome=success` or `outcome=canceled`, while checkout starts and portal
opens have only `location=settings_subscription`.

There is also a cold-load timing risk for return events: the published tracker
loads asynchronously and the Settings return effect can run before
`window.umami` exists. The browser probe reproduced a missing custom-event
request on a cold return page, while the tracker accepted the same payload once
ready. If the authenticated rerun shows the same gap, queue `trackEvent` calls
until the tracker is ready (or load the tracker before mounting the app), then
republish before repeating verification.