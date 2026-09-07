import { runMigrations } from "stripe-replit-sync";
import { getStripeSync, isStripeUnavailableError } from "./stripeClient";
import { pool } from "./db";
import { ensureSafeNetStripeSetup } from "./stripe-setup";

let stripeReady = false;

export function isStripeReady() {
  return stripeReady;
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
    await ensureSafeNetStripeSetup();
    const sync = await getStripeSync();
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (!domain) throw new Error("REPLIT_DOMAINS is required to configure Stripe webhooks.");
    await sync.findOrCreateManagedWebhook(`https://${domain}/api/stripe/webhook`);
    await sync.syncBackfill();
    stripeReady = true;
  } catch (error) {
    if (isStripeUnavailableError(error)) {
      console.warn(`Stripe billing is unavailable; continuing without billing: ${error.message}`);
    } else {
      console.error("Stripe billing initialization skipped:", error);
    }
  }
}