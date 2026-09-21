import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client";

type CloudflareApiError = {
  code?: number;
  message?: string;
};

type CloudflareEnvelope<T> = {
  success?: boolean;
  errors?: CloudflareApiError[];
  result?: T;
};

export type CloudflareStatus = {
  connected: boolean;
  authenticated: boolean;
  ready: boolean;
  activeZoneCount: number;
  message: string;
};

export class CloudflareIntegrationError extends Error {
  readonly status: number;
  readonly errors: CloudflareApiError[];

  constructor(message: string, status: number, errors: CloudflareApiError[] = []) {
    super(message);
    this.name = "CloudflareIntegrationError";
    this.status = status;
    this.errors = errors;
  }
}

async function requestCloudflare<T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
  },
): Promise<T> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const response = token
    ? await fetch(`${CLOUDFLARE_API_BASE_URL}${path}`, {
        method: options?.method,
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(options?.body ? { "Content-Type": "application/json" } : {}),
        },
      })
    : await connectors.proxy("cloudflare", path, {
        method: options?.method,
        body: options?.body,
        headers: {
          Accept: "application/json",
          ...(options?.body ? { "Content-Type": "application/json" } : {}),
        },
      });

  let payload: CloudflareEnvelope<T> = {};
  try {
    payload = await response.json() as CloudflareEnvelope<T>;
  } catch {
    throw new CloudflareIntegrationError(
      `Cloudflare returned an unreadable response (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!response.ok || payload.success === false) {
    const detail = payload.errors
      ?.map((error) => error.message || (error.code ? `code ${error.code}` : "unknown error"))
      .filter(Boolean)
      .join("; ");
    throw new CloudflareIntegrationError(
      `Cloudflare rejected the request${detail ? `: ${detail}` : ` (HTTP ${response.status})`}.`,
      response.status,
      payload.errors || [],
    );
  }

  return payload.result as T;
}

export async function getCloudflareStatus(): Promise<CloudflareStatus> {
  try {
    const verification = await requestCloudflare<{ status?: string }>("/v4/user/tokens/verify");
    const zones = await requestCloudflare<Array<{ id: string; name: string }>>(
      "/v4/zones?per_page=50&status=active",
    );
    const activeZoneCount = zones?.length || 0;

    return {
      connected: true,
      authenticated: verification?.status === "active",
      ready: verification?.status === "active" && activeZoneCount > 0,
      activeZoneCount,
      message: activeZoneCount > 0
        ? `Cloudflare is connected with ${activeZoneCount} active zone${activeZoneCount === 1 ? "" : "s"}.`
        : "Cloudflare is authenticated, but the account has no active zones.",
    };
  } catch (error) {
    return {
      connected: false,
      authenticated: false,
      ready: false,
      activeZoneCount: 0,
      message: error instanceof Error ? error.message : "Cloudflare connection failed.",
    };
  }
}

function findBestZone(hostname: string, zones: Array<{ id: string; name: string }>) {
  return zones
    .filter((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

export async function updateCloudflareDns(hostname: string, ip: string): Promise<void> {
  const normalizedHostname = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (normalizedHostname.split(".").filter(Boolean).length < 2) {
    throw new Error("Cloudflare requires a fully qualified hostname.");
  }

  const zones = await requestCloudflare<Array<{ id: string; name: string }>>(
    "/v4/zones?per_page=50&status=active",
  );
  const zone = findBestZone(normalizedHostname, zones || []);
  if (!zone) {
    throw new Error(`Cloudflare zone for ${normalizedHostname} was not found or is not active.`);
  }

  const records = await requestCloudflare<Array<{ id?: string }>>(
    `/v4/zones/${encodeURIComponent(zone.id)}/dns_records?type=A&name=${encodeURIComponent(normalizedHostname)}`,
  );
  const existingRecord = records?.[0];
  const recordPath = existingRecord?.id
    ? `/v4/zones/${encodeURIComponent(zone.id)}/dns_records/${encodeURIComponent(existingRecord.id)}`
    : `/v4/zones/${encodeURIComponent(zone.id)}/dns_records`;

  await requestCloudflare(recordPath, {
    method: existingRecord?.id ? "PUT" : "POST",
    body: {
      type: "A",
      name: normalizedHostname,
      content: ip,
      ttl: 1,
      proxied: false,
    },
  });
}