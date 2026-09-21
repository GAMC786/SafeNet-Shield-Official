import type { Express, Request, Response } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { getRequestUserId, requireAuth } from "./auth";

const connectors = new ReplitConnectors();
const REVENUECAT_BASE_PATH = "/v2";
const DEFAULT_ENTITLEMENT_IDENTIFIER = "premium";
const ANDROID_PACKAGE_NAME = "com.safenet.dns";
const ANDROID_PRODUCT_IDENTIFIER = "premium_monthly:monthly";
const ANDROID_PACKAGE_IDENTIFIER = "$rc_monthly";
const DEFAULT_OFFERING_IDENTIFIER = "default";
const BILLING_PREFLIGHT_TIMEOUT_MS = 12_000;

type RevenueCatConfig = {
  projectId: string | null;
  entitlementIdentifier: string;
  configured: boolean;
};

type RevenueCatCollection = {
  items?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type RevenueCatRequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
};

type BillingPreflightChecks = {
  googlePlayApp: boolean;
  googlePlayProduct: boolean;
  entitlement: boolean;
  offering: boolean;
};

class RevenueCatError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message);
    this.name = "RevenueCatError";
  }
}

function getRevenueCatConfig(): RevenueCatConfig {
  const projectId = process.env.REVENUECAT_PROJECT_ID?.trim() || null;
  const entitlementIdentifier =
    process.env.REVENUECAT_ENTITLEMENT_IDENTIFIER?.trim() ||
    DEFAULT_ENTITLEMENT_IDENTIFIER;

  return {
    projectId,
    entitlementIdentifier,
    configured: Boolean(projectId),
  };
}

