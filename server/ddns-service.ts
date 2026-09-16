import { storage } from "./storage";
import {
  DDNS_DEFAULT_INTERVAL_SECONDS,
  DDNS_MIN_INTERVAL_SECONDS,
  DDNS_SCHEDULER_INTERVAL_SECONDS,
} from "@shared/schema";
import type { IStorage } from "./storage";
import { getCloudflareStatus, updateCloudflareDns } from "./replit_integrations/cloudflare/client";

type DdnsSchedulerStorage = Pick<
  IStorage,
  "getDdnsUpdaters" | "updateDdnsIpInfo" | "updateDdnsFailureInfo"
> & Partial<Pick<IStorage, "claimDdnsUpdate">>;

const activeDdnsUpdates = new Set<number>();

export type DdnsUpdateResult =
  | { success: true }
  | { success: false; error: string };

export type DdnsConnectivityResult =
  | { success: true; message: string }
  | { success: false; error: string };

export type DdnsUpdateAttempt = DdnsUpdateResult & {
  updaterId: number;
  hostname: string;
};

export type DdnsForcedUpdateResult = DdnsUpdateAttempt & {
  ipAddress: string;
};

function providerFailure(provider: string, response: Response, body?: string): DdnsUpdateResult {
  const detail = body?.trim().slice(0, 200);
  return {
    success: false,
    error: `${provider} rejected the update${response.status ? ` (HTTP ${response.status})` : ""}${detail ? `: ${detail}` : ""}`,
  };
}

function providerResponseSuccess(): DdnsUpdateResult {
  return { success: true };
}

function providerDisplayName(provider: string): string {
  switch (provider.toLowerCase()) {
    case "duckdns":
      return "DuckDNS";
    case "noip":
      return "No-IP";
    case "dynu":
      return "Dynu";
    case "dnsomatic":
      return "DNS-O-MATIC";
    case "cloudflare":
      return "Cloudflare";
    case "dnsexit":
      return "DNSExit";
    case "iplink":
      return "IP Link";
    case "safenet":
      return "SafeNet DDNS";
    default:
      return provider;
  }
}

export async function testDdnsConnection(
  provider: string,
  customUrl?: string | null,
): Promise<DdnsConnectivityResult> {
  if (provider.toLowerCase() === "cloudflare" || provider.toLowerCase() === "safenet") {
    const status = await getCloudflareStatus();
    return status.ready
      ? { success: true, message: status.message }
      : { success: false, error: status.message };
  }

  let target: string;
  switch (provider.toLowerCase()) {
    case "duckdns":
      target = "https://www.duckdns.org";
      break;
    case "noip":
      target = "https://dynupdate.no-ip.com";
      break;
    case "dynu":
      target = "https://api.dynu.com";
      break;
    case "dnsexit":
      target = "https://update.dnsexit.com";
      break;
    case "dnsomatic":
      target = "https://updates.dnsomatic.com";
      break;
    case "iplink":
      if (!customUrl) {
        return { success: false, error: "IP Link requires a custom URL" };
      }
      try {
        target = new URL(customUrl).origin;
      } catch {
        return { success: false, error: "IP Link custom URL is invalid" };
      }
      break;
    default:
      return { success: false, error: `Unsupported DDNS provider: ${provider}` };
  }

  try {
    const response = await fetch(target, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return {
        success: false,
        error: `${providerDisplayName(provider)} rejected the connectivity check (HTTP ${response.status}).`,
      };
    }
    return {
      success: true,
      message: `${providerDisplayName(provider)} is reachable (HTTP ${response.status}).`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "request failed";
    return {
      success: false,
      error: `Network error while contacting ${providerDisplayName(provider)}: ${detail}`,
    };
  }
}

// Get current IP from public API
export async function getCurrentPublicIp(): Promise<string> {
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`public IP service returned HTTP ${response.status}`);
    }
    const data = await response.json() as { ip: string };
    if (!data.ip || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(data.ip)) {
      throw new Error("public IP service returned an invalid address");
    }
    return data.ip;
  } catch (error) {
    console.error("Failed to get public IP:", error);
    throw new Error("Could not determine public IP");
  }
}

const DDNS_PROVIDER_TIMEOUT_MS = 10_000;

async function fetchDdnsProvider(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(DDNS_PROVIDER_TIMEOUT_MS),
  });
}

