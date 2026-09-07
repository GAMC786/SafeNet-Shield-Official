import type { Express } from "express";
import express from "express";
import { getStripeSync } from "./stripeClient";
import { isStripeReady } from "./stripe-init";

export function registerStripeWebhook(
  app: Express,
  options: {
    isStripeReady?: () => boolean;
    getStripeSync?: typeof getStripeSync;
  } = {},
) {
  const stripeReady = options.isStripeReady ?? isStripeReady;
  const createStripeSync = options.getStripeSync ?? getStripeSync;
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripeReady()) {
      return res.status(503).json({ message: "Stripe billing is not configured." });
    }
    const signature = req.headers["stripe-signature"];
    if (!signature || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ message: "Invalid Stripe webhook." });
    }
    try {
      const sync = await createStripeSync();
      await sync.processWebhook(req.body, Array.isArray(signature) ? signature[0] : signature);
      return res.json({ received: true });
    } catch (error) {
      console.error("Stripe webhook processing failed:", error);
      return res.status(400).json({ message: "Stripe webhook could not be verified." });
    }
  });
}