import { z } from "zod";

export const DEEPCLEER_CAPABILITIES = [
  "image",
  "video",
  "livestream",
  "text",
  "audio",
] as const;

export type DeepCleerCapability = (typeof DEEPCLEER_CAPABILITIES)[number];
export type DeepCleerSource = "camera" | "screen";

const imageRequestSchema = z.object({
  consent: z.literal(true),
  source: z.enum(["camera", "screen"]),
  imageBase64: z.string().min(1).max(14_000_000),
});

export type DeepCleerImageRequest = z.infer<typeof imageRequestSchema>;

export interface DeepCleerStatus {
  provider: "deepcleer";
  available: boolean;
  configured: boolean;
  capabilities: readonly DeepCleerCapability[];
  message: string;
}

export class DeepCleerError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 503,
    public readonly code = "DEEPCLEER_UNAVAILABLE",
  ) {
    super(message);
    this.name = "DeepCleerError";
  }
}

function getConfig() {
  const accessKey = process.env.DEEPCLEER_ACCESS_KEY?.trim()
    || process.env.DEEPCLEER_API_KEY?.trim();
  const appId = process.env.DEEPCLEER_APP_ID?.trim();
  const eventId = process.env.DEEPCLEER_EVENT_ID?.trim();
  const tokenId = process.env.DEEPCLEER_TOKEN_ID?.trim();
  const endpoint = process.env.DEEPCLEER_IMAGE_ENDPOINT?.trim();

  let endpointIsSecure = false;
  if (endpoint) {
    try {
      endpointIsSecure = new URL(endpoint).protocol === "https:";
    } catch {
      endpointIsSecure = false;
    }
  }

  return {
    accessKey,
    appId,
    eventId,
    tokenId,
    endpoint,
    configured: Boolean(accessKey && appId && eventId && tokenId && endpoint),
    ready: Boolean(accessKey && appId && eventId && tokenId && endpoint && endpointIsSecure),
  };
}

export function getDeepCleerStatus(): DeepCleerStatus {
  const config = getConfig();
  if (!config.configured) {
    return {
      provider: "deepcleer",
      available: false,
      configured: false,
      capabilities: DEEPCLEER_CAPABILITIES,
      message:
        "DeepCleer access is not configured. Camera and screen frames stay on-device; no data is sent.",
    };
  }
  if (!config.ready) {
    return {
      provider: "deepcleer",
      available: false,
      configured: true,
      capabilities: DEEPCLEER_CAPABILITIES,
      message:
        "DeepCleer is configured with an invalid or non-HTTPS image endpoint. No data is sent.",
    };
  }
  return {
    provider: "deepcleer",
    available: true,
    configured: true,
    capabilities: DEEPCLEER_CAPABILITIES,
    message:
      "DeepCleer image moderation is available. Frames are sent only with explicit consent.",
  };
}

export async function moderateDeepCleerImage(input: DeepCleerImageRequest) {
  const parsed = imageRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new DeepCleerError(
      "DeepCleer image moderation requires explicit consent, a camera or screen source, and an image.",
      400,
      "DEEPCLEER_CONSENT_REQUIRED",
    );
  }

  const config = getConfig();
  if (!config.ready || !config.endpoint || !config.accessKey || !config.appId || !config.eventId) {
    throw new DeepCleerError(
      getDeepCleerStatus().message,
      503,
      "DEEPCLEER_UNAVAILABLE",
    );
  }

  // DeepCleer documents BASE64 image submissions for its synchronous image API.
  // The endpoint is intentionally supplied by onboarding instead of guessed here.
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accessKey: config.accessKey,
      appId: config.appId,
      eventId: config.eventId,
      type: "EROTIC",
      data: {
        img: parsed.data.imageBase64,
        tokenId: config.tokenId,
      },
      acceptLang: "en",
    }),
  });

  if (!response.ok) {
    throw new DeepCleerError(
      `DeepCleer image moderation failed with HTTP ${response.status}.`,
      502,
      "DEEPCLEER_REQUEST_FAILED",
    );
  }

  const result = await response.json() as Record<string, unknown>;
  return {
    provider: "deepcleer" as const,
    source: parsed.data.source,
    result,
  };
}