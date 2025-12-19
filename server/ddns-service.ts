import { storage } from "./storage";

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
  ipAddress: string
): Promise<boolean> {
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
      default:
        console.warn(`Unsupported DDNS provider: ${provider}`);
        return false;
    }
  } catch (error) {
    console.error(`Failed to update DDNS for ${hostname}:`, error);
    return false;
  }
}

async function updateDuckDns(hostname: string, token: string, ip: string): Promise<boolean> {
  const response = await fetch(
    `https://www.duckdns.org/update?domains=${hostname}&token=${token}&ip=${ip}`
  );
  const text = await response.text();
  return text.includes("OK");
}

async function updateNoIp(hostname: string, authToken: string, ip: string): Promise<boolean> {
  const response = await fetch("https://dynupdate.no-ip.com/nic/update", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authToken}`,
    },
    body: new URLSearchParams({ hostname, myip: ip }).toString(),
  });
  return response.ok;
}

async function updateDynu(hostname: string, apiKey: string, ip: string): Promise<boolean> {
  const response = await fetch("https://api.dynu.com/v2/dns", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hostname, ipv4: ip }),
  });
  return response.ok;
}

async function updateDnsOMatic(hostname: string, credentials: string, ip: string): Promise<boolean> {
  const response = await fetch("https://updates.dnsomatic.com/nic/update", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({ hostname, myip: ip }).toString(),
  });
  const text = await response.text();
  return text.includes("good") || text.includes("nochg");
}

// Check and update all enabled DDNS updaters
export async function checkAndUpdateDdns(): Promise<void> {
  const updaters = await storage.getDdnsUpdaters();
  const currentIp = await getCurrentPublicIp();

  for (const updater of updaters) {
    if (!updater.isEnabled) continue;

    // Check if update is needed
    const lastUpdate = updater.lastUpdateTime ? new Date(updater.lastUpdateTime).getTime() : 0;
    const now = Date.now();
    const timeSinceLastUpdate = (now - lastUpdate) / 1000; // in seconds

    if (timeSinceLastUpdate < updater.updateInterval && updater.lastIpAddress === currentIp) {
      continue; // No need to update
    }

    // Perform update
    const success = await updateDnsRecord(
      updater.hostname,
      updater.provider,
      updater.apiKey,
      currentIp
    );

    if (success) {
      await storage.updateDdnsIpInfo(updater.id, currentIp);
      console.log(`DDNS updated for ${updater.hostname}: ${currentIp}`);
    }
  }
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
