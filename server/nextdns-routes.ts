import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { IStorage } from "./storage";
import { getRequestUserId, requireAuth } from "./auth";
import { decryptNextDnsToken, encryptNextDnsToken } from "./nextdns-crypto";
import { NextDnsApiError, syncNextDnsRules, verifyNextDnsProfile } from "./nextdns-api";
import { FamilyDnsApiError, getNextDnsBlocklists, setNextDnsBlocklist } from "./family-dns-api";

const connectSchema = z.object({
  token: z.string().trim().min(1).max(2048),
  profileId: z.string().trim().regex(/^[a-zA-Z0-9]{4,24}$/),
}).strict();

function sendError(error: unknown, res: Response) {
  if (error instanceof NextDnsApiError) {
    return res.status(error.rejected ? 400 : 502).json({
      message: error.rejected
        ? "NextDNS rejected the API key or profile ID."
        : "NextDNS is temporarily unavailable.",
    });
  }
  return res.status(503).json({ message: "SafeNet could not access the NextDNS connection." });
}

export function registerNextDnsRoutes(
  app: Express,
  storage: IStorage,
  fetchImpl: typeof fetch = fetch,
  auth: { requireAuth?: RequestHandler; getUserId?: (req: Request) => string | null } = {},
) {
  const authGate = auth.requireAuth ?? requireAuth;
  const getUserId = auth.getUserId ?? getRequestUserId;
  const ownerId = (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Sign in is required to manage NextDNS." });
      return null;
    }
    return userId;
  };

  app.get("/api/nextdns/connection", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    const credential = await storage.getNextDnsCredential(userId);
    return res.json({
      connected: Boolean(credential),
      profileId: credential?.profileId ?? null,
      lastSyncedAt: credential?.lastSyncedAt?.toISOString() ?? null,
    });
  });

  app.post("/api/nextdns/connection", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter a valid NextDNS API key and profile ID." });
    try {
      const encrypted = encryptNextDnsToken(parsed.data.token, userId);
      await verifyNextDnsProfile(parsed.data.token, parsed.data.profileId, fetchImpl);
      const saved = await storage.saveNextDnsCredential(userId, {
        profileId: parsed.data.profileId,
        ...encrypted,
      });
      return res.json({ connected: true, profileId: saved.profileId });
    } catch (error) {
      return sendError(error, res);
    }
  });

  app.delete("/api/nextdns/connection", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    await storage.deleteNextDnsCredential(userId);
    return res.status(204).send();
  });

  app.get("/api/nextdns/blocklists", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    try {
      const credential = await storage.getNextDnsCredential(userId);
      if (!credential) return res.status(409).json({ message: "Connect a NextDNS profile before managing its blocklists." });
      return res.json({
        profileId: credential.profileId,
        lists: await getNextDnsBlocklists(decryptNextDnsToken(credential, userId), credential.profileId),
      });
    } catch (error) {
      if (error instanceof FamilyDnsApiError) {
        return res.status(error.rejected ? 400 : 502).json({
          message: error.rejected ? "NextDNS rejected this request or profile." : "NextDNS blocklists are temporarily unavailable.",
        });
      }
      return sendError(error, res);
    }
  });

  app.patch("/api/nextdns/blocklists/:listId", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    const listId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/).safeParse(req.params.listId);
    const body = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!listId.success || !body.success) return res.status(400).json({ message: "Choose a valid NextDNS blocklist and enabled state." });
    try {
      const credential = await storage.getNextDnsCredential(userId);
      if (!credential) return res.status(409).json({ message: "Connect a NextDNS profile before managing its blocklists." });
      return res.json({
        profileId: credential.profileId,
        lists: await setNextDnsBlocklist(
          decryptNextDnsToken(credential, userId),
          credential.profileId,
          listId.data,
          body.data.enabled,
        ),
      });
    } catch (error) {
      if (error instanceof FamilyDnsApiError) {
        return res.status(error.rejected ? 400 : 502).json({
          message: error.rejected ? "NextDNS rejected this blocklist or profile." : "NextDNS blocklists are temporarily unavailable.",
        });
      }
      return sendError(error, res);
    }
  });

  app.post("/api/nextdns/sync", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    try {
      const credential = await storage.getNextDnsCredential(userId);
      if (!credential) return res.status(409).json({ message: "Connect a NextDNS profile before syncing." });
      const localEntries = await storage.getBlocklists();
      const settings = await storage.getSettings();
      const activeEntries = localEntries.filter((entry) => entry.isActive);
      const validDomainEntries = activeEntries
        .filter((entry) => entry.type === "domain")
        .map((entry) => ({
          domain: entry.content.trim().toLowerCase(),
          action: entry.action === "allow" ? "allow" as const : "block" as const,
        }))
        .filter((entry) => entry.domain.length <= 253 && entry.domain.split(".").every(
          (label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i.test(label),
        ));
      const skipped = activeEntries.length - validDomainEntries.length;
      const desired = settings.firewallEnabled ? validDomainEntries : [];
      const token = decryptNextDnsToken(credential, userId);
      const syncedRules = await syncNextDnsRules(token, credential.profileId, desired, credential.syncedRules, fetchImpl);
      await storage.updateNextDnsSyncedRules(userId, syncedRules);
      return res.json({
        synced: syncedRules.length,
        skipped,
        message: !settings.firewallEnabled
          ? "DNS Firewall is off; SafeNet-managed rules were removed from NextDNS."
          : skipped
          ? `${skipped} active keyword or URL rule(s) were skipped; NextDNS accepts DNS domains only.`
          : "DNS firewall rules synced to NextDNS.",
      });
    } catch (error) {
      return sendError(error, res);
    }
  });
}
