import type { Express, Request, Response } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { getRequestUserId, requireAuth } from "./auth";

const connectors = new ReplitConnectors();
const REVENUECAT_BASE_PATH = "/v2";
const DEFAULT_ENTITLEMENT_IDENTIFIER = "premium";

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