import { ensureSafeNetStripeSetup } from "../server/stripe-setup";

const { price, portalConfiguration } = await ensureSafeNetStripeSetup();
console.log(`SafeNet Monthly is ready at $5 USD/month (${price.id}).`);
console.log(`SafeNet billing portal is ready (${portalConfiguration.id}).`);