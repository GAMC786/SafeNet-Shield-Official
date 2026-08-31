import type { Express } from "express";
import express from "express";
import type { Server } from "http";
import { storage as defaultStorage, type IStorage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import {
  type AppSettings,
  type DdnsUpdater,
  dnsServers,
  blocklists,
  insertAntivirusSettingsSchema,
} from "@shared/schema";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import {
  clearPinAttempts,
  getPinRetryAfterSeconds,
  recordFailedPinAttempt,
  createRequireAuthentication,
} from "./auth";

function publicSettings(settings: AppSettings) {
  const { pinCode: _pinCode, ...safeSettings } = settings;
  return safeSettings;
}

function publicDdnsUpdater(updater: DdnsUpdater) {
  const { apiKey: _apiKey, customUrl: _customUrl, ...safeUpdater } = updater;
  return safeUpdater;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  routeStorage?: IStorage,
  options: { seed?: boolean } = {},
): Promise<Server> {
  const storage = routeStorage ?? defaultStorage;

  // These endpoints are the only unauthenticated API surface. The status
  // response contains no settings, PIN, or provider data.
  app.get(api.auth.status.path, async (req, res) => {
    const settings = await storage.getSettings();
    const pinRequired = settings.isPinEnabled === true;

    if (!pinRequired) {
      req.session.authenticated = true;
    }

    res.json({
      authenticated: req.session.authenticated === true,
      pinRequired,
    });
  });

  app.post(api.settings.verifyPin.path, async (req, res) => {
    const retryAfter = getPinRetryAfterSeconds(req);
    if (retryAfter > 0) {
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({
        message: "Too many PIN attempts. Try again later.",
      });
    }

    const parsed = z.object({ pin: z.string() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "A PIN is required" });
    }

    const settings = await storage.getSettings();
    const valid = settings.isPinEnabled !== true || settings.pinCode === parsed.data.pin;

    if (!valid) {
      recordFailedPinAttempt(req);
      return res.status(401).json({
        valid: false,
        message: "Invalid PIN",
      });
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    req.session.authenticated = true;
    clearPinAttempts(req);

    res.json({ valid: true });
  });

  // Every remaining API route, including the AI integrations, requires the
  // short-lived server session created above.
  app.use("/api", createRequireAuthentication(storage));

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
      const server = await storage.createDnsServer(input);
      res.status(201).json(server);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.dns.update.path, async (req, res) => {
    try {
      const input = api.dns.update.input.parse(req.body);
      const server = await storage.updateDnsServer(Number(req.params.id), input);
      res.json(server);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(404).json({ message: "Server not found" });
    }
  });

  app.delete(api.dns.delete.path, async (req, res) => {
    await storage.deleteDnsServer(Number(req.params.id));
    res.status(204).send();
  });

  app.post(api.dns.activate.path, async (req, res) => {
    const server = await storage.activateDnsServer(Number(req.params.id));
    res.json(server);
  });

  // === Blocklists ===
  app.get(api.blocklists.list.path, async (req, res) => {
    const lists = await storage.getBlocklists();
    res.json(lists);
  });

  app.post(api.blocklists.create.path, async (req, res) => {
    try {
      const input = api.blocklists.create.input.parse(req.body);
      const list = await storage.createBlocklist(input);
      res.status(201).json(list);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete(api.blocklists.delete.path, async (req, res) => {
    await storage.deleteBlocklist(Number(req.params.id));
    res.status(204).send();
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
      if (provider !== "iplink" && !apiKey) {
        return res.status(400).json({ message: "API key is required" });
      }
      const updater = await storage.createDdnsUpdater({
        hostname,
        provider,
        apiKey: apiKey || "",
        customUrl: customUrl || null,
        updateInterval: updateInterval || 3600,
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
      const updater = await storage.updateDdnsUpdater(id, {
        ...(hostname && { hostname }),
        ...(provider && { provider }),
        ...(apiKey !== undefined && { apiKey }),
        ...(customUrl !== undefined && { customUrl }),
        ...(updateInterval && { updateInterval }),
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
      const { clientIp } = req.body;
      const { checkAndUpdateDdns } = await import("./ddns-service");
      await checkAndUpdateDdns(clientIp);
      const updaters = await storage.getDdnsUpdaters();
      res.json(updaters.map(publicDdnsUpdater));
    } catch (err) {
      res.status(500).json({ message: "Failed to update DDNS" });
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
      await checkAndUpdateDdns(clientIp);
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
      const { name, sourceInterface, sourceAddress, destinationInterface, destinationAddress, service, action } = req.body;
      if (!name || !sourceInterface || !destinationInterface || !service || !action) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const rule = await storage.createFirewallRule({
        name,
        sourceInterface,
        sourceAddress: sourceAddress || "Any",
        destinationInterface,
        destinationAddress: destinationAddress || "Any",
        service,
        action,
      });
      res.status(201).json(rule);
    } catch (err) {
      res.status(500).json({ message: "Failed to create firewall rule" });
    }
  });

  app.patch("/api/firewall/rules/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const rule = await storage.updateFirewallRule(id, req.body);
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
      const feed = await storage.updateThreatFeed(Number(req.params.id), req.body);
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

  // === Simulate Traffic ===
  app.post("/api/simulate-traffic", async (req, res) => {
    try {
      const domains = [
        "google.com", "facebook.com", "amazon.com", "twitter.com", "github.com",
        "ads.tracking.com", "malware.badsite.net", "phishing.scam.org", 
        "news.com", "reddit.com", "youtube.com", "netflix.com"
      ];
      const protocols = ["DoH", "DoT", "Plain"];
      const reasons = ["blocklist", "security", "ai_shield", "firewall", null];
      
      const numLogs = 5 + Math.floor(Math.random() * 10);
      const createdLogs = [];
      
      for (let i = 0; i < numLogs; i++) {
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const isThreat = domain.includes("malware") || domain.includes("phishing") || domain.includes("tracking");
        const isBlocked = isThreat || Math.random() > 0.75;
        
        const log = await storage.createLog({
          domain,
          protocol: protocols[Math.floor(Math.random() * protocols.length)],
          status: isBlocked ? "blocked" : "allowed",
          reason: isBlocked ? reasons[Math.floor(Math.random() * (reasons.length - 1))] : null,
        });
        createdLogs.push(log);
      }
      
      res.json({ message: `Simulated ${numLogs} DNS queries`, logs: createdLogs });
    } catch (err) {
      res.status(500).json({ message: "Failed to simulate traffic" });
    }
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
  // Download test - returns random data for speed measurement
  app.get("/api/speedtest/download", (req, res) => {
    const size = parseInt(req.query.size as string) || 1000000; // Default 1MB
    const maxSize = 10000000; // Max 10MB
    const actualSize = Math.min(size, maxSize);
    
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", actualSize);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    
    // Generate random data in chunks
    const chunkSize = 65536; // 64KB chunks
    let remaining = actualSize;
    
    const sendChunk = () => {
      while (remaining > 0) {
        const size = Math.min(chunkSize, remaining);
        const chunk = Buffer.alloc(size, Math.random() * 255);
        const canContinue = res.write(chunk);
        remaining -= size;
        if (!canContinue) {
          res.once("drain", sendChunk);
          return;
        }
      }
      res.end();
    };
    
    sendChunk();
  });

  // Upload test - receives data and measures speed
  app.post("/api/speedtest/upload", express.raw({ type: "application/octet-stream", limit: "10mb" }), (req, res) => {
    const startTime = Date.now();
    const bytesReceived = Buffer.isBuffer(req.body) ? req.body.length : 0;
    const duration = Math.max((Date.now() - startTime) / 1000, 0.001);
    const speedMbps = (bytesReceived * 8) / (duration * 1000000);
    res.json({ 
      bytesReceived, 
      duration, 
      speedMbps: Math.round(speedMbps * 100) / 100 
    });
  });

  // Ping test
  app.get("/api/speedtest/ping", (req, res) => {
    res.json({ timestamp: Date.now() });
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
    await storage.createDnsServer({
      name: "SafeNet Default (DoH)",
      type: "doh",
      primaryAddress: "https://dns.google/dns-query",
      secondaryAddress: "https://cloudflare-dns.com/dns-query",
      isActive: true,
      isCustom: false
    });
    await storage.createDnsServer({
      name: "AdGuard (Plain)",
      type: "plain",
      primaryAddress: "94.140.14.14",
      secondaryAddress: "94.140.15.15",
      isActive: false,
      isCustom: false
    });
    await storage.createDnsServer({
      name: "Cloudflare Family (DoT)",
      type: "dot",
      primaryAddress: "1.1.1.3",
      secondaryAddress: "1.0.0.3",
      isActive: false,
      isCustom: false
    });
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

  // Generate some fake logs for visualization
  const existingLogs = await storage.getLogs(1);
  if (existingLogs.length === 0) {
    const domains = ["google.com", "facebook.com", "ads.tracker.net", "malware-site.org", "news.com"];
    for (let i = 0; i < 20; i++) {
      const isBlocked = Math.random() > 0.7;
      await storage.createLog({
        domain: domains[Math.floor(Math.random() * domains.length)],
        protocol: Math.random() > 0.5 ? "DoH" : "DoT",
        status: isBlocked ? "blocked" : "allowed",
        reason: isBlocked ? "security" : null,
      });
    }
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
