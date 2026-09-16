import { z } from "zod";
import {
  CALLSHIELD_OFFLINE_FEED,
  CALLSHIELD_OFFLINE_MANIFEST,
  verifyCallShieldOfflineSnapshot,
} from "./callshield-offline-feed";

const reputationActionSchema = z.enum(["allow", "silence", "block"]);
const reputationResponseSchema = z.object({
  available: z.literal(true),
  action: reputationActionSchema,
  source: z.string().min(1).optional(),
  reason: z.string().max(240).optional(),
});

export type CallReputationResult =
  | {
      available: true;
      action: z.infer<typeof reputationActionSchema>;
      source: string;
      reason?: string;
    }
  | {
      available: false;
      source: string;
      reason: string;
    };

export type CallReputationAvailability = {
  status: "configured" | "unavailable";
  failOpen: true;
  source: string;
  provider: "approved-source" | "callshield";
  reportingAvailable: boolean;
  reason: string;
};

const CALLSHIELD_PROVIDER = "callshield";
const CALLSHIELD_SOURCE = "CallShield";
const CALLSHIELD_FEED_URL =
  "https://raw.githubusercontent.com/SysAdminDoc/CallShield/master/data/spam_numbers.json";
const CALLSHIELD_REPORT_URL =
  "https://callshield-reports.snafumatthew.workers.dev/";
const CALLSHIELD_FEED_TIMEOUT_MS = 2500;
const CALLSHIELD_FEED_TTL_MS = 15 * 60 * 1000;
const CALLSHIELD_FAILURE_RETRY_MS = 30 * 1000;

const callShieldEntrySchema = z.object({
  number: z.string().min(1),
  type: z.string().optional(),
  reports: z.number().int().nonnegative().optional(),
  description: z.string().optional(),
}).passthrough();

