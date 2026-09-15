import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  stripeCustomers,
  stripeSubscriptions,
  stripeWebhookEvents,
} from "@shared/schema";

const billingEmailSchema = z.object({
  email: z.string().trim().email().max(320),
});

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Stripe is not configured: STRIPE_SECRET_KEY is missing.");
  }
  return new Stripe(secretKey);
}

function getPublicUrl(req: Request) {
  return (
    process.env.APP_PUBLIC_URL?.replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host")}`
  );
}

function getTrialDays() {
  const value = Number.parseInt(process.env.STRIPE_TRIAL_DAYS ?? "7", 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 365)) : 7;
}

function getPriceId() {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error("Stripe is not configured: STRIPE_PRICE_ID is missing.");
  }
  return priceId;
}

async function upsertCustomer(customerId: string, email?: string | null) {
  await db
    .insert(stripeCustomers)
    .values({
      stripeCustomerId: customerId,
      email: email ?? null,
    })
    .onConflictDoUpdate({
      target: stripeCustomers.stripeCustomerId,
      set: {
        email: email ?? null,
        updatedAt: new Date(),
      },
    });
}

async function upsertSubscription(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const item = subscription.items.data[0];
  const currentPeriodEnd =
    typeof item?.current_period_end === "number"
      ? new Date(item.current_period_end * 1000)
      : null;

  await upsertCustomer(customerId);
  await db
    .insert(stripeSubscriptions)
    .values({
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
      priceId: item?.price.id ?? null,
      status: subscription.status,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: stripeSubscriptions.stripeSubscriptionId,
      set: {
        stripeCustomerId: customerId,
        priceId: item?.price.id ?? null,
        status: subscription.status,
        trialEnd: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date(),
      },
    });
}

async function processStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      if (customerId) {
        await upsertCustomer(customerId, session.customer_details?.email);
      }
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertSubscription(event.data.object as Stripe.Subscription);
      return;
    case "invoice.paid":
    case "invoice.payment_failed":
      // Subscription status is kept authoritative by subscription events.
      return;
    default:
      return;
  }
}

export async function handleStripeWebhook(req: Request, res: Response) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers["stripe-signature"];
  if (!webhookSecret || typeof signature !== "string") {
    return res.status(400).json({ message: "Stripe webhook configuration is incomplete." });
  }
  if (!Buffer.isBuffer(req.body)) {
    return res.status(500).json({ message: "Stripe webhook body was not received as raw data." });
  }

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret,
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return res.status(400).json({ message: "Invalid Stripe webhook signature." });
  }

  const inserted = await db
    .insert(stripeWebhookEvents)
    .values({ eventId: event.id, eventType: event.type })
    .onConflictDoNothing()
    .returning({ eventId: stripeWebhookEvents.eventId });
  if (inserted.length === 0) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    await processStripeEvent(event);
    return res.json({ received: true });
  } catch (error) {
    await db.delete(stripeWebhookEvents).where(eq(stripeWebhookEvents.eventId, event.id));
    console.error("Stripe webhook processing failed:", error);
    return res.status(500).json({ message: "Stripe webhook processing failed." });
  }
}

export function registerStripeWebhookRoute(app: Express) {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    (req, res) => {
      void handleStripeWebhook(req, res);
    },
  );
}

export function registerStripeRoutes(app: Express) {
  app.get("/api/billing/config", (_req, res) => {
    res.json({
      configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID),
      productName: "SafeNet Shield DNS Server+",
      amount: 500,
      currency: "cad",
      interval: "month",
      trialDays: getTrialDays(),
    });
  });

  app.post("/api/billing/checkout", async (req, res) => {
    const parsed = billingEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "A valid email address is required." });
    }

    try {
      const stripe = getStripeClient();
      const trialDays = getTrialDays();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: parsed.data.email,
        line_items: [{ price: getPriceId(), quantity: 1 }],
        allow_promotion_codes: true,
        subscription_data: trialDays > 0
          ? { trial_period_days: trialDays }
          : undefined,
        success_url: `${getPublicUrl(req)}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${getPublicUrl(req)}/billing?checkout=cancelled`,
      });
      return res.json({ url: session.url });
    } catch (error) {
      console.error("Stripe Checkout session creation failed:", error);
      return res.status(502).json({
        message: error instanceof Error ? error.message : "Unable to start Stripe Checkout.",
      });
    }
  });

}