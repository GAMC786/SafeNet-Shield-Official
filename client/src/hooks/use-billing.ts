import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { apiFetch } from "@/lib/api";
import { useRef } from "react";
import {
  getBillingAction,
  shouldPollForCheckoutConvergence,
} from "@/lib/billing-state";
import { trackEvent } from "@/lib/analytics";

export { getBillingAction, shouldPollForCheckoutConvergence } from "@/lib/billing-state";

export function useSubscriptionStatus(enabled = true) {
  const convergenceDeadline = useRef(Date.now() + 2 * 60 * 1000);
  const returningFromCheckout = typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("subscription") === "success";
  return useQuery({
    queryKey: [api.billing.status.path],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(api.billing.status.path, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("Could not load subscription status.");
      return api.billing.status.responses[200].parse(await response.json());
    },
    refetchInterval: (query) =>
      shouldPollForCheckoutConvergence({
        returningFromCheckout,
        entitled: query.state.data?.entitled,
        now: Date.now(),
        deadline: convergenceDeadline.current,
      })
        ? 3000
        : false,
  });
}

async function openBillingUrl(path: string, eventName: string) {
  const response = await apiFetch(path, { method: "POST" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Billing could not be opened.");
  trackEvent(eventName, { location: "settings_subscription" });
  window.location.assign(body.url);
}

export function startCheckout() {
  return openBillingUrl(api.billing.checkout.path, "subscription_checkout_started");
}

export function useStartCheckout() {
  return useMutation({
    mutationFn: startCheckout,
  });
}

export function openBillingPortal() {
  return openBillingUrl(api.billing.portal.path, "billing_portal_opened");
}

export function useOpenBillingPortal() {
  return useMutation({
    mutationFn: openBillingPortal,
  });
}