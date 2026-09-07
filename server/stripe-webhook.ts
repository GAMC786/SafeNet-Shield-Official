import type { Express } from "express";
import express from "express";
import { getStripeSync } from "./stripeClient";

export function registerStripeWebhook(app: Express) {
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ message: "Invalid Stripe webhook." });
    }
    try {
      const sync = await getStripeSync();
      await sync.processWebhook(req.body, Array.isArray(signature) ? signature[0] : signature);
      return res.json({ received: true });
    } catch (error) {
      console.error("Stripe webhook processing failed:", error);
      return res.status(400).json({ message: "Stripe webhook could not be verified." });
    }
  });
}