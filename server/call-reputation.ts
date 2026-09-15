import { z } from "zod";

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
  provider: "approved-source" | "call-control-identify" | "call-control";
  reportingAvailable: boolean;
  reason: string;
};

const CALL_CONTROL_IDENTIFY_PROVIDER = "call-control-identify";
const CALL_CONTROL_PROVIDER = "call-control";
const CALL_CONTROL_SOURCE = "Call Control Identify";
const CALL_CONTROL_PROTECT_SOURCE = "Call Control Protect";
const CALL_CONTROL_COMBINED_SOURCE = "Call Control Protect + Identify";
const CALL_CONTROL_REQUEST_TIMEOUT_MS = 2500;
const CALL_CONTROL_COMBINED_REQUEST_TIMEOUT_MS = 1050;

const callControlIdentifyResponseSchema = z.object({
  CallType: z.string().optional(),
  Confidence: z.number().int().min(0).max(10).optional(),
  IsSpam: z.boolean(),
});

const callControlProtectObjectResponseSchema = z.object({
  Action: z.string(),
});

function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${hasPlus ? "+" : ""}${digits}`;
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

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function reputationHeaders() {
  const token = process.env.SAFE_NET_CALL_REPUTATION_TOKEN?.trim();
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function isCallControlIdentifyEnabled() {
  return process.env.SAFE_NET_CALL_REPUTATION_PROVIDER?.trim().toLowerCase() ===
    CALL_CONTROL_IDENTIFY_PROVIDER;
}

function isCallControlCombinedEnabled() {
  return process.env.SAFE_NET_CALL_REPUTATION_PROVIDER?.trim().toLowerCase() ===
    CALL_CONTROL_PROVIDER;
}

function isAnyCallControlEnabled() {
  return isCallControlIdentifyEnabled() || isCallControlCombinedEnabled();
}

function configuredCallControlIdentifyBase() {
  const endpoint = configuredEndpoint("SAFE_NET_CALL_CONTROL_BASE_URL");
  if (!endpoint || endpoint.search || endpoint.hash) return null;
  return endpoint;
}

function configuredCallControlProtectBase() {
  const endpoint = configuredEndpoint("SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL");
  if (!endpoint || endpoint.search || endpoint.hash) return null;
  return endpoint;
}

function callControlApiKey() {
  const value = process.env.SAFE_NET_CALL_CONTROL_API_KEY?.trim();
  return value || null;
}

function callControlUnavailable(
  reason: string,
  provider: "call-control-identify" | "call-control" = "call-control-identify",
): CallReputationAvailability {
  return availability("unavailable", reason, {
    source: provider === "call-control"
      ? CALL_CONTROL_COMBINED_SOURCE
      : CALL_CONTROL_SOURCE,
    provider,
    reportingAvailable: false,
  });
}

function callControlIdentifyUrl(base: URL, number: string, apiKey: string) {
  const url = new URL(base.toString());
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(number)}`;
  url.search = "";
  url.searchParams.set("api_key", apiKey);
  return url;
}

function callControlProtectUrl(
  base: URL,
  callerNumber: string,
  apiKey: string,
  customerNumber: string | null,
) {
  const path = [
    base.pathname.replace(/\/+$/, ""),
    encodeURIComponent(callerNumber),
    ...(customerNumber ? [encodeURIComponent(customerNumber)] : []),
  ].join("/");
  const url = new URL(base.toString());
  url.pathname = path;
  url.search = "";
  url.searchParams.set("api_key", apiKey);
  return url;
}

function callControlCustomerNumber() {
  const value = process.env.SAFE_NET_CALL_CONTROL_CUSTOMER_NUMBER?.trim();
  return value ? normalizePhoneNumber(value) : null;
}

function callControlProtectAction(payload: unknown) {
  const rawAction = typeof payload === "string"
    ? payload
    : callControlProtectObjectResponseSchema.safeParse(payload).success
      ? callControlProtectObjectResponseSchema.parse(payload).Action
      : null;
  switch (rawAction?.trim().toLowerCase()) {
    case "allow":
      return "allow" as const;
    case "block":
      return "block" as const;
    case "voicemail":
    case "voice_mail":
    case "voice mail":
      return "silence" as const;
    default:
      return null;
  }
}

function callControlDecision(
  payload: z.infer<typeof callControlIdentifyResponseSchema>,
): Extract<CallReputationResult, { available: true }> {
  const callType = payload.CallType?.trim() || "Unknown";
  const normalizedCallType = callType.toLowerCase();
  const confidence = payload.Confidence ?? 0;
  const highRiskType = /\b(scam|fraud)\b/.test(normalizedCallType);
  const action = !payload.IsSpam
    ? "allow"
    : highRiskType || confidence >= 8
      ? "block"
      : confidence >= 5
        ? "silence"
        : "allow";

  return {
    available: true,
    action,
    source: CALL_CONTROL_SOURCE,
    reason: payload.IsSpam
      ? `${CALL_CONTROL_SOURCE}: ${callType}, confidence ${confidence}/10.`
      : `${CALL_CONTROL_SOURCE}: not marked as spam.`,
  };
}

async function getCallControlAvailability(): Promise<CallReputationAvailability> {
  if (!configuredCallControlIdentifyBase()) {
    return callControlUnavailable(
      "Call Control Identify base URL is not configured.",
    );
  }
  if (!callControlApiKey()) {
    return callControlUnavailable(
      "Call Control Identify API key is not configured.",
    );
  }

  // Call Control does not publish a health endpoint. Configuration is
  // reported here and authorization/rate-limit status is verified on lookup.
  return availability(
    "configured",
    "Call Control Identify is configured; live access is verified during lookup.",
    {
      source: CALL_CONTROL_SOURCE,
      provider: "call-control-identify",
      reportingAvailable: false,
    },
  );
}

