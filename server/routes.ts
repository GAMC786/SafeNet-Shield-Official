import type { Express } from "express";
import express from "express";
import { randomInt } from "node:crypto";
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
  DDNS_DEFAULT_INTERVAL_MS,
  DDNS_MIN_INTERVAL_MS,
} from "@shared/schema";
import { DEFAULT_DNS_RESOLVER } from "@shared/dns-resolvers";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import {
  clearPinAttempts,
  getPinRetryAfterSeconds,
  recordFailedPinAttempt,
  createRequireAuthentication,
  createRequireExistingAuthentication,
  getClerkUserId,
} from "./auth";
import { hashPin, isHashedPin, verifyPin } from "./pin-security";
import {
  getGmailFailureStage,
  PIN_RECOVERY_CODE_TTL_MS,
  sendPinRecoveryCode,
  sendPinSecurityNotification,
} from "./gmail";

function publicSettings(settings: AppSettings) {
  const {
    pinCode: _pinCode,
    pinRecoveryCodeHash: _pinRecoveryCodeHash,
    pinRecoveryCodeExpiresAt: _pinRecoveryCodeExpiresAt,
    ...safeSettings
  } = settings;
  return {
    ...safeSettings,
    pinRecoveryEmail: safeSettings.pinRecoveryEmail ?? null,
    pinConfigured: Boolean(settings.pinCode),
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
    updateInterval: updater.updateInterval,
  };
}

function isSecureDdnsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
  routeStorage?: IStorage,
  options: {
    seed?: boolean;
    generatePinRecoveryCode?: () => string;
    sendPinRecoveryCode?: (to: string, code: string) => Promise<void>;
  } = {},
): Promise<Server> {
  const storage = routeStorage ?? defaultStorage;
  const generatePinRecoveryCode =
    options.generatePinRecoveryCode ?? (() => String(randomInt(100000, 1000000)));
  const deliverPinRecoveryCode = options.sendPinRecoveryCode ?? sendPinRecoveryCode;

  // These endpoints are the only unauthenticated API surface. The status
  // response contains no settings, PIN, or provider data.
  app.get(api.auth.status.path, async (req, res) => {
    // Authentication state changes after PIN verification. Prevent browsers
    // and proxies from replaying the pre-verification 304 response.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    const settings = await storage.getSettings();
    const pinRequired = settings.isPinEnabled === true;
    const clerkUserId = getClerkUserId(req);

    if (!pinRequired) {
      req.session.authenticated = true;
    }

    res.json({
      authenticated: req.session.authenticated === true || clerkUserId !== null,
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

    const parsed = api.settings.verifyPin.input.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "PIN must contain exactly four digits." });
    }

    const settings = await storage.getSettings();
    const valid = settings.isPinEnabled !== true || verifyPin(settings.pinCode, parsed.data.pin);

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
    if (settings.pinCode && !isHashedPin(settings.pinCode)) {
      await storage.updateSettings({ pinCode: hashPin(parsed.data.pin) });
    }
    req.session.authenticated = true;
    clearPinAttempts(req);

    res.json({ valid: true });
  });

  app.post("/api/settings/pin-recovery/request", async (req, res) => {
    const parsed = api.settings.requestPinRecovery.input.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ sent: false, message: "Enter a valid recovery email address." });
    }

    const settings = await storage.getSettings();
    const emailMatches = settings.pinRecoveryEmail?.toLowerCase() === parsed.data.email.toLowerCase();
    if (emailMatches && settings.isPinEnabled === true) {
      const code = generatePinRecoveryCode();
      await storage.updateSettings({
        pinRecoveryCodeHash: hashPin(code),
        pinRecoveryCodeExpiresAt: new Date(Date.now() + PIN_RECOVERY_CODE_TTL_MS),
      });
      try {
        await deliverPinRecoveryCode(parsed.data.email, code);
      } catch (error) {
        console.error(`PIN recovery email failed at Gmail ${getGmailFailureStage(error)} stage.`);
        return res.status(502).json({ sent: false, message: "The recovery email could not be sent. Check the Gmail connection and try again." });
      }
    }

    return res.json({
      sent: true,
      message: "If that address is configured for SafeNet, a recovery code will arrive shortly.",
    });
  });

  app.post("/api/settings/pin-recovery/reset", async (req, res) => {
    const retryAfter = getPinRetryAfterSeconds(req);
    if (retryAfter > 0) {
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ message: "Too many recovery attempts. Try again later." });
    }

    const parsed = api.settings.resetPinRecovery.input.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ valid: false, message: "Enter the recovery email, six-digit code, and a four-digit PIN." });
    }

    const resetApplied = await storage.resetPinWithRecoveryCode(
      parsed.data.email,
      parsed.data.code,
      parsed.data.pin,
    );
    if (!resetApplied) {
      recordFailedPinAttempt(req);
      return res.status(401).json({ valid: false, message: "The recovery code is invalid or expired." });
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    req.session.authenticated = true;
    clearPinAttempts(req);
    void sendPinSecurityNotification(parsed.data.email).catch((error) => {
      console.error("PIN recovery notification failed:", error);
    });
    return res.json({ valid: true });
  });

  // Device reporters must present an already-authenticated web session. This
  // route intentionally sits before the general middleware, which can
  // bootstrap a session when PIN protection is disabled.
  app.post(
    api.logs.ingest.path,
    createRequireExistingAuthentication(),
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

  // Every remaining API route, including the AI integrations, requires either
  // a Clerk session or the short-lived local PIN session created above.
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
      res.status(400).json({ message: err instanceof Error ? err.message : "Failed to create DNS resolver" });
    }
  });

  app.put(api.dns.update.path, async (req, res) => {
    try {
      const input = api.dns.update.input.parse(req.body);
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
      if (typeof input.pinCode === "string" && !/^\d{4}$/.test(input.pinCode)) {
        return res.status(400).json({ message: "PIN must contain exactly four digits." });
      }
      if (input.pinRecoveryEmail !== undefined && input.pinRecoveryEmail !== null) {
        const email = z.string().email().safeParse(input.pinRecoveryEmail);
        if (!email.success) {
          return res.status(400).json({ message: "Recovery email must be a valid email address." });
        }
      }
      const currentSettings = await storage.getSettings();
      const nextPinCode = input.pinCode === undefined ? currentSettings.pinCode : input.pinCode;
      const nextPinEnabled = input.isPinEnabled === undefined
        ? currentSettings.isPinEnabled
        : input.isPinEnabled;
      if (nextPinEnabled === true && !nextPinCode) {
        return res.status(400).json({
          message: "Set a four-digit PIN before enabling PIN protection.",
        });
      }
      const settings = await storage.updateSettings({
        ...input,
        ...(typeof input.pinCode === "string" ? { pinCode: hashPin(input.pinCode) } : {}),
      });
      if (typeof input.pinCode === "string" && settings.pinRecoveryEmail) {
        void sendPinSecurityNotification(settings.pinRecoveryEmail).catch((error) => {
          console.error("PIN security notification failed:", error);
        });
      }
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
       const parsedInterval = z.coerce.number().int().min(DDNS_MIN_INTERVAL_MS).safeParse(updateInterval);
       if (updateInterval !== undefined && !parsedInterval.success) {
         return res.status(400).json({
           message: `Update interval must be at least ${DDNS_MIN_INTERVAL_MS} milliseconds`,
         });
       }
       const updater = await storage.createDdnsUpdater({
        hostname,
        provider,
        apiKey: apiKey || "",
        customUrl: customUrl || null,
         updateInterval: parsedInterval.success ? parsedInterval.data : DDNS_DEFAULT_INTERVAL_MS,
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
       const parsedInterval = z.coerce.number().int().min(DDNS_MIN_INTERVAL_MS).safeParse(updateInterval);
       if (updateInterval !== undefined && !parsedInterval.success) {
         return res.status(400).json({
           message: `Update interval must be at least ${DDNS_MIN_INTERVAL_MS} milliseconds`,
         });
       }
       const updater = await storage.updateDdnsUpdater(id, {
        ...(hostname && { hostname }),
        ...(provider && { provider }),
        ...(apiKey !== undefined && { apiKey }),
        ...(customUrl !== undefined && { customUrl }),
         ...(updateInterval !== undefined && { updateInterval: parsedInterval.data }),
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
