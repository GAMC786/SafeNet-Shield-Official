import type Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";

export const SAFENET_PRICE_LOOKUP_KEY = "safenet_monthly";
export const SAFENET_PORTAL_PURPOSE = "safenet_subscription_management";

export function isSafeNetPrice(price: Stripe.Price) {
  return price.active &&
    price.lookup_key === SAFENET_PRICE_LOOKUP_KEY &&
    price.unit_amount === 500 &&
    price.currency === "usd" &&
    price.recurring?.interval === "month";
}

export async function getSafeNetPrice(stripe: Stripe) {
  const prices = await stripe.prices.list({
    active: true,
    lookup_keys: [SAFENET_PRICE_LOOKUP_KEY],
    limit: 1,
  });
  const price = prices.data[0];
  if (!price || !isSafeNetPrice(price)) {
    throw new Error("SafeNet's $5 monthly Stripe price is not configured.");
  }
  return price;
}

export async function getSafeNetPortalConfiguration(stripe: Stripe) {
  const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const configuration = configurations.data.find(
    (candidate) => candidate.metadata?.purpose === SAFENET_PORTAL_PURPOSE,
  );
  if (!configuration) {
    throw new Error("SafeNet's Stripe billing portal is not configured.");
  }
  return configuration;
}

export async function ensureSafeNetStripeSetup(stripeClient?: Stripe) {
  const stripe = stripeClient ?? await getUncachableStripeClient();
  let price: Stripe.Price;
  try {
    price = await getSafeNetPrice(stripe);
  } catch {
    const product = await stripe.products.create({
      name: "SafeNet Monthly",
      description: "Monthly access to SafeNet DNS protection and security features.",
      metadata: { app: "safenet", plan: "monthly" },
    }, { idempotencyKey: "safenet-monthly-product-v1" });
    price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: 500,
      recurring: { interval: "month" },
      lookup_key: SAFENET_PRICE_LOOKUP_KEY,
    }, { idempotencyKey: "safenet-monthly-price-v1" });
  }

  let portalConfiguration: Stripe.BillingPortal.Configuration;
  try {
    portalConfiguration = await getSafeNetPortalConfiguration(stripe);
  } catch {
    portalConfiguration = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: "Manage your SafeNet subscription",
        privacy_policy_url: "https://safenetinc.ca/privacy",
        terms_of_service_url: "https://safenetinc.ca/terms",
      },
      features: {
        customer_update: { enabled: false },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
        subscription_update: { enabled: false },
      },
      metadata: { app: "safenet", purpose: SAFENET_PORTAL_PURPOSE },
    }, { idempotencyKey: "safenet-billing-portal-v1" });
  }

  return { price, portalConfiguration };
}