// Update DNS record based on provider
async function updateDnsRecord(
  hostname: string,
  provider: string,
  apiKey: string,
  ipAddress: string,
  customUrl?: string | null
): Promise<DdnsUpdateResult> {
  try {
    switch (provider.toLowerCase()) {
      case "duckdns":
        return await updateDuckDns(hostname, apiKey, ipAddress);
      case "noip":
        return await updateNoIp(hostname, apiKey, ipAddress);
      case "dynu":
        return await updateDynu(hostname, apiKey, ipAddress);
       case "cloudflare":
       case "safenet":
        await updateCloudflareDns(hostname, ipAddress);
        return providerResponseSuccess();
      case "dnsexit":
        return await updateDnsExit(hostname, apiKey, ipAddress);
      case "dnsomatic":
        return await updateDnsOMatic(hostname, apiKey, ipAddress);
      case "iplink":
        return await updateIpLink(hostname, ipAddress, customUrl);
      default:
        console.warn(`Unsupported DDNS provider: ${provider}`);
        return { success: false, error: `Unsupported DDNS provider: ${provider}` };
    }
  } catch (error) {
    console.error(`Failed to update DDNS for ${hostname}:`, error);
    const detail = error instanceof Error ? error.message : "request failed";
    return {
      success: false,
      error: `Network error while contacting ${providerDisplayName(provider)}: ${detail}`,
    };
  }
}

async function updateDuckDns(hostname: string, token: string, ip: string): Promise<DdnsUpdateResult> {
  const response = await fetchDdnsProvider(
    `https://www.duckdns.org/update?domains=${hostname}&token=${token}&ip=${ip}`
  );
  const text = await response.text();
  return response.ok && text.includes("OK")
    ? providerResponseSuccess()
    : providerFailure("DuckDNS", response, text);
}

async function updateNoIp(hostname: string, authToken: string, ip: string): Promise<DdnsUpdateResult> {
  const response = await fetchDdnsProvider("https://dynupdate.no-ip.com/nic/update", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authToken}`,
    },
    body: new URLSearchParams({ hostname, myip: ip }).toString(),
  });
  const text = await response.text();
  return response.ok && /^(good|nochg)\b/i.test(text.trim())
    ? providerResponseSuccess()
    : providerFailure("No-IP", response, text);
}

async function updateDynu(hostname: string, apiKey: string, ip: string): Promise<DdnsUpdateResult> {
  const response = await fetchDdnsProvider("https://api.dynu.com/v2/dns", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hostname, ipv4: ip }),
  });
  if (response.ok) return providerResponseSuccess();
  return providerFailure("Dynu", response, await response.text());
}

async function updateDnsExit(hostname: string, credentials: string, ip: string): Promise<DdnsUpdateResult> {
  const response = await fetchDdnsProvider(
    `https://update.dnsexit.com/dns/ud/?host=${encodeURIComponent(hostname)}&myip=${encodeURIComponent(ip)}`,
    {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    },
  );
  const text = await response.text();
  return response.ok && /(?:^|\b)(ok|good|nochg)(?:\b|$)/i.test(text.trim())
    ? providerResponseSuccess()
    : providerFailure("DNSExit", response, text);
}

async function updateDnsOMatic(hostname: string, credentials: string, ip: string): Promise<DdnsUpdateResult> {
  const response = await fetchDdnsProvider("https://updates.dnsomatic.com/nic/update", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({ hostname, myip: ip }).toString(),
  });
  const text = await response.text();
  return response.ok && (text.includes("good") || text.includes("nochg"))
    ? providerResponseSuccess()
    : providerFailure("DNS-O-MATIC", response, text);
}

async function updateIpLink(hostname: string, ip: string, customUrl?: string | null): Promise<DdnsUpdateResult> {
  if (!customUrl) {
    console.error("IP Link requires a custom URL");
    return { success: false, error: "IP Link requires a custom URL" };
  }
  try {
    if (new URL(customUrl).protocol !== "https:") {
      console.error("IP Link requires an HTTPS custom URL");
      return { success: false, error: "IP Link requires an HTTPS custom URL" };
    }
  } catch {
    console.error("IP Link custom URL is invalid");
    return { success: false, error: "IP Link custom URL is invalid" };
  }
  
  // Replace placeholders in the custom URL
  const url = customUrl
    .replace(/\{ip\}/gi, ip)
    .replace(/\{hostname\}/gi, hostname)
    .replace(/\{IP\}/g, ip)
    .replace(/\{HOSTNAME\}/g, hostname);
  
  const response = await fetchDdnsProvider(url);
  // Consider any 2xx response as success
  return response.ok
    ? providerResponseSuccess()
    : providerFailure("IP Link", response, await response.text());
}

