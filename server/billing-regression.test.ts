import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import session from "express-session";
import type Stripe from "stripe";
import type { IStorage } from "./storage";
import type { SubscriptionStatus } from "@shared/schema";

process.env.DATABASE_URL ??= "postgres://billing-regression-test";

const safeNetPrice = {
  id: "price_safenet",
  active: true,
  currency: "usd",
  lookup_key: "safenet_monthly",
  recurring: {
    interval: "month",
    interval_count: 1,
  },
  unit_amount: 500,
} as unknown as Stripe.Price;

function createBillingStorage(
  status: SubscriptionStatus | (() => SubscriptionStatus),
  account: { clerkUserId: string; stripeCustomerId: string } | undefined = undefined,
) {
  let billingAccount = account;
  return {
    getSettings: async () => ({ isPinEnabled: false }),
    getBillingAccount: async () => billingAccount,
    saveBillingAccount: async (clerkUserId: string, stripeCustomerId: string) => {
      billingAccount = { clerkUserId, stripeCustomerId };
      return billingAccount;
    },
    getSubscriptionStatus: async () => typeof status === "function" ? status() : status,
  } as unknown as IStorage;
}

async function startTestServer(
  register: (app: express.Express, httpServer: ReturnType<typeof createServer>) => Promise<void>,
) {
  const app = express();
  const httpServer = createServer(app);
  app.use(session({
    secret: "billing-regression-test",
    resave: false,
    saveUninitialized: false,
  }));
  await register(app, httpServer);
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function checkoutRequest(baseUrl: string) {
  return fetch(`${baseUrl}/api/billing/checkout`, {
    method: "POST",
    headers: { Origin: "http://127.0.0.1" },
  });
}

test("concurrent checkout requests reuse one open Checkout Session", async () => {
  const { registerRoutes } = await import("./routes");
  const storage = createBillingStorage(
    {
      signedIn: true,
      entitled: false,
      status: "none",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      priceLabel: "$5 USD / month",
    },
  );
  const openSessions: Array<{ client_reference_id: string; url: string }> = [];
  const createdInputs: Array<{ input: unknown; idempotencyKey?: string }> = [];
  let customerCreates = 0;
  let checkoutCreates = 0;
  const stripe = {
    prices: { list: async () => ({ data: [safeNetPrice] }) },
    customers: {
      create: async () => {
        customerCreates += 1;
        return { id: "cus_safenet" };
      },
    },
    subscriptions: { list: async () => ({ data: [] }) },
    checkout: {
      sessions: {
        list: async () => ({ data: openSessions }),
        create: async (input: unknown, options: { idempotencyKey?: string }) => {
          checkoutCreates += 1;
          createdInputs.push({ input, idempotencyKey: options.idempotencyKey });
          const session = {
            client_reference_id: "user_123",
            url: "https://checkout.stripe.test/session_123",
          };
          openSessions.push(session);
          return session;
        },
      },
    },
  } as unknown as Stripe;

  let lockTail = Promise.resolve();
  const withCheckoutLock = async <T>(userId: string, operation: () => Promise<T>) => {
    assert.equal(userId, "user_123");
    const previous = lockTail;
    let release!: () => void;
    lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const server = await startTestServer(async (app, httpServer) => {
    await registerRoutes(httpServer, app, storage, {
      seed: false,
      billing: {
        isStripeReady: () => true,
        getStripeClient: async () => stripe,
        getBillingUserId: () => "user_123",
        withCheckoutLock,
        baseUrl: "https://safenet.test",
      },
    });
  });

  try {
    const responses = await Promise.all([
      checkoutRequest(server.baseUrl),
      checkoutRequest(server.baseUrl),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    const payloads = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(payloads, [
      { url: "https://checkout.stripe.test/session_123" },
      { url: "https://checkout.stripe.test/session_123" },
    ]);
    assert.equal(customerCreates, 1);
    assert.equal(checkoutCreates, 1);
    assert.deepEqual(createdInputs[0], {
      input: {
        mode: "subscription",
        customer: "cus_safenet",
        line_items: [{ price: "price_safenet", quantity: 1 }],
        success_url: "https://safenet.test/settings?subscription=success&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://safenet.test/settings?subscription=canceled",
        client_reference_id: "user_123",
        subscription_data: { metadata: { clerkUserId: "user_123", plan: "safenet_monthly" } },
        allow_promotion_codes: false,
      },
      idempotencyKey: createdInputs[0].idempotencyKey,
    });
    assert.match(createdInputs[0].idempotencyKey ?? "", /^safenet-checkout-user_123-\d+$/);
  } finally {
    await server.close();
  }
});

test("subscription lifecycle states expose the expected access and recovery action", async () => {
  const { registerRoutes } = await import("./routes");
  const { getBillingAction } = await import("../client/src/lib/billing-state");
  let status: SubscriptionStatus = {
    signedIn: true,
    entitled: true,
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    priceLabel: "$5 USD / month",
  };
  const storage = createBillingStorage(() => status, {
    clerkUserId: "user_123",
    stripeCustomerId: "cus_safenet",
  });
  const server = await startTestServer(async (app, httpServer) => {
    await registerRoutes(httpServer, app, storage, {
      seed: false,
      billing: {
        isStripeReady: () => true,
        getBillingUserId: () => "user_123",
      },
    });
  });

  try {
    const readStatus = async () => {
      const response = await fetch(`${server.baseUrl}/api/billing/status`);
      assert.equal(response.status, 200);
      return response.json() as Promise<SubscriptionStatus>;
    };

    assert.deepEqual(await readStatus(), status);
    assert.equal(getBillingAction(status.status), "portal");

    status = { ...status, entitled: false, status: "past_due" };
    assert.deepEqual(await readStatus(), status);
    assert.equal(getBillingAction(status.status), "portal");

    status = { ...status, entitled: true, status: "active", cancelAtPeriodEnd: true };
    assert.deepEqual(await readStatus(), status);
    assert.equal(getBillingAction(status.status), "portal");

    status = { ...status, entitled: false, status: "canceled", cancelAtPeriodEnd: false };
    assert.deepEqual(await readStatus(), status);
    assert.equal(getBillingAction(status.status), "checkout");

    status = { ...status, entitled: true, status: "active" };
    assert.deepEqual(await readStatus(), status);
    assert.equal(getBillingAction(status.status), "portal");
  } finally {
    await server.close();
  }
});

test("checkout status polling stops when delayed webhook data converges", async () => {
  const { shouldPollForCheckoutConvergence } = await import("../client/src/lib/billing-state");
  const deadline = 200;
  assert.equal(shouldPollForCheckoutConvergence({
    returningFromCheckout: true,
    entitled: false,
    now: 100,
    deadline,
  }), true);
  assert.equal(shouldPollForCheckoutConvergence({
    returningFromCheckout: true,
    entitled: true,
    now: 100,
    deadline,
  }), false);
  assert.equal(shouldPollForCheckoutConvergence({
    returningFromCheckout: true,
    entitled: false,
    now: deadline,
    deadline,
  }), false);
});

test("Stripe webhook rejects an invalid signature and accepts a verified event", async () => {
  const { registerStripeWebhook } = await import("./stripe-webhook");
  const processed: Array<{ payload: Buffer; signature: string }> = [];
  const server = await startTestServer(async (app) => {
    registerStripeWebhook(app, {
      isStripeReady: () => true,
      getStripeSync: async () => ({
        processWebhook: async (payload: Buffer, signature: string) => {
          if (signature !== "valid-signature") throw new Error("signature mismatch");
          processed.push({ payload, signature });
        },
      } as never),
    });
  });

  try {
    const invalid = await fetch(`${server.baseUrl}/api/stripe/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "invalid-signature",
      },
      body: JSON.stringify({ type: "customer.subscription.updated" }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { message: "Stripe webhook could not be verified." });
    assert.equal(processed.length, 0);

    const validPayload = JSON.stringify({ type: "customer.subscription.updated" });
    const valid = await fetch(`${server.baseUrl}/api/stripe/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "valid-signature",
      },
      body: validPayload,
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { received: true });
    assert.equal(processed.length, 1);
    assert.equal(processed[0].payload.toString(), validPayload);
  } finally {
    await server.close();
  }
});