async function requestRevenueCat<T>(
  path: string,
  options: RevenueCatRequestOptions = {},
): Promise<T> {
  const response = await connectors.proxy("revenuecat", `${REVENUECAT_BASE_PATH}${path}`, {
    method: options.method,
    body: options.body,
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    throw new RevenueCatError(
      `RevenueCat returned an unreadable response (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : `HTTP ${response.status}`;
    throw new RevenueCatError(`RevenueCat rejected the request: ${detail}`, response.status);
  }

  return payload as T;
}

function requireProjectId(config: RevenueCatConfig): string {
  if (!config.projectId) {
    throw new RevenueCatError(
      "RevenueCat is not configured. Set REVENUECAT_PROJECT_ID before using billing.",
      503,
    );
  }
  return config.projectId;
}

function customerIdForUser(userId: string): string {
  return userId;
}

function collectionItems(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return [];
  const items = (payload as RevenueCatCollection).items;
  return Array.isArray(items)
    ? items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}

function stringValue(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof item[key] === "string" && item[key]) return item[key] as string;
  }
  return null;
}

function booleanValue(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof item[key] === "boolean") return item[key] as boolean;
  }
  return null;
}

function hasIdentifier(item: Record<string, unknown>, identifier: string) {
  return [
    item.id,
    item.lookup_key,
    item.store_identifier,
    item.product_id,
    item.identifier,
  ].includes(identifier);
}

async function withBillingPreflightTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new RevenueCatError(
        "RevenueCat billing configuration preflight timed out before purchase.",
        504,
      )),
      BILLING_PREFLIGHT_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function runBillingPreflight(projectId: string, entitlementIdentifier: string) {
  const checks: BillingPreflightChecks = {
    googlePlayApp: false,
    googlePlayProduct: false,
    entitlement: false,
    offering: false,
  };

  let apps: RevenueCatCollection;
  let products: RevenueCatCollection;
  let entitlements: RevenueCatCollection;
  let offerings: RevenueCatCollection;
  try {
    [apps, products, entitlements, offerings] = await Promise.all([
      requestRevenueCat<RevenueCatCollection>(
        `/projects/${encodeURIComponent(projectId)}/apps?limit=100`,
      ),
      requestRevenueCat<RevenueCatCollection>(
        `/projects/${encodeURIComponent(projectId)}/products?limit=100`,
      ),
      requestRevenueCat<RevenueCatCollection>(
        `/projects/${encodeURIComponent(projectId)}/entitlements?limit=100`,
      ),
      requestRevenueCat<RevenueCatCollection>(
        `/projects/${encodeURIComponent(projectId)}/offerings?limit=100`,
      ),
    ]);
  } catch {
    throw new RevenueCatError(
      "RevenueCat billing configuration could not be read before purchase.",
      502,
    );
  }

  const playStoreApp = collectionItems(apps).find(
    (app) =>
      app.type === "play_store" &&
      (app.play_store as Record<string, unknown> | undefined)?.package_name === ANDROID_PACKAGE_NAME,
  );
  if (!playStoreApp) {
    return {
      ready: false,
      checks,
      message: `Billing configuration is missing the Google Play app for ${ANDROID_PACKAGE_NAME}.`,
    };
  }
  checks.googlePlayApp = true;

  const playProduct = collectionItems(products).find(
    (product) =>
      product.app_id === playStoreApp.id &&
      product.store_identifier === ANDROID_PRODUCT_IDENTIFIER &&
      product.type === "subscription" &&
      product.state === "active",
  );
  if (!playProduct) {
    return {
      ready: false,
      checks,
      message: `Billing configuration is missing the active Google Play subscription ${ANDROID_PRODUCT_IDENTIFIER}.`,
    };
  }

  try {
    await requestRevenueCat<unknown>(
      `/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(String(playProduct.id))}/store_state`,
    );
  } catch {
    return {
      ready: false,
      checks,
      message: `Google Play subscription ${ANDROID_PRODUCT_IDENTIFIER} is not available in Google Play yet.`,
    };
  }
  checks.googlePlayProduct = true;

  const entitlement = collectionItems(entitlements).find(
    (candidate) =>
      candidate.lookup_key === entitlementIdentifier &&
      entitlementIdentifier === DEFAULT_ENTITLEMENT_IDENTIFIER,
  );
  if (!entitlement) {
    return {
      ready: false,
      checks,
      message: `Billing configuration is missing the ${DEFAULT_ENTITLEMENT_IDENTIFIER} entitlement.`,
    };
  }

  try {
    const attachedProducts = await requestRevenueCat<RevenueCatCollection>(
      `/projects/${encodeURIComponent(projectId)}/entitlements/${encodeURIComponent(String(entitlement.id))}/products`,
    );
    if (!collectionItems(attachedProducts).some((item) => hasIdentifier(item, String(playProduct.id)) ||
      hasIdentifier(item, ANDROID_PRODUCT_IDENTIFIER))) {
      return {
        ready: false,
        checks,
        message: `The ${DEFAULT_ENTITLEMENT_IDENTIFIER} entitlement is not linked to ${ANDROID_PRODUCT_IDENTIFIER}.`,
      };
    }
  } catch {
    return {
      ready: false,
      checks,
      message: `The ${DEFAULT_ENTITLEMENT_IDENTIFIER} entitlement could not be verified before purchase.`,
    };
  }
  checks.entitlement = true;

  const activeOffering = collectionItems(offerings).find(
    (offering) =>
      offering.lookup_key === DEFAULT_OFFERING_IDENTIFIER &&
      offering.is_current === true,
  );
  if (!activeOffering) {
    return {
      ready: false,
      checks,
      message: `Billing configuration is missing the active ${ANDROID_PACKAGE_IDENTIFIER} offering.`,
    };
  }

  let packages: RevenueCatCollection;
  try {
    packages = await requestRevenueCat<RevenueCatCollection>(
      `/projects/${encodeURIComponent(projectId)}/offerings/${encodeURIComponent(String(activeOffering.id))}/packages?limit=100`,
    );
  } catch {
    return {
      ready: false,
      checks,
      message: `The active ${ANDROID_PACKAGE_IDENTIFIER} offering could not be read before purchase.`,
    };
  }
  const monthlyPackage = collectionItems(packages).find(
    (candidate) => candidate.lookup_key === ANDROID_PACKAGE_IDENTIFIER,
  );
  if (!monthlyPackage) {
    return {
      ready: false,
      checks,
      message: `Billing configuration is missing the active ${ANDROID_PACKAGE_IDENTIFIER} offering.`,
    };
  }

  try {
    const attachedProducts = await requestRevenueCat<RevenueCatCollection>(
      `/projects/${encodeURIComponent(projectId)}/packages/${encodeURIComponent(String(monthlyPackage.id))}/products`,
    );
    if (!collectionItems(attachedProducts).some((item) => hasIdentifier(item, String(playProduct.id)) ||
      hasIdentifier(item, ANDROID_PRODUCT_IDENTIFIER))) {
      return {
        ready: false,
        checks,
        message: `The active ${ANDROID_PACKAGE_IDENTIFIER} offering is not linked to ${ANDROID_PRODUCT_IDENTIFIER}.`,
      };
    }
  } catch {
    return {
      ready: false,
      checks,
      message: `The active ${ANDROID_PACKAGE_IDENTIFIER} offering could not be verified before purchase.`,
    };
  }
  checks.offering = true;

  return {
    ready: true,
    checks,
    packageName: ANDROID_PACKAGE_NAME,
    productIdentifier: ANDROID_PRODUCT_IDENTIFIER,
    entitlementIdentifier: DEFAULT_ENTITLEMENT_IDENTIFIER,
    offeringIdentifier: ANDROID_PACKAGE_IDENTIFIER,
  };
}

async function getActiveEntitlements(projectId: string, customerId: string) {
  return requestRevenueCat<RevenueCatCollection>(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/active_entitlements`,
  );
}

async function getSubscriptions(projectId: string, customerId: string) {
  return requestRevenueCat<RevenueCatCollection>(
    `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(customerId)}/subscriptions`,
  );
}

function isMatchingEntitlement(
  item: Record<string, unknown>,
  entitlementIdentifier: string,
) {
  return [
    item.lookup_key,
    item.entitlement_identifier,
    item.entitlement_id,
    item.id,
  ].includes(entitlementIdentifier);
}

export function registerRevenueCatRoutes(app: Express) {
  app.get("/api/billing/config", (_req, res) => {
    const config = getRevenueCatConfig();
    res.json({
      provider: "revenuecat",
      configured: config.configured,
      productName: "SafeNet Shield DNS Server+",
      entitlementIdentifier: config.entitlementIdentifier,
      purchaseMode: "mobile",
    });
  });

  app.get("/api/billing/status", requireAuth, async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Sign in is required to view billing status." });
      }

      const config = getRevenueCatConfig();
      const projectId = requireProjectId(config);
      const customerId = customerIdForUser(userId);

      let entitlements: RevenueCatCollection;
      try {
        entitlements = await getActiveEntitlements(projectId, customerId);
      } catch (error) {
        if (error instanceof RevenueCatError && error.statusCode === 404) {
          return res.json({
            provider: "revenuecat",
            linked: false,
            hasEntitlement: false,
            status: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          });
        }
        throw error;
      }

      const activeEntitlement = collectionItems(entitlements).find((item) =>
        isMatchingEntitlement(item, config.entitlementIdentifier),
      );

      return res.json({
        provider: "revenuecat",
        linked: true,
        hasEntitlement: Boolean(activeEntitlement),
        status: activeEntitlement ? "active" : null,
        currentPeriodEnd: activeEntitlement
          ? stringValue(activeEntitlement, ["expires_at", "expiration_at", "expires_date"])
          : null,
        cancelAtPeriodEnd: activeEntitlement
          ? booleanValue(activeEntitlement, ["will_renew", "auto_renewing"]) === false
          : false,
      });
    } catch (error) {
      console.error("RevenueCat billing status lookup failed:", error);
      const statusCode = error instanceof RevenueCatError ? error.statusCode : 502;
      return res.status(statusCode).json({
        message: error instanceof Error ? error.message : "Unable to load RevenueCat billing status.",
      });
    }
  });

  app.get("/api/billing/preflight", requireAuth, async (_req, res) => {
    try {
      const config = getRevenueCatConfig();
      const projectId = requireProjectId(config);
      const result = await withBillingPreflightTimeout(
        runBillingPreflight(projectId, config.entitlementIdentifier),
      );
      return res.status(result.ready ? 200 : 503).json(result);
    } catch (error) {
      console.error(
        "RevenueCat billing configuration preflight failed:",
        error instanceof RevenueCatError ? error.statusCode : "unknown",
      );
      const statusCode = error instanceof RevenueCatError ? error.statusCode : 502;
      return res.status(statusCode).json({
        ready: false,
        checks: {
          googlePlayApp: false,
          googlePlayProduct: false,
          entitlement: false,
          offering: false,
        },
        message:
          error instanceof RevenueCatError && error.statusCode === 504
            ? error.message
            : "RevenueCat billing configuration could not be verified before purchase.",
      });
    }
  });

  app.post("/api/billing/portal", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = getRequestUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Sign in is required to manage billing." });
      }

      const config = getRevenueCatConfig();
      const projectId = requireProjectId(config);
      const customerId = customerIdForUser(userId);
      const subscriptions = await getSubscriptions(projectId, customerId);
      const subscription = collectionItems(subscriptions).find((item) =>
        booleanValue(item, ["gives_access", "is_active"]) === true ||
        ["active", "trialing"].includes(stringValue(item, ["status"]) ?? ""),
      );

      const subscriptionId = subscription
        ? stringValue(subscription, ["id", "subscription_id"])
        : null;
      if (!subscriptionId) {
        return res.status(404).json({
          message: "No active RevenueCat subscription is linked to this account yet.",
        });
      }

      const management = await requestRevenueCat<{ management_url?: string | null }>(
        `/projects/${encodeURIComponent(projectId)}/subscriptions/${encodeURIComponent(subscriptionId)}/authenticated_management_url`,
      );
      if (!management.management_url) {
        return res.status(502).json({
          message: "RevenueCat could not create a subscription management link.",
        });
      }

      return res.json({ url: management.management_url });
    } catch (error) {
      console.error("RevenueCat subscription management link failed:", error);
      const statusCode = error instanceof RevenueCatError ? error.statusCode : 502;
      return res.status(statusCode).json({
        message:
          error instanceof Error
            ? error.message
            : "Unable to open RevenueCat subscription management.",
      });
    }
  });
}