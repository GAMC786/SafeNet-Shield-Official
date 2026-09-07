import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

type AnalyticsCall = {
  name: string;
  data?: Record<string, string | number | boolean>;
};

const analyticsCalls: AnalyticsCall[] = [];
const navigations: string[] = [];
const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: unknown }).window;

function installBrowserBoundary() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      location: {
        assign(url: string) {
          navigations.push(url);
        },
      },
      umami: {
        track(name: string, data?: Record<string, string | number | boolean>) {
          analyticsCalls.push({ name, data });
        },
      },
    },
  });
}

function mockBillingResponse(status: number, body: unknown) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  analyticsCalls.length = 0;
  navigations.length = 0;
  installBrowserBoundary();
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("successful checkout creation navigates and emits only the checkout-start event", async () => {
  const { startCheckout } = await import("../client/src/hooks/use-billing");
  mockBillingResponse(200, { url: "https://checkout.stripe.test/session_123" });

  await startCheckout();

  assert.deepEqual(navigations, ["https://checkout.stripe.test/session_123"]);
  assert.deepEqual(analyticsCalls, [{
    name: "subscription_checkout_started",
    data: { location: "settings_subscription" },
  }]);
});

test("successful billing portal creation navigates and emits only the portal-open event", async () => {
  const { openBillingPortal } = await import("../client/src/hooks/use-billing");
  mockBillingResponse(200, { url: "https://billing.stripe.test/session_456" });

  await openBillingPortal();

  assert.deepEqual(navigations, ["https://billing.stripe.test/session_456"]);
  assert.deepEqual(analyticsCalls, [{
    name: "billing_portal_opened",
    data: { location: "settings_subscription" },
  }]);
});

test("failed billing requests do not emit start or open events", async () => {
  const { openBillingPortal, startCheckout } = await import("../client/src/hooks/use-billing");
  mockBillingResponse(503, { message: "Stripe billing is not configured." });

  await assert.rejects(startCheckout(), /Stripe billing is not configured/);
  await assert.rejects(openBillingPortal(), /Stripe billing is not configured/);

  assert.deepEqual(analyticsCalls, []);
  assert.deepEqual(navigations, []);
});

test("successful and canceled checkout returns emit privacy-safe outcome events", async () => {
  const { trackSubscriptionCheckoutReturn } = await import("../client/src/lib/billing-analytics");

  assert.equal(trackSubscriptionCheckoutReturn("success"), "success");
  assert.equal(trackSubscriptionCheckoutReturn("canceled"), "canceled");

  assert.deepEqual(analyticsCalls, [
    {
      name: "subscription_checkout_returned",
      data: { outcome: "success", location: "settings_subscription" },
    },
    {
      name: "subscription_checkout_returned",
      data: { outcome: "canceled", location: "settings_subscription" },
    },
  ]);
});