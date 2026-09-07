import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { StripeSync } from "stripe-replit-sync";
import {
  STRIPE_STARTUP_LOCK_KEY,
  synchronizeStripeStartup,
} from "./stripe-init";

type StartupSync = Pick<StripeSync, "findOrCreateManagedWebhook" | "syncBackfill"> & {
  stripe: Stripe;
  postgresClient: Pick<StripeSync["postgresClient"], "withAdvisoryLock">;
};

function createSharedLock() {
  let tail = Promise.resolve();

  return async function withAdvisoryLock<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    assert.equal(key, STRIPE_STARTUP_LOCK_KEY);
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

test("concurrent Stripe startups serialize setup, webhook reconciliation, and backfill", async () => {
  const withAdvisoryLock = createSharedLock();
  const calls: string[] = [];
  let managedWebhookExists = false;
  let webhookCreates = 0;
  let activeBackfills = 0;
  let maximumActiveBackfills = 0;

  const createSync = (): StartupSync => ({
    stripe: {} as Stripe,
    postgresClient: { withAdvisoryLock },
    findOrCreateManagedWebhook: async () => {
      calls.push("webhook:inspect");
      await Promise.resolve();
      if (!managedWebhookExists) {
        managedWebhookExists = true;
        webhookCreates += 1;
      }
      calls.push("webhook:reconciled");
    },
    syncBackfill: async (params) => {
      assert.deepEqual(params, { object: "all" });
      activeBackfills += 1;
      maximumActiveBackfills = Math.max(maximumActiveBackfills, activeBackfills);
      calls.push("backfill:start");
      await new Promise((resolve) => setTimeout(resolve, 1));
      calls.push("backfill:end");
      activeBackfills -= 1;
      return {};
    },
  });

  await Promise.all([
    synchronizeStripeStartup(
      createSync() as StripeSync,
      "https://safenet.example/api/stripe/webhook",
      async () => {
        calls.push("setup");
      },
    ),
    synchronizeStripeStartup(
      createSync() as StripeSync,
      "https://safenet.example/api/stripe/webhook",
      async () => {
        calls.push("setup");
      },
    ),
  ]);

  assert.equal(webhookCreates, 1);
  assert.equal(maximumActiveBackfills, 1);
  assert.deepEqual(calls, [
    "setup",
    "webhook:inspect",
    "webhook:reconciled",
    "backfill:start",
    "backfill:end",
    "setup",
    "webhook:inspect",
    "webhook:reconciled",
    "backfill:start",
    "backfill:end",
  ]);
});