import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { dnsServers, blocklists } from "@shared/schema";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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
    res.json(settings);
  });

  app.put(api.settings.update.path, async (req, res) => {
    try {
      const input = api.settings.update.input.parse(req.body);
      const settings = await storage.updateSettings(input);
      res.json(settings);
    } catch (err) {
      throw err;
    }
  });

  app.post(api.settings.verifyPin.path, async (req, res) => {
    const { pin } = req.body;
    const settings = await storage.getSettings();
    const valid = !settings.isPinEnabled || settings.pinCode === pin;
    res.json({ valid });
  });

  // === DDNS Updaters ===
  app.get("/api/ddns", async (req, res) => {
    const updaters = await storage.getDdnsUpdaters();
    res.json(updaters);
  });

  app.post("/api/ddns", async (req, res) => {
    try {
      const { hostname, provider, apiKey, updateInterval, isEnabled } = req.body;
      if (!hostname || !provider || !apiKey) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const updater = await storage.createDdnsUpdater({
        hostname,
        provider,
        apiKey,
        updateInterval: updateInterval || 3600,
        isEnabled: isEnabled !== false,
      });
      res.status(201).json(updater);
    } catch (err) {
      res.status(500).json({ message: "Failed to create DDNS updater" });
    }
  });

  app.patch("/api/ddns/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { hostname, provider, apiKey, updateInterval, isEnabled } = req.body;
      const updater = await storage.updateDdnsUpdater(id, {
        ...(hostname && { hostname }),
        ...(provider && { provider }),
        ...(apiKey && { apiKey }),
        ...(updateInterval && { updateInterval }),
        ...(typeof isEnabled === 'boolean' && { isEnabled }),
      });
      res.json(updater);
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
      const { checkAndUpdateDdns } = await import("./ddns-service");
      await checkAndUpdateDdns();
      const updaters = await storage.getDdnsUpdaters();
      res.json(updaters);
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
      const settings = await storage.updateAntivirusSettings(req.body);
      res.json(settings);
    } catch (err) {
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

  // === SEED DATA ===
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
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
        reason: isBlocked ? "security" : undefined,
      });
    }
  }
}
