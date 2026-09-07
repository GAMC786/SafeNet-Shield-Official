import { trackEvent } from "@/lib/analytics";

export type SubscriptionCheckoutReturnOutcome = "success" | "canceled";

export function trackSubscriptionCheckoutReturn(
  result: string | null,
): SubscriptionCheckoutReturnOutcome | null {
  if (result !== "success" && result !== "canceled") return null;

  trackEvent("subscription_checkout_returned", {
    outcome: result,
    location: "settings_subscription",
  });
  return result;
}