export async function forceUpdateDdns(
  targetUpdaterId: number,
  clientIp?: string,
  schedulerStorage: DdnsSchedulerStorage = storage,
): Promise<DdnsForcedUpdateResult> {
  const updater = (await schedulerStorage.getDdnsUpdaters()).find(
    (entry) => entry.id === targetUpdaterId,
  );
  if (!updater) {
    throw new Error("DDNS updater not found");
  }

  const currentIp = clientIp || await getCurrentPublicIp();
  if (activeDdnsUpdates.has(updater.id)) {
    return {
      updaterId: updater.id,
      hostname: updater.hostname,
      ipAddress: currentIp,
      success: false,
      error: "A DDNS update is already in progress for this updater.",
    };
  }

  activeDdnsUpdates.add(updater.id);
  try {
    const result = await updateDnsRecord(
      updater.hostname,
      updater.provider,
      updater.apiKey,
      currentIp,
      updater.customUrl,
    );
    const attempt: DdnsForcedUpdateResult = {
      updaterId: updater.id,
      hostname: updater.hostname,
      ipAddress: currentIp,
      ...result,
    };

    if (result.success) {
      await schedulerStorage.updateDdnsIpInfo(updater.id, currentIp);
      console.log(`Manual DDNS update verified for ${updater.hostname}: ${currentIp}`);
    } else {
      await schedulerStorage.updateDdnsFailureInfo?.(updater.id, result.error);
      console.error(`Manual DDNS update failed for ${updater.hostname}: ${result.error}`);
    }

    return attempt;
  } finally {
    activeDdnsUpdates.delete(updater.id);
  }
}

// Check and update all enabled DDNS updaters
// If clientIp is provided, use it instead of fetching server's IP
export async function checkAndUpdateDdns(
  clientIp?: string,
  schedulerStorage: DdnsSchedulerStorage = storage,
  targetUpdaterId?: number,
): Promise<DdnsUpdateAttempt[]> {
  const updaters = await schedulerStorage.getDdnsUpdaters();
  const currentIp = clientIp || await getCurrentPublicIp();
  const results: DdnsUpdateAttempt[] = [];

  for (const updater of updaters) {
    if (!updater.isEnabled || (targetUpdaterId !== undefined && updater.id !== targetUpdaterId)) continue;

    // Check if update is needed
    const lastUpdateSeconds = updater.lastUpdateTime
      ? Math.floor(new Date(updater.lastUpdateTime).getTime() / 1000)
      : 0;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const timeSinceLastUpdateSeconds = nowSeconds - lastUpdateSeconds;
    const updateIntervalSeconds = updater.updateInterval === null
      ? DDNS_DEFAULT_INTERVAL_SECONDS
      : Math.max(
          DDNS_MIN_INTERVAL_SECONDS,
          Math.ceil(updater.updateInterval / 1000),
        );

    if (timeSinceLastUpdateSeconds < updateIntervalSeconds) {
      continue; // Respect the configured provider write interval
    }

    // Avoid overlapping scheduler and manual updates for the same updater.
    if (activeDdnsUpdates.has(updater.id)) {
      continue;
    }

    if (schedulerStorage.claimDdnsUpdate) {
      const claimed = await schedulerStorage.claimDdnsUpdate(
        updater.id,
        new Date((nowSeconds - updateIntervalSeconds) * 1000),
      );
      if (!claimed) {
        continue;
      }
    }

    activeDdnsUpdates.add(updater.id);
    try {
      const result = await updateDnsRecord(
        updater.hostname,
        updater.provider,
        updater.apiKey,
        currentIp,
        updater.customUrl
      );
      const attempt: DdnsUpdateAttempt = {
        updaterId: updater.id,
        hostname: updater.hostname,
        ...result,
      };
      results.push(attempt);

      if (result.success) {
        await schedulerStorage.updateDdnsIpInfo(updater.id, currentIp);
        console.log(`DDNS updated for ${updater.hostname}: ${currentIp}`);
      } else {
        await schedulerStorage.updateDdnsFailureInfo?.(updater.id, result.error);
        console.error(`DDNS update failed for ${updater.hostname}: ${result.error}`);
      }
    } finally {
      activeDdnsUpdates.delete(updater.id);
    }
  }

  return results;
}

// Start periodic DDNS check. All scheduler decisions use seconds; the
// millisecond conversion is isolated to the legacy persistence boundary.
export function startDdnsScheduler(): NodeJS.Timer {
  const interval = setInterval(
    () => {
      checkAndUpdateDdns().catch((err) => console.error("DDNS scheduler error:", err));
    },
    DDNS_SCHEDULER_INTERVAL_SECONDS * 1000
  );

  // Run immediately on startup
  checkAndUpdateDdns().catch((err) => console.error("Initial DDNS check failed:", err));

  return interval;
}
