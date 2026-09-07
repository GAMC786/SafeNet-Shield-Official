import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

export class StripeUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StripeUnavailableError";
  }
}

export function isStripeUnavailableError(error: unknown): error is StripeUnavailableError {
  return error instanceof StripeUnavailableError;
}

export function getStripeConnectionAuthHeader(env: NodeJS.ProcessEnv = process.env) {
  // A published app can inherit REPL_IDENTITY from its source repl while also
  // receiving the deployment-scoped WEB_REPL_RENEWAL token. Prefer the latter
  // in production so the connector resolves the published environment.
  if (env.NODE_ENV === "production" && env.WEB_REPL_RENEWAL) {
    return `depl ${env.WEB_REPL_RENEWAL}`;
  }
  if (env.REPL_IDENTITY) {
    return `repl ${env.REPL_IDENTITY}`;
  }
  if (env.WEB_REPL_RENEWAL) {
    return `depl ${env.WEB_REPL_RENEWAL}`;
  }
  return null;
}

async function getStripeCredentials(): Promise<{ secretKey: string; webhookSecret?: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const token = getStripeConnectionAuthHeader();
  if (!hostname || !token) {
    throw new StripeUnavailableError("Stripe connection environment is unavailable.");
  }

  let response: Response;
  try {
    response = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
      {
        headers: { Accept: "application/json", X_REPLIT_TOKEN: token },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    throw new StripeUnavailableError("Stripe connection request failed.", { cause: error });
  }

  if (!response.ok) {
    throw new StripeUnavailableError(`Stripe connection request failed (${response.status}).`);
  }
  const body = await response.json() as {
    items?: Array<{ settings?: { secret?: string; secret_key?: string; webhook_secret?: string } }>;
  };
  const settings = body.items?.[0]?.settings;
  const secretKey = settings?.secret ?? settings?.secret_key;
  if (!secretKey) {
    throw new StripeUnavailableError("Stripe is not connected.");
  }
  return { secretKey, webhookSecret: settings?.webhook_secret };
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeSync() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Stripe.");
  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: process.env.DATABASE_URL },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
    revalidateObjectsViaStripeApi: ["subscription"],
    backfillRelatedEntities: true,
  });
}