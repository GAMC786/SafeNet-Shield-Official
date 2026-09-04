import { storage } from "./storage";
import { DDNS_DEFAULT_INTERVAL_MS } from "@shared/schema";
import type { IStorage } from "./storage";

type DdnsSchedulerStorage = Pick<
  IStorage,
  "getDdnsUpdaters" | "updateDdnsIpInfo" | "updateDdnsFailureInfo"
>;

const activeDdnsUpdates = new Set<number>();

export type DdnsUpdateResult =
  | { success: true }
  | { success: false; error: string };

export type DdnsUpdateAttempt = DdnsUpdateResult & {
  updaterId: number;
  hostname: string;
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
    case "iplink":
      return "IP Link";
    default:
      return provider;
  }
}

// Get current IP from public API
export async function getCurrentPublicIp(): Promise<string> {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json() as { ip: string };
    return data.ip;
  } catch (error) {
    console.error("Failed to get public IP:", error);
    throw new Error("Could not determine public IP");
  }
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
  const response = await fetch(
    `https://www.duckdns.org/update?domains=${hostname}&token=${token}&ip=${ip}`
  );
  const text = await response.text();
  return response.ok && text.includes("OK")
    ? providerResponseSuccess()
    : providerFailure("DuckDNS", response, text);
}

async function updateNoIp(hostname: string, authToken: string, ip: string): Promise<DdnsUpdateResult> {
  const response = await fetch("https://dynupdate.no-ip.com/nic/update", {
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
  const response = await fetch("https://api.dynu.com/v2/dns", {
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

async function updateDnsOMatic(hostname: string, credentials: string, ip: string): Promise<DdnsUpdateResult> {
  const response = await fetch("https://updates.dnsomatic.com/nic/update", {
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
  
  const response = await fetch(url);
  // Consider any 2xx response as success
  return response.ok
    ? providerResponseSuccess()
    : providerFailure("IP Link", response, await response.text());
}

// Check and update all enabled DDNS updaters
// If clientIp is provided, use it instead of fetching server's IP
export async function checkAndUpdateDdns(
  clientIp?: string,
  schedulerStorage: DdnsSchedulerStorage = storage,
): Promise<DdnsUpdateAttempt[]> {
  const updaters = await schedulerStorage.getDdnsUpdaters();
  const currentIp = clientIp || await getCurrentPublicIp();
  const results: DdnsUpdateAttempt[] = [];

  for (const updater of updaters) {
    if (!updater.isEnabled) continue;

    // Check if update is needed
    const lastUpdate = updater.lastUpdateTime ? new Date(updater.lastUpdateTime).getTime() : 0;
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdate; // in milliseconds

    if (timeSinceLastUpdate < (updater.updateInterval ?? DDNS_DEFAULT_INTERVAL_MS)) {
      continue; // Respect the configured provider write interval
    }

    // Avoid overlapping scheduler and manual updates for the same updater.
    if (activeDdnsUpdates.has(updater.id)) {
      continue;
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

// Start periodic DDNS check (runs every 5 minutes)
export function startDdnsScheduler(): NodeJS.Timer {
  const interval = setInterval(
    () => {
      checkAndUpdateDdns().catch((err) => console.error("DDNS scheduler error:", err));
    },
    5 * 60 * 1000 // 5 minutes
  );

  // Run immediately on startup
  checkAndUpdateDdns().catch((err) => console.error("Initial DDNS check failed:", err));

  return interval;
}