async function getCallControlCombinedAvailability(): Promise<CallReputationAvailability> {
  if (!configuredCallControlProtectBase()) {
    return callControlUnavailable(
      "Call Control Protect base URL is not configured.",
      "call-control",
    );
  }
  if (!callControlApiKey()) {
    return callControlUnavailable(
      "Call Control API key is not configured.",
      "call-control",
    );
  }

  return availability(
    "configured",
    "Call Control Protect is configured as primary; Identify is available as fallback when configured.",
    {
      source: CALL_CONTROL_COMBINED_SOURCE,
      provider: "call-control",
      reportingAvailable: false,
    },
  );
}

async function lookupCallControlIdentify(
  normalized: string,
  timeoutMs = CALL_CONTROL_REQUEST_TIMEOUT_MS,
): Promise<CallReputationResult> {
  const base = configuredCallControlIdentifyBase();
  const apiKey = callControlApiKey();
  if (!base || !apiKey) {
    return unavailable(
      !base
        ? "Call Control Identify base URL is not configured."
        : "Call Control Identify API key is not configured.",
      CALL_CONTROL_SOURCE,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(callControlIdentifyUrl(base, normalized, apiKey), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return unavailable(
        response.status === 429
          ? "Call Control Identify rate limit exceeded."
          : `Call Control Identify returned HTTP ${response.status}.`,
        CALL_CONTROL_SOURCE,
      );
    }

    const parsed = callControlIdentifyResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      return unavailable("Call Control Identify returned an invalid response.", CALL_CONTROL_SOURCE);
    }
    return callControlDecision(parsed.data);
  } catch (error) {
    return unavailable(
      error instanceof Error && error.name === "AbortError"
        ? "Call Control Identify timed out."
        : "Call Control Identify could not be reached.",
      CALL_CONTROL_SOURCE,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupCallControlProtect(
  normalized: string,
  timeoutMs = CALL_CONTROL_REQUEST_TIMEOUT_MS,
): Promise<CallReputationResult> {
  const base = configuredCallControlProtectBase();
  const apiKey = callControlApiKey();
  if (!base || !apiKey) {
    return unavailable(
      !base
        ? "Call Control Protect base URL is not configured."
        : "Call Control API key is not configured.",
      CALL_CONTROL_PROTECT_SOURCE,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      callControlProtectUrl(base, normalized, apiKey, callControlCustomerNumber()),
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      return unavailable(
        response.status === 429
          ? "Call Control Protect rate limit exceeded."
          : `Call Control Protect returned HTTP ${response.status}.`,
        CALL_CONTROL_PROTECT_SOURCE,
      );
    }

    const action = callControlProtectAction(await readJson(response));
    if (!action) {
      return unavailable(
        "Call Control Protect returned an invalid action.",
        CALL_CONTROL_PROTECT_SOURCE,
      );
    }
    return {
      available: true,
      action,
      source: CALL_CONTROL_PROTECT_SOURCE,
      reason: `Call Control Protect returned ${action}.`,
    };
  } catch (error) {
    return unavailable(
      error instanceof Error && error.name === "AbortError"
        ? "Call Control Protect timed out."
        : "Call Control Protect could not be reached.",
      CALL_CONTROL_PROTECT_SOURCE,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupCallControlCombined(
  normalized: string,
): Promise<CallReputationResult> {
  const protect = await lookupCallControlProtect(
    normalized,
    CALL_CONTROL_COMBINED_REQUEST_TIMEOUT_MS,
  );
  if (protect.available) return protect;

  const identify = await lookupCallControlIdentify(
    normalized,
    CALL_CONTROL_COMBINED_REQUEST_TIMEOUT_MS,
  );
  if (identify.available) {
    return {
      ...identify,
      source: `${CALL_CONTROL_SOURCE} (fallback)`,
      reason: `${identify.reason ?? "Identify returned a decision."} Protect was unavailable.`,
    };
  }

  return unavailable(
    `Call Control Protect and Identify were unavailable. Protect: ${protect.reason} Identify: ${identify.reason}`,
    CALL_CONTROL_COMBINED_SOURCE,
  );
}

export async function getCallReputationAvailability(): Promise<CallReputationAvailability> {
  if (isCallControlCombinedEnabled()) {
    return getCallControlCombinedAvailability();
  }
  if (isCallControlIdentifyEnabled()) {
    return getCallControlAvailability();
  }

  const endpoint = configuredEndpoint("SAFE_NET_CALL_REPUTATION_URL");
  if (!endpoint) {
    return availability(
      "unavailable",
      "The approved caller-reputation source is not configured.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(endpoint, {
      method: "HEAD",
      headers: reputationHeaders(),
      signal: controller.signal,
    });

    // A provider may reject HEAD or require a phone number, but those
    // responses still prove that the configured endpoint is reachable.
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

  if (isCallControlCombinedEnabled()) {
    return lookupCallControlCombined(normalized);
  }
  if (isCallControlIdentifyEnabled()) {
    return lookupCallControlIdentify(normalized);
  }

  const endpoint = configuredEndpoint("SAFE_NET_CALL_REPUTATION_URL");
  if (!endpoint) {
    return unavailable("The approved caller-reputation source is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
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
  if (isAnyCallControlEnabled()) {
    return {
      accepted: false,
      reason:
        "Call Control's public APIs do not publish a report endpoint. Add the number to SafeNet's local blocklist for immediate protection.",
    };
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
  const timeout = setTimeout(() => controller.abort(), 2500);
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