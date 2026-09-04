import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
export const PIN_RECOVERY_CODE_TTL_MS = 10 * 60 * 1000;
export const PIN_RECOVERY_SUBJECT = "SafeNet PIN recovery code";

export type GmailFailureStage = "configuration" | "delivery";

export class GmailNotificationError extends Error {
  constructor(
    public readonly stage: GmailFailureStage,
    public readonly status?: number,
  ) {
    super(`Gmail ${stage} failed${status === undefined ? "" : ` (HTTP ${status})`}.`);
    this.name = "GmailNotificationError";
  }
}

export function getGmailFailureStage(error: unknown): GmailFailureStage {
  return error instanceof GmailNotificationError ? error.stage : "delivery";
}

type GmailRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

function encodeMessage(to: string, subject: string, text: string) {
  const message = [
    `To: ${to}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    `Subject: ${subject}`,
    "",
    text,
  ].join("\r\n");

  return Buffer.from(message, "utf8").toString("base64url");
}

async function requestGmail(path: string, init: GmailRequestInit | undefined, stage: GmailFailureStage) {
  let response: Response;
  try {
    response = await connectors.proxy("google-mail", path, init);
  } catch {
    throw new GmailNotificationError("configuration");
  }

  if (!response.ok) {
    throw new GmailNotificationError(
      response.status === 401 || response.status === 403 ? "configuration" : stage,
      response.status,
    );
  }
  return response;
}

export async function sendGmailMessage(to: string, subject: string, text: string) {
  await requestGmail("/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeMessage(to, subject, text) }),
  }, "delivery");
}

export function sendPinSecurityNotification(to: string) {
  return sendGmailMessage(
    to,
    "SafeNet PIN protection updated",
    "Your SafeNet App Access Protection PIN was updated. If you did not make this change, use the PIN recovery option on the SafeNet access screen immediately.",
  );
}

export function sendPinRecoveryCode(to: string, code: string) {
  return sendGmailMessage(
    to,
    PIN_RECOVERY_SUBJECT,
    `Use this one-time SafeNet PIN recovery code within 10 minutes: ${code}\n\nIf you did not request this code, ignore this message and review your SafeNet security settings.`,
  );
}

function decodeGmailBody(data: string) {
  const normalized = data.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64").toString("utf8");
}

function extractMessageText(payload: Record<string, unknown> | undefined) {
  const text: string[] = [];
  const visit = (part: Record<string, unknown> | undefined) => {
    if (!part) return;
    const body = part.body as Record<string, unknown> | undefined;
    if (typeof body?.data === "string") {
      text.push(decodeGmailBody(body.data));
    }
    const parts = part.parts;
    if (Array.isArray(parts)) {
      for (const child of parts) {
        if (child && typeof child === "object") {
          visit(child as Record<string, unknown>);
        }
      }
    }
  };
  visit(payload);
  return text.join("\n");
}

type GmailRecoveryMessage = {
  id: string;
  subject: string;
  receivedAt: string;
  code: string;
};

/**
 * Used only by the opt-in non-production mailbox smoke test. The code is
 * returned to the test process for validation and is never logged.
 */
export async function findLatestPinRecoveryCode(
  to: string,
  notBefore: Date,
): Promise<GmailRecoveryMessage | null> {
  const after = Math.max(0, Math.floor(notBefore.getTime() / 1000) - 1);
  const query = `to:${to} subject:"${PIN_RECOVERY_SUBJECT}" after:${after}`;
  const searchResponse = await requestGmail(
    `/gmail/v1/users/me/threads:search?q=${encodeURIComponent(query)}&pageSize=20&view=THREAD_VIEW_MINIMAL`,
    undefined,
    "delivery",
  );

  let search: { threads?: Array<{ messages?: Array<Record<string, unknown>> }> };
  try {
    search = await searchResponse.json() as typeof search;
  } catch {
    throw new GmailNotificationError("delivery");
  }

  const candidates = (search.threads ?? [])
    .flatMap((thread) => thread.messages ?? [])
    .filter((message) => typeof message.id === "string")
    .sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")));

  for (const candidate of candidates) {
    const messageResponse = await requestGmail(
      `/gmail/v1/users/me/messages/${encodeURIComponent(String(candidate.id))}?format=full`,
      undefined,
      "delivery",
    );
    let message: { payload?: Record<string, unknown> };
    try {
      message = await messageResponse.json() as typeof message;
    } catch {
      throw new GmailNotificationError("delivery");
    }

    const body = extractMessageText(message.payload);
    const match = body.match(/one-time SafeNet PIN recovery code within 10 minutes:\s*(\d{6})/i);
    if (match) {
      return {
        id: String(candidate.id),
        subject: typeof candidate.subject === "string" ? candidate.subject : PIN_RECOVERY_SUBJECT,
        receivedAt: typeof candidate.date === "string" ? candidate.date : "",
        code: match[1],
      };
    }
  }

  return null;
}
