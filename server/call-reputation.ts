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
    if (url.protocol !== "https:" || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

function unavailable(reason: string): CallReputationResult {
  return { available: false, source: "SafeNet approved source", reason };
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

export async function lookupCallReputation(number: string): Promise<CallReputationResult> {
  const normalized = normalizePhoneNumber(number);
  if (!normalized) return unavailable("The caller number is invalid.");

  const endpoint = configuredEndpoint("SAFE_NET_CALL_REPUTATION_URL");
  if (!endpoint) {
    return unavailable("The approved caller-reputation source is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(endpointForNumber(endpoint, normalized), {
      headers: {
        Accept: "application/json",
        ...(process.env.SAFE_NET_CALL_REPUTATION_TOKEN
          ? { Authorization: `Bearer ${process.env.SAFE_NET_CALL_REPUTATION_TOKEN}` }
          : {}),
      },
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
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(process.env.SAFE_NET_CALL_REPUTATION_TOKEN
          ? { Authorization: `Bearer ${process.env.SAFE_NET_CALL_REPUTATION_TOKEN}` }
          : {}),
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