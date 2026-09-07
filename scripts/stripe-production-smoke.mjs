import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 10_000;

function parseBaseUrl(value) {
  if (!value) {
    throw new Error("STRIPE_SMOKE_BASE_URL is required.");
  }

  let baseUrl;
  try {
    baseUrl = new URL(value);
  } catch {
    throw new Error("STRIPE_SMOKE_BASE_URL must be a valid HTTP(S) URL.");
  }

  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("STRIPE_SMOKE_BASE_URL must use HTTP or HTTPS.");
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error("STRIPE_SMOKE_BASE_URL must not include URL credentials.");
  }

  return baseUrl;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function runStripeProductionSmoke({
  baseUrl: configuredBaseUrl = process.env.STRIPE_SMOKE_BASE_URL,
  fetchImpl = fetch,
} = {}) {
  const baseUrl = parseBaseUrl(configuredBaseUrl);
  const healthUrl = new URL("/api/stripe/health", baseUrl);
  const webhookUrl = new URL("/api/stripe/webhook", baseUrl);
  const requestOptions = {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };

  let healthResponse;
  try {
    healthResponse = await fetchImpl(healthUrl, {
      ...requestOptions,
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Stripe billing readiness check could not reach the published deployment.");
  }

  const healthBody = await readJson(healthResponse);
  if (healthResponse.status !== 200 || healthBody?.ready !== true) {
    throw new Error(
      `Stripe billing readiness check failed with HTTP ${healthResponse.status}. ` +
      "Published billing is unavailable.",
    );
  }

  let webhookResponse;
  try {
    webhookResponse = await fetchImpl(webhookUrl, {
      ...requestOptions,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "safenet.billing.smoke" }),
    });
  } catch {
    throw new Error("Stripe webhook reachability check could not reach the published deployment.");
  }

  const webhookBody = await readJson(webhookResponse);
  if (
    webhookResponse.status !== 400 ||
    webhookBody?.message !== "Invalid Stripe webhook."
  ) {
    throw new Error(
      `Stripe webhook reachability check expected HTTP 400 for an unsigned request, ` +
      `but received HTTP ${webhookResponse.status}.`,
    );
  }

  return { billingReady: true, webhookUnsignedRequestStatus: 400 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runStripeProductionSmoke();
    console.log("Stripe production smoke passed: billing is ready and unsigned webhook requests are rejected.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected Stripe smoke failure.";
    console.error(`Stripe production smoke failed: ${message}`);
    process.exitCode = 1;
  }
}