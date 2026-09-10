import type { Express } from "express";
import express from "express";
import { isIP } from "node:net";
import type { Server } from "http";
import { storage as defaultStorage, type IStorage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import {
  type AppSettings,
  type DdnsUpdater,
  dnsServers,
  blocklists,
  firewallConfigSchema,
  insertAntivirusSettingsSchema,
  insertFirewallRuleSchema,
  DDNS_DEFAULT_INTERVAL_SECONDS,
  DDNS_DEFAULT_INTERVAL_MS,
  DDNS_MIN_INTERVAL_MINUTES,
  DDNS_MIN_INTERVAL_SECONDS,
  DDNS_MIN_INTERVAL_MS,
} from "@shared/schema";
import { DEFAULT_DNS_RESOLVER } from "@shared/dns-resolvers";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";

function publicSettings(settings: AppSettings) {
  const {
    pinCode: _pinCode,
    pinRecoveryEmail: _pinRecoveryEmail,
    pinRecoveryCodeHash: _pinRecoveryCodeHash,
    pinRecoveryCodeExpiresAt: _pinRecoveryCodeExpiresAt,
    isPinEnabled: _isPinEnabled,
    ...safeSettings
  } = settings;
  return {
    ...safeSettings,
    // Existing installations may predate the setting. The safe default is to
    // keep resolver override protection on until the user explicitly turns it
    // off.
    preventDnsOverrides: settings.preventDnsOverrides ?? true,
  };
}

function publicDdnsUpdater(updater: DdnsUpdater) {
  return {
    id: updater.id,
    hostname: updater.hostname,
    provider: updater.provider,
    lastIpAddress: updater.lastIpAddress,
    lastUpdateTime: updater.lastUpdateTime,
    lastFailureMessage: updater.lastFailureMessage,
    lastFailureTime: updater.lastFailureTime,
    isEnabled: updater.isEnabled,
    updateInterval: updater.updateInterval === null
      ? DDNS_DEFAULT_INTERVAL_SECONDS
      : Math.max(DDNS_MIN_INTERVAL_MINUTES, Math.round(updater.updateInterval / 60000)),
  };
}

function isSecureDdnsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validateDnsResolverAddresses(input: {
  type?: string;
  ipVersion?: string;
  primaryAddress?: string;
  secondaryAddress?: string | null;
}) {
  const type = input.type ?? "plain";
  const ipVersion = input.ipVersion ?? "ipv4";
  const expectedFamily = ipVersion === "ipv6" ? 6 : 4;
  const addresses = [input.primaryAddress, input.secondaryAddress].filter(
    (address): address is string => Boolean(address?.trim()),
  );
  if (!addresses.length) throw new Error("A primary DNS resolver address is required.");
  if (type === "plain") {
    for (const address of addresses) {
      if (isIP(address.trim()) !== expectedFamily) {
        throw new Error(`Every plain DNS address must be a valid ${ipVersion === "ipv6" ? "IPv6" : "IPv4"} address.`);
      }
    }
    return;
  }
  for (const address of addresses) {
    if (type === "doh") {
      if (new URL(address).protocol !== "https:") {
        throw new Error("DNS over HTTPS endpoints must use HTTPS.");
      }
    } else if (type === "dot" && !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(address) && isIP(address) !== expectedFamily) {
      throw new Error("DNS over TLS endpoints must be a hostname or a matching IP address.");
    }
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  routeStorage?: IStorage,
  options: { seed?: boolean } = {},
): Promise<Server> {
  const storage = routeStorage ?? defaultStorage;
  app.post(
    api.logs.ingest.path,
    async (req, res) => {
      try {
        const input = api.logs.ingest.input.parse(req.body);
        const log = await storage.createLog({
          ...input,
          source: "android",
        });
        res.status(201).json(log);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        throw err;
      }
    },
  );

  // Register AI Integrations
  registerChatRoutes(app);
  registerImageRoutes(app);

  // === DNS Servers ===
  app.get(api.dns.list.path, async (req, res) => {
    const servers = await storage.getDnsServers();
    res.json(servers);
  });

  app.post(api.dns.create.path, async (req, res) => {
    try {
      const input = api.dns.create.input.parse(req.body);
      validateDnsResolverAddresses(input);
      const server = await storage.createDnsServer(input);
      res.status(201).json(server);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to create DNS resolver" });
    }
  });

  app.put(api.dns.update.path, async (req, res) => {
    try {
      const input = api.dns.update.input.parse(req.body);
      const current = await storage.getDnsServers();
      const existing = current.find((server) => server.id === Number(req.params.id));
      if (!existing) {
        return res.status(404).json({ message: "DNS resolver not found" });
      }
      validateDnsResolverAddresses({ ...existing, ...input });
      const server = await storage.updateDnsServer(Number(req.params.id), input);
      if (!server) {
        return res.status(404).json({ message: "DNS resolver not found" });
      }
      res.json(server);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(404).json({ message: "DNS resolver not found" });
    }
  });

  app.delete(api.dns.delete.path, async (req, res) => {
    try {
      await storage.deleteDnsServer(Number(req.params.id));
      res.status(204).send();
    } catch (err) {
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to remove DNS resolver" });
    }
  });

  app.post(api.dns.activate.path, async (req, res) => {
    try {
      const server = await storage.activateDnsServer(Number(req.params.id));
      res.json(server);
    } catch (err) {
      res.status(404).json({ message: err instanceof Error ? err.message : "DNS resolver not found" });
    }
  });

  // === Blocklists ===
  app.get(api.blocklists.list.path, async (req, res) => {
    const lists = await storage.getBlocklists();
    res.json(lists);
  });

  app.post(api.blocklists.create.path, async (req, res) => {
    try {
      const input = api.blocklists.create.input.parse(req.body);
      if (!input.content.trim()) {
        return res.status(400).json({ message: "Filter content is required." });
      }
      if (input.type === "keyword" && input.action === "allow") {
        return res.status(400).json({ message: "Keyword filters can only block matching requests." });
      }
      const list = await storage.createBlocklist(input);
      res.status(201).json(list);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.patch(api.blocklists.update.path, async (req, res) => {
    try {
      const input = api.blocklists.update.input.parse(req.body);
      if (input.content !== undefined && !input.content.trim()) {
        return res.status(400).json({ message: "Filter content is required." });
      }
      if (input.type === "keyword" && input.action === "allow") {
        return res.status(400).json({ message: "Keyword filters can only block matching requests." });
      }
      const list = await storage.updateBlocklist(Number(req.params.id), input);
      res.json(list);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(404).json({ message: "Blocklist entry not found" });
    }
  });

  app.delete(api.blocklists.delete.path, async (req, res) => {
    await storage.deleteBlocklist(Number(req.params.id));
    res.status(204).send();
  });

  app.get(api.firewall.config.path, async (req, res) => {
    const [settings, rules, lists] = await Promise.all([
      storage.getSettings(),
      storage.getFirewallRules(),
      storage.getBlocklists(),
    ]);
    res.json(firewallConfigSchema.parse({
      settings: publicSettings(settings),
      rules,
      blocklists: lists,
    }));
  });

  // === Logs ===
  app.get(api.logs.list.path, async (req, res) => {
    const logs = await storage.getLogs(50);
    res.json(logs);
  });

  app.get(api.logs.stats.path, async (req, res) => {
    const stats = await storage.getStats();
    res.json(stats);
  });

  // === Settings ===
  app.get(api.settings.get.path, async (req, res) => {
    const settings = await storage.getSettings();
    res.json(publicSettings(settings));
  });

  app.put(api.settings.update.path, async (req, res) => {
    try {
      const input = api.settings.update.input.parse(req.body);
      const settings = await storage.updateSettings(input);
      res.json(publicSettings(settings));
    } catch (err) {
      throw err;
    }
  });

  // === DDNS Updaters ===
  app.get("/api/ddns", async (req, res) => {
    const updaters = await storage.getDdnsUpdaters();
    res.json(updaters.map(publicDdnsUpdater));
  });

  app.post("/api/ddns", async (req, res) => {
    try {
      const { hostname, provider, apiKey, customUrl, updateInterval, isEnabled } = req.body;
      if (!hostname || !provider) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      // IP Link requires customUrl, others require apiKey
      if (provider === "iplink" && !customUrl) {
        return res.status(400).json({ message: "Custom URL is required for IP Link provider" });
      }
      if (provider === "iplink" && customUrl && !isSecureDdnsUrl(customUrl)) {
        return res.status(400).json({ message: "IP Link custom URLs must use HTTPS" });
      }
      if (provider !== "iplink" && !apiKey) {
        return res.status(400).json({ message: "API key is required" });
      }
       const parsedInterval = z.coerce.number().int().min(DDNS_MIN_INTERVAL_MINUTES).safeParse(updateInterval);
       if (updateInterval !== undefined && !parsedInterval.success) {
         return res.status(400).json({
           message: `Update interval must be at least ${DDNS_MIN_INTERVAL_MINUTES} minute`,
         });
       }
       const updater = await storage.createDdnsUpdater({
        hostname,
        provider,
        apiKey: apiKey || "",
        customUrl: customUrl || null,
          updateInterval: parsedInterval.success
             ? parsedInterval.data * 60000
            : DDNS_DEFAULT_INTERVAL_MS,
        isEnabled: isEnabled !== false,
      });
      res.status(201).json(publicDdnsUpdater(updater));
    } catch (err) {
      res.status(500).json({ message: "Failed to create DDNS updater" });
    }
  });

  app.patch("/api/ddns/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { hostname, provider, apiKey, customUrl, updateInterval, isEnabled } = req.body;
      if (customUrl !== undefined && customUrl && !isSecureDdnsUrl(customUrl)) {
        return res.status(400).json({ message: "IP Link custom URLs must use HTTPS" });
      }
        const parsedInterval = z.coerce.number().int().min(DDNS_MIN_INTERVAL_MINUTES).safeParse(updateInterval);
       if (updateInterval !== undefined && !parsedInterval.success) {
         return res.status(400).json({
           message: `Update interval must be at least ${DDNS_MIN_INTERVAL_MINUTES} minute`,
         });
       }
       const updater = await storage.updateDdnsUpdater(id, {
        ...(hostname && { hostname }),
        ...(provider && { provider }),
        ...(apiKey !== undefined && { apiKey }),
        ...(customUrl !== undefined && { customUrl }),
          ...(updateInterval !== undefined && parsedInterval.success
             ? { updateInterval: parsedInterval.data * 60000 }
            : {}),
        ...(typeof isEnabled === 'boolean' && { isEnabled }),
      });
      res.json(publicDdnsUpdater(updater));
    } catch (err) {
      res.status(404).json({ message: "DDNS updater not found" });
    }
  });

  app.delete("/api/ddns/:id", async (req, res) => {
    try {
      await storage.deleteDdnsUpdater(Number(req.params.id));
      res.status(204).send();
    } catch (err) {
      res.status(404).json({ message: "DDNS updater not found" });
    }
  });

  app.post("/api/ddns/:id/update", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { clientIp } = req.body;
      const { checkAndUpdateDdns } = await import("./ddns-service");
      const results = await checkAndUpdateDdns(clientIp, storage, id);
      const failures = results.filter((result) => !result.success);
      if (failures.length > 0) {
        return res.status(502).json({
          message: `DDNS provider update failed: ${failures.map((failure) => `${failure.hostname}: ${failure.error}`).join("; ")}`,
          results,
        });
      }
      const updaters = await storage.getDdnsUpdaters();
      res.json(updaters.map(publicDdnsUpdater));
    } catch (err) {
      res.status(500).json({ message: "Failed to update DDNS" });
    }
  });

  app.post("/api/ddns/:id/test", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const updater = (await storage.getDdnsUpdaters()).find((entry) => entry.id === id);
      if (!updater) {
        return res.status(404).json({ message: "DDNS updater not found" });
      }
      const { testDdnsConnection } = await import("./ddns-service");
      const result = await testDdnsConnection(updater.provider, updater.customUrl);
      if (!result.success) {
        return res.status(502).json({ message: result.error });
      }
      return res.json({
        success: true,
        provider: updater.provider,
        hostname: updater.hostname,
        message: "Provider endpoint is reachable. No DNS record was changed.",
      });
    } catch (error) {
      return res.status(500).json({ message: "DDNS connectivity test failed" });
    }
  });

  // Update all DDNS with client-provided IP
  app.post("/api/ddns/update-all", async (req, res) => {
    try {
      const { clientIp } = req.body;
      if (!clientIp) {
        return res.status(400).json({ message: "Client IP is required" });
      }
      const { checkAndUpdateDdns } = await import("./ddns-service");
      const results = await checkAndUpdateDdns(clientIp, storage);
      const failures = results.filter((result) => !result.success);
      if (failures.length > 0) {
        return res.status(502).json({
          message: `DDNS provider update failed: ${failures.map((failure) => `${failure.hostname}: ${failure.error}`).join("; ")}`,
          results,
        });
      }
      const updaters = await storage.getDdnsUpdaters();
      res.json(updaters.map(publicDdnsUpdater));
    } catch (err) {
      res.status(500).json({ message: "Failed to update DDNS" });
    }
  });

  // === Firewall Rules ===
  app.get("/api/firewall/rules", async (req, res) => {
    const rules = await storage.getFirewallRules();
    res.json(rules);
  });

  app.post("/api/firewall/rules", async (req, res) => {
    try {
      const parsed = insertFirewallRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid firewall rule" });
      }
      const rule = await storage.createFirewallRule({
        ...parsed.data,
        name: parsed.data.name.trim(),
        sourceAddress: parsed.data.sourceAddress?.trim() || "Any",
        destinationAddress: parsed.data.destinationAddress?.trim() || "Any",
      });
      res.status(201).json(rule);
    } catch (err) {
      res.status(500).json({ message: "Failed to create firewall rule" });
    }
  });

  app.patch("/api/firewall/rules/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = insertFirewallRuleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid firewall rule" });
      }
      const rule = await storage.updateFirewallRule(id, {
        ...parsed.data,
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(typeof parsed.data.sourceAddress === "string" ? { sourceAddress: parsed.data.sourceAddress.trim() || "Any" } : {}),
        ...(typeof parsed.data.destinationAddress === "string" ? { destinationAddress: parsed.data.destinationAddress.trim() || "Any" } : {}),
      });
      if (!rule) {
        return res.status(404).json({ message: "Firewall rule not found" });
      }
      res.json(rule);
    } catch (err) {
      res.status(404).json({ message: "Firewall rule not found" });
    }
  });

  app.delete("/api/firewall/rules/:id", async (req, res) => {
    try {
      await storage.deleteFirewallRule(Number(req.params.id));
      res.status(204).send();
    } catch (err) {
      res.status(404).json({ message: "Firewall rule not found" });
    }
  });

  // === Antivirus ===
  app.get("/api/antivirus/settings", async (req, res) => {
    const settings = await storage.getAntivirusSettings();
    res.json(settings);
  });

  app.get("/api/antivirus/clamav/status", async (_req, res) => {
    const { getClamAvStatus } = await import("./clamav-service");
    res.json(await getClamAvStatus());
  });

  app.post(
    "/api/antivirus/clamav/scan",
    express.raw({ type: "application/octet-stream", limit: "64mb" }),
    async (req, res) => {
      try {
        const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const { scanWithClamAv } = await import("./clamav-service");
        res.json(await scanWithClamAv(payload));
      } catch (error) {
        res.status(503).json({
          message: error instanceof Error ? error.message : "ClamAV REST scan failed.",
        });
      }
    },
  );

  app.put("/api/antivirus/settings", async (req, res) => {
    try {
      const parsed = insertAntivirusSettingsSchema.partial().parse(req.body);
      const input = Object.fromEntries(
        Object.entries(parsed).filter(([_, v]) => v !== undefined)
      );
      const settings = await storage.updateAntivirusSettings(input);
      res.json(settings);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Failed to update antivirus settings" });
    }
  });

  app.get("/api/antivirus/feeds", async (req, res) => {
    const feeds = await storage.getThreatFeeds();
    res.json(feeds);
  });

  app.post("/api/antivirus/feeds", async (req, res) => {
    try {
      const { name, type, url, isEnabled } = req.body;
      if (!name || !type) {
        return res.status(400).json({ message: "Name and type are required" });
      }
      const feed = await storage.createThreatFeed({ name, type, url, isEnabled });
      res.status(201).json(feed);
    } catch (err) {
      res.status(500).json({ message: "Failed to create threat feed" });
    }
  });

  app.patch("/api/antivirus/feeds/:id", async (req, res) => {
    try {
      if (req.body.isEnabled !== undefined && typeof req.body.isEnabled !== "boolean") {
        return res.status(400).json({ message: "isEnabled must be a boolean" });
      }
      const feed = await storage.updateThreatFeed(Number(req.params.id), req.body);
      if (!feed) {
        return res.status(404).json({ message: "Threat feed not found" });
      }
      res.json(feed);
    } catch (err) {
      res.status(404).json({ message: "Threat feed not found" });
    }
  });

  app.delete("/api/antivirus/feeds/:id", async (req, res) => {
    try {
      await storage.deleteThreatFeed(Number(req.params.id));
      res.status(204).send();
    } catch (err) {
      res.status(404).json({ message: "Threat feed not found" });
    }
  });

  app.get("/api/antivirus/events", async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const events = await storage.getAntivirusEvents(limit);
    res.json(events);
  });

  app.post("/api/antivirus/events", async (req, res) => {
    try {
      const event = await storage.createAntivirusEvent(req.body);
      res.status(201).json(event);
    } catch (err) {
      res.status(500).json({ message: "Failed to create antivirus event" });
    }
  });

  app.patch("/api/antivirus/events/:id/resolve", async (req, res) => {
    try {
      const event = await storage.resolveAntivirusEvent(Number(req.params.id));
      res.json(event);
    } catch (err) {
      res.status(404).json({ message: "Event not found" });
    }
  });

  app.get("/api/antivirus/stats", async (req, res) => {
    const stats = await storage.getAntivirusStats();
    res.json(stats);
  });

  // === Get Public IP ===
  app.get("/api/public-ip", async (req, res) => {
    try {
      const { getCurrentPublicIp } = await import("./ddns-service");
      const ip = await getCurrentPublicIp();
      res.json({ ip });
    } catch (err) {
      res.status(500).json({ message: "Failed to get public IP" });
    }
  });

  // === Speed Test ===
  // Download test - returns uncached, incompressible data for client-side timing.
  // Keep the standard payload ready so server-side random-data generation does
  // not become part of the measured network throughput.
  const standardSpeedTestPayload = Buffer.alloc(4_000_000, 0xa5);
  app.get("/api/speedtest/download", (req, res) => {
    const size = parseInt(req.query.size as string) || 1000000; // Default 1MB
    const maxSize = 10000000; // Max 10MB
    const actualSize = Math.min(size, maxSize);
    const payload = actualSize === standardSpeedTestPayload.length
      ? standardSpeedTestPayload
      : Buffer.alloc(actualSize, 0xa5);
    
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", actualSize);
    res.setHeader("Content-Encoding", "identity");
    res.setHeader("X-SpeedTest-Bytes", actualSize);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    
    // End with the complete fixed-length buffer. Streaming through the
    // development proxy can be truncated before the drain callback fires,
    // which makes the client measure a partial download.
    res.end(payload);
  });

  // Upload test - receives the full payload so the client can measure the
  // complete request round trip with the same clock used for downloads.
  app.post("/api/speedtest/upload", express.raw({ type: "application/octet-stream", limit: "10mb" }), (req, res) => {
    const bytesReceived = Buffer.isBuffer(req.body) ? req.body.length : 0;
    if (bytesReceived === 0) {
      return res.status(400).json({ message: "The upload payload was empty." });
    }
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("X-SpeedTest-Bytes", bytesReceived);
    return res.json({ bytesReceived });
  });

  // Ping test
  app.get("/api/speedtest/ping", (req, res) => {
    res.json({ timestamp: Date.now() });
  });

  // LibreSpeed-compatible same-origin endpoints. The React page uses the
  // LibreSpeed measurement pattern while keeping SafeNet's existing UI.
  app.get("/api/speedtest/librespeed/garbage.php", (req, res) => {
    const size = Math.min(Math.max(Number.parseInt(String(req.query.size ?? "4000000"), 10) || 4_000_000, 256_000), 10_000_000);
    const payload = size === standardSpeedTestPayload.length
      ? standardSpeedTestPayload
      : Buffer.alloc(size, 0xa5);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", payload.length);
    res.setHeader("Content-Encoding", "identity");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("X-SpeedTest-Bytes", payload.length);
    res.end(payload);
  });

  app.all(
    "/api/speedtest/librespeed/empty.php",
    express.raw({ type: "*/*", limit: "64mb" }),
    (_req, res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.status(204).end();
    },
  );

  app.get("/api/speedtest/librespeed/getIP.php", (req, res) => {
    const clientIp = String(req.ip ?? "").replace(/^::ffff:/, "");
    res.json({ processedString: clientIp, rawIspInfo: "" });
  });

  // === SEED DATA ===
  if (options.seed !== false) {
    await seedDatabase(storage);
  }

  return httpServer;
}

async function seedDatabase(storage: IStorage) {
  const existingServers = await storage.getDnsServers();
  if (existingServers.length === 0) {
    await storage.createDnsServer(DEFAULT_DNS_RESOLVER);
  }

  const existingBlocklists = await storage.getBlocklists();
  if (existingBlocklists.length === 0) {
    await storage.createBlocklist({
      type: "domain",
      content: "ads.example.com",
      category: "ads",
      isActive: true
    });
    await storage.createBlocklist({
      type: "keyword",
      content: "gambling",
      category: "adult",
      isActive: true
    });
  }

  // Seed threat feeds if none exist
  const existingFeeds = await storage.getThreatFeeds();
  if (existingFeeds.length === 0) {
    await storage.createThreatFeed({
      name: "Malware Domains",
      type: "malware",
      url: "https://malwaredomains.com/list",
      isEnabled: true,
    });
    await storage.createThreatFeed({
      name: "Phishing Database",
      type: "phishing",
      url: "https://phishtank.org/list",
      isEnabled: true,
    });
    await storage.createThreatFeed({
      name: "Ransomware Tracker",
      type: "ransomware",
      url: "https://ransomwaretracker.abuse.ch/list",
      isEnabled: false,
    });
  }
}
