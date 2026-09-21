import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const ONESIGNAL_APP_ID = "9717b96d-844d-44de-9a84-4e5a7c374b80";

type OneSignalEnvelope<T> = {
  id?: string;
  errors?: string[];
  total_count?: number;
  notifications?: T[];
};

export type OneSignalStatus = {
  connected: boolean;
  configured: boolean;
  message: string;
};

export type SecurityNotificationResult = {
  sent: boolean;
  messageId?: string;
  message: string;
};

async function requestOneSignal<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<OneSignalEnvelope<T>> {
  const response = await connectors.proxy("onesignal", path, {
    method: options?.method,
    body: options?.body,
    headers: {
      Accept: "application/json",
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  const text = await response.text();
  let payload: OneSignalEnvelope<T> = {};
  try {
    payload = text ? JSON.parse(text) as OneSignalEnvelope<T> : {};
  } catch {
    throw new Error(`OneSignal returned an unreadable response (HTTP ${response.status}).`);
  }

  if (!response.ok || payload.errors?.length) {
    throw new Error(
      `OneSignal rejected the request${payload.errors?.length ? `: ${payload.errors.join("; ")}` : ` (HTTP ${response.status})`}.`,
    );
  }
  return payload;
}

export async function getOneSignalStatus(): Promise<OneSignalStatus> {
  try {
    await requestOneSignal(
      `/notifications?app_id=${encodeURIComponent(ONESIGNAL_APP_ID)}&limit=1&offset=0`,
    );
    return {
      connected: true,
      configured: true,
      message: "OneSignal is connected and ready for push security alerts.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const isAuthorizationFailure = /HTTP 401|HTTP 403|rejected the request/i.test(message);
    return {
      connected: false,
      configured: false,
      message: isAuthorizationFailure
        ? "Optional push security alerts are not configured. Antivirus and ClamAV protection remain active."
        : "Optional push security alerts are currently unavailable. Antivirus and ClamAV protection remain active.",
    };
  }
}

export async function notifySecurityEvent(input: {
  eventId: number;
  severity: string;
  threatType: string;
  action: string;
}): Promise<SecurityNotificationResult> {
  if (input.severity !== "high" && input.severity !== "critical") {
    return {
      sent: false,
      message: "Only high and critical security events send push notifications.",
    };
  }

  const severity = input.severity === "critical" ? "critical" : "high";
  const payload = await requestOneSignal(
    "/notifications",
    {
      method: "POST",
      body: {
        app_id: ONESIGNAL_APP_ID,
        included_segments: ["Subscribed Users"],
        target_channel: "push",
        headings: { en: "SafeNet Shield security alert" },
        contents: {
          en: `SafeNet Shield ${input.action} a ${severity}-severity ${input.threatType} threat.`,
        },
        data: {
          source: "safenet-shield",
          event_id: String(input.eventId),
          severity,
          action: input.action,
        },
        idempotency_key: randomUUID(),
      },
    },
  );

  return payload.id
    ? {
        sent: true,
        messageId: payload.id,
        message: "Security alert sent to subscribed devices.",
      }
    : {
        sent: false,
        message: "OneSignal accepted the request, but no subscribed device received it.",
      };
}