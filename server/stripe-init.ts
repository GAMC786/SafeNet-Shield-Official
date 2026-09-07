import type Stripe from "stripe";
import { runMigrations, type StripeSync } from "stripe-replit-sync";
import { getStripeSync, isStripeUnavailableError } from "./stripeClient";
import { pool } from "./db";
import { ensureSafeNetStripeSetup } from "./stripe-setup";

export const STRIPE_STARTUP_LOCK_KEY = "safenet:stripe-startup";

let stripeReady = false;

export function isStripeReady() {
  return stripeReady;
}

type StripeSetup = (stripe: Stripe) => Promise<unknown>;

export async function synchronizeStripeStartup(
  sync: StripeSync,
  webhookUrl: string,
  setup: StripeSetup = (stripe) => ensureSafeNetStripeSetup(stripe),
) {
  await sync.postgresClient.withAdvisoryLock(STRIPE_STARTUP_LOCK_KEY, async () => {
    await setup(sync.stripe);
    await sync.findOrCreateManagedWebhook(webhookUrl);
    await sync.syncBackfill({ object: "all" });
  });
}

export async function initializeStripe() {
  stripeReady = false;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Stripe.");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_accounts (
      clerk_user_id TEXT PRIMARY KEY,
      stripe_customer_id TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await runMigrations({ databaseUrl: process.env.DATABASE_URL });

  try {
    const sync = await getStripeSync();
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (!domain) throw new Error("REPLIT_DOMAINS is required to configure Stripe webhooks.");
    await synchronizeStripeStartup(sync, `https://${domain}/api/stripe/webhook`);
    stripeReady = true;
  } catch (error) {
    if (isStripeUnavailableError(error)) {
      console.warn(`Stripe billing is unavailable; continuing without billing: ${error.message}`);
    } else {
      console.error("Stripe billing initialization skipped:", error);
    }
  }
}