import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  ensureSafeNetStripeSetup,
  isSafeNetPrice,
  SAFENET_PORTAL_PURPOSE,
  SAFENET_PRICE_LOOKUP_KEY,
} from "./stripe-setup";

function safeNetPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
  return {
    id: "price_safenet",
    object: "price",
    active: true,
    billing_scheme: "per_unit",
    created: 1,
    currency: "usd",
    custom_unit_amount: null,
    livemode: false,
    lookup_key: SAFENET_PRICE_LOOKUP_KEY,
    metadata: {},
    nickname: null,
    product: "prod_safenet",
    recurring: {
      interval: "month",
      interval_count: 1,
      meter: null,
      trial_period_days: null,
      usage_type: "licensed",
    },
    tax_behavior: null,
    tiers_mode: null,
    transform_quantity: null,
    type: "recurring",
    unit_amount: 500,
    unit_amount_decimal: "500",
    ...overrides,
  };
}

test("SafeNet entitlement price validation rejects lookalike plans", () => {
  assert.equal(isSafeNetPrice(safeNetPrice()), true);
  assert.equal(isSafeNetPrice(safeNetPrice({ unit_amount: 600 })), false);
  assert.equal(isSafeNetPrice(safeNetPrice({ currency: "cad" })), false);
  assert.equal(isSafeNetPrice(safeNetPrice({ lookup_key: "other_plan" })), false);
});

test("fresh Stripe accounts are provisioned with the exact price and restricted portal", async () => {
  const calls: Array<{ operation: string; input: unknown }> = [];
  const createdPrice = safeNetPrice();
  const createdPortal = {
    id: "bpc_safenet",
    metadata: { purpose: SAFENET_PORTAL_PURPOSE },
  } as Stripe.BillingPortal.Configuration;
  const stripe = {
    prices: {
      list: async () => ({ data: [] }),
      create: async (input: unknown) => {
        calls.push({ operation: "price", input });
        return createdPrice;
      },
    },
    products: {
      create: async (input: unknown) => {
        calls.push({ operation: "product", input });
        return { id: "prod_safenet" };
      },
    },
    billingPortal: {
      configurations: {
        list: async () => ({ data: [] }),
        create: async (input: unknown) => {
          calls.push({ operation: "portal", input });
          return createdPortal;
        },
      },
    },
  } as unknown as Stripe;

  const result = await ensureSafeNetStripeSetup(stripe);

  assert.equal(result.price.id, createdPrice.id);
  assert.equal(result.portalConfiguration.id, createdPortal.id);
  assert.deepEqual(calls.map((call) => call.operation), ["product", "price", "portal"]);
  const priceInput = calls.find((call) => call.operation === "price")?.input as {
    unit_amount: number;
    currency: string;
    recurring: { interval: string };
    lookup_key: string;
  };
  assert.deepEqual(priceInput, {
    product: "prod_safenet",
    currency: "usd",
    unit_amount: 500,
    recurring: { interval: "month" },
    lookup_key: SAFENET_PRICE_LOOKUP_KEY,
  });
  const portalInput = calls.find((call) => call.operation === "portal")?.input as {
    features: { payment_method_update: { enabled: boolean }; subscription_cancel: { enabled: boolean; mode: string } };
    metadata: { purpose: string };
  };
  assert.equal(portalInput.features.payment_method_update.enabled, true);
  assert.deepEqual(portalInput.features.subscription_cancel, { enabled: true, mode: "at_period_end" });
  assert.equal(portalInput.metadata.purpose, SAFENET_PORTAL_PURPOSE);
});