const callShieldPrefixSchema = z.object({
  prefix: z.string().min(1),
  type: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

const callShieldFeedSchema = z.object({
  version: z.number().int().nonnegative(),
  updated: z.string().optional(),
  numbers: z.array(callShieldEntrySchema).default([]),
  prefixes: z.array(callShieldPrefixSchema).default([]),
}).passthrough();

type CallShieldFeed = z.infer<typeof callShieldFeedSchema>;

const verifiedOfflineCallShieldFeed = verifyCallShieldOfflineSnapshot(
  CALLSHIELD_OFFLINE_FEED,
  CALLSHIELD_OFFLINE_MANIFEST,
)
  ? callShieldFeedSchema.parse(CALLSHIELD_OFFLINE_FEED)
  : null;

let callShieldFeedCache: {
  feed: CallShieldFeed;
  expiresAt: number;
} | null = null;
let callShieldFeedPromise: Promise<CallShieldFeed | null> | null = null;
let callShieldFailureUntil = 0;

function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${hasPlus ? "+" : ""}${digits}`;
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function configuredEndpoint(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function unavailable(
  reason: string,
  source = "SafeNet approved source",
): CallReputationResult {
  return { available: false, source, reason };
}

function availability(
  status: CallReputationAvailability["status"],
  reason: string,
  options: Pick<
    CallReputationAvailability,
    "source" | "provider" | "reportingAvailable"
  > = {
    source: "SafeNet approved source",
    provider: "approved-source",
    reportingAvailable: true,
  },
): CallReputationAvailability {
  return {
    status,
    failOpen: true,
    ...options,
    reason,
  };
}

function endpointForNumber(base: URL, number: string) {
  const url = new URL(base.toString());
  url.searchParams.set("number", number);
  return url;
}

function readJson(response: Response) {
  return response.json().catch(() => null);
}

function reputationHeaders() {
  const token = process.env.SAFE_NET_CALL_REPUTATION_TOKEN?.trim();
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function isApprovedSourceEnabled() {
  return process.env.SAFE_NET_CALL_REPUTATION_PROVIDER?.trim().toLowerCase() ===
    "approved-source";
}

function callShieldFeedUrl() {
  return configuredEndpoint("SAFE_NET_CALLSHIELD_FEED_URL") ??
    new URL(CALLSHIELD_FEED_URL);
}

function callShieldReportUrl() {
  return configuredEndpoint("SAFE_NET_CALLSHIELD_REPORT_URL") ??
    new URL(CALLSHIELD_REPORT_URL);
}

function callShieldEnabled() {
  // CallShield is the default. Treat the former Call Control values as
  // migrated configuration so old secrets cannot keep the retired provider
  // active after an application restart.
  return !isApprovedSourceEnabled();
}

function callShieldFeedFailure(reason: string) {
  return unavailable(reason, CALLSHIELD_SOURCE);
}

async function loadCallShieldFeed(): Promise<CallShieldFeed | null> {
  const now = Date.now();
  if (callShieldFeedCache && callShieldFeedCache.expiresAt > now) {
    return callShieldFeedCache.feed;
  }
  if (callShieldFeedPromise) return callShieldFeedPromise;
  if (callShieldFailureUntil > now) return callShieldFeedCache?.feed ?? null;

  callShieldFeedPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALLSHIELD_FEED_TIMEOUT_MS);
    try {
      const response = await fetch(callShieldFeedUrl(), {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        return callShieldFeedCache?.feed ?? verifiedOfflineCallShieldFeed;
      }
      const parsed = callShieldFeedSchema.safeParse(await readJson(response));
      if (!parsed.success) {
        return callShieldFeedCache?.feed ?? verifiedOfflineCallShieldFeed;
      }

      if (
        callShieldFeedCache &&
        parsed.data.version < callShieldFeedCache.feed.version
      ) {
        return callShieldFeedCache.feed;
      }

      callShieldFeedCache = {
        feed: parsed.data,
        expiresAt: Date.now() + CALLSHIELD_FEED_TTL_MS,
      };
      callShieldFailureUntil = 0;
      return parsed.data;
    } catch {
      callShieldFailureUntil = Date.now() + CALLSHIELD_FAILURE_RETRY_MS;
      return callShieldFeedCache?.feed ?? verifiedOfflineCallShieldFeed;
    } finally {
      clearTimeout(timeout);
      callShieldFeedPromise = null;
    }
  })();

  return callShieldFeedPromise;
}

function callShieldDecision(
  feed: CallShieldFeed,
  normalized: string,
): Extract<CallReputationResult, { available: true }> {
  const digits = phoneDigits(normalized);
  const exact = feed.numbers.find((entry) => phoneDigits(entry.number) === digits);
  if (exact) {
    const reports = exact.reports ?? 0;
    const action = reports >= 3 ? "block" : "silence";
    const label = exact.type?.trim() || "reported spam";
    return {
      available: true,
      action,
      source: CALLSHIELD_SOURCE,
      reason: `CallShield ${label}: ${reports} report${reports === 1 ? "" : "s"}.`,
    };
  }

  const prefix = feed.prefixes.find((entry) => digits.startsWith(phoneDigits(entry.prefix)));
  if (prefix) {
    const label = prefix.type?.trim() || "spam range";
    return {
      available: true,
      action: "silence",
      source: CALLSHIELD_SOURCE,
      reason: `CallShield ${label} match; call silenced conservatively.`,
    };
  }

  return {
    available: true,
    action: "allow",
    source: CALLSHIELD_SOURCE,
    reason: "CallShield found no matching spam number or range.",
  };
}

export function resetCallShieldCache() {
  callShieldFeedCache = null;
  callShieldFeedPromise = null;
  callShieldFailureUntil = 0;
}

export async function getCallReputationAvailability(): Promise<CallReputationAvailability> {
  if (callShieldEnabled()) {
    if (!configuredEndpoint("SAFE_NET_CALLSHIELD_FEED_URL") &&
        process.env.SAFE_NET_CALLSHIELD_FEED_URL?.trim()) {
      return availability("unavailable", "CallShield feed URL is invalid.", {
        source: CALLSHIELD_SOURCE,
        provider: CALLSHIELD_PROVIDER,
        reportingAvailable: true,
      });
    }
    return availability(
      "configured",
      "CallShield community data is configured; lookups use a verified offline snapshot plus the live feed and fail open when neither is available.",
      {
        source: CALLSHIELD_SOURCE,
        provider: CALLSHIELD_PROVIDER,
        reportingAvailable: true,
      },
    );
  }

  const endpoint = configuredEndpoint("SAFE_NET_CALL_REPUTATION_URL");
  if (!endpoint) {
    return availability(
      "unavailable",
      "The approved caller-reputation source is not configured.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALLSHIELD_FEED_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "HEAD",
      headers: reputationHeaders(),
      signal: controller.signal,
    });
    if (response.ok || [400, 405, 422].includes(response.status)) {
      return availability(
        "configured",
        "The approved caller-reputation source is configured and reachable.",
      );
    }
    return availability(
      "unavailable",
      `The approved reputation source returned HTTP ${response.status}.`,
    );
  } catch (error) {
    return availability(
      "unavailable",
      error instanceof Error && error.name === "AbortError"
        ? "The approved reputation source timed out."
        : "The approved reputation source could not be reached.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupCallReputation(number: string): Promise<CallReputationResult> {
  const normalized = normalizePhoneNumber(number);
  if (!normalized) return unavailable("The caller number is invalid.");

  if (callShieldEnabled()) {
    const feed = await loadCallShieldFeed();
    if (!feed) {
      return callShieldFeedFailure(
        "CallShield feed is unavailable; the call will be allowed.",
      );
    }
    return callShieldDecision(feed, normalized);
  }

  const endpoint = configuredEndpoint("SAFE_NET_CALL_REPUTATION_URL");
  if (!endpoint) {
    return unavailable("The approved caller-reputation source is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALLSHIELD_FEED_TIMEOUT_MS);
  try {
    const response = await fetch(endpointForNumber(endpoint, normalized), {
      headers: reputationHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) {
      return unavailable(`The approved reputation source returned HTTP ${response.status}.`);
    }
    const parsed = reputationResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      return unavailable("The approved reputation source returned an invalid decision.");
    }
    return {
      available: true,
      action: parsed.data.action,
      source: parsed.data.source ?? "SafeNet approved source",
      reason: parsed.data.reason,
    };
  } catch (error) {
    return unavailable(error instanceof Error && error.name === "AbortError"
      ? "The approved reputation source timed out."
      : "The approved reputation source could not be reached.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function reportCall(number: string, reason: string | undefined) {
  const normalized = normalizePhoneNumber(number);
  if (!normalized) {
    return { accepted: false, reason: "The caller number is invalid." };
  }

  if (callShieldEnabled()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALLSHIELD_FEED_TIMEOUT_MS);
    try {
      const response = await fetch(callShieldReportUrl(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ number: normalized, type: "spam" }),
        signal: controller.signal,
      });
      return response.ok
        ? {
            accepted: true,
            reason: "Report submitted to the CallShield community database.",
          }
        : {
            accepted: false,
            reason: `CallShield report service returned HTTP ${response.status}.`,
          };
    } catch (error) {
      return {
        accepted: false,
        reason: error instanceof Error && error.name === "AbortError"
          ? "CallShield report service timed out."
          : "CallShield report service could not be reached.",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  const endpoint = configuredEndpoint(
    "SAFE_NET_CALL_REPUTATION_REPORT_URL",
  ) ?? configuredEndpoint("SAFE_NET_CALL_REPUTATION_URL");
  if (!endpoint) {
    return {
      accepted: false,
      reason: "The approved caller-reputation source is not configured.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALLSHIELD_FEED_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...reputationHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ number: normalized, reason: reason?.trim() || "user_report" }),
      signal: controller.signal,
    });
    return response.ok
      ? { accepted: true, reason: "Report submitted to the approved reputation source." }
      : { accepted: false, reason: `The approved reputation source returned HTTP ${response.status}.` };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error && error.name === "AbortError"
        ? "The approved reputation source timed out."
        : "The approved reputation source could not be reached.",
    };
  } finally {
    clearTimeout(timeout);
  }
}