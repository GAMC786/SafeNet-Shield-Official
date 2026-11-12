import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { IStorage } from "./storage";
import { getRequestUserId, requireAuth } from "./auth";
import { decryptFamilyDnsToken, encryptFamilyDnsToken } from "./family-dns-crypto";
import { FamilyDnsApiError, syncFamilyDnsRules, verifyFamilyDnsAccount, type FamilyDnsProvider } from "./family-dns-api";

const providerSchema = z.enum(["adguard", "cleanbrowsing"]);
const connectionSchema = z.object({
  provider: providerSchema,
  profileId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/),
  token: z.string().trim().min(1).max(2048),
}).strict();

function respondError(error: unknown, res: Response) {
  if (error instanceof FamilyDnsApiError) {
    return res.status(error.rejected ? 400 : 502).json({
      message: error.rejected
        ? "The provider rejected the API key, profile, or DNS server ID."
        : "The DNS provider is temporarily unavailable.",
    });
  }
  return res.status(503).json({ message: "SafeNet could not access this DNS provider connection." });
}

export function registerFamilyDnsRoutes(
  app: Express,
  storage: IStorage,
  auth: { requireAuth?: RequestHandler; getUserId?: (req: Request) => string | null } = {},
) {
  const authGate = auth.requireAuth ?? requireAuth;
  const getUserId = auth.getUserId ?? getRequestUserId;
  const ownerId = (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Sign in is required to manage DNS provider rules." });
      return null;
    }
    return userId;
  };

  app.get("/api/family-dns/connections", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    try {
      const providers: FamilyDnsProvider[] = ["adguard", "cleanbrowsing"];
      const connections = await Promise.all(providers.map(async (provider) => {
        const credential = await storage.getFamilyDnsCredential(userId, provider);
        return [provider, credential ? {
          connected: true,
          profileId: credential.profileId,
          lastSyncedAt: credential.lastSyncedAt?.toISOString() ?? null,
        } : { connected: false, profileId: null, lastSyncedAt: null }] as const;
      }));
      return res.json(Object.fromEntries(connections));
    } catch {
      return res.status(503).json({ message: "DNS provider connection status is unavailable." });
    }
  });

  app.post("/api/family-dns/connections", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    const parsed = connectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter a valid API key and profile or server ID." });
    const { provider, profileId, token } = parsed.data;
    try {
      const encrypted = encryptFamilyDnsToken(token, userId, provider);
      await verifyFamilyDnsAccount(provider, token, profileId);
      const saved = await storage.saveFamilyDnsCredential(userId, provider, profileId, encrypted);
      return res.json({ connected: true, provider, profileId: saved.profileId });
    } catch (error) {
      return respondError(error, res);
    }
  });

  app.post("/api/family-dns/:provider/sync", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    const parsedProvider = providerSchema.safeParse(req.params.provider);
    if (!parsedProvider.success) return res.status(404).json({ message: "This DNS provider cannot sync custom rules." });
    const provider = parsedProvider.data;
    try {
      const credential = await storage.getFamilyDnsCredential(userId, provider);
      if (!credential) return res.status(409).json({ message: "Connect this DNS provider before syncing." });
      const entries = (await storage.getBlocklists()).filter((entry) => entry.isActive);
      const validDomains = entries.filter((entry) =>
        entry.type === "domain"
        && entry.content.length <= 253
        && entry.content.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i.test(label)),
      );
      const firewallEnabled = (await storage.getSettings()).firewallEnabled;
      const desired = firewallEnabled
        ? validDomains.map((entry) => ({
            domain: entry.content.toLowerCase(),
            action: entry.action === "allow" ? "allow" as const : "block" as const,
          }))
        : [];
      const token = decryptFamilyDnsToken(credential, userId);
      const syncedRules = await syncFamilyDnsRules(provider, token, credential.profileId, desired, credential.syncedRules);
      await storage.updateFamilyDnsSyncedRules(userId, provider, syncedRules);
      const skipped = entries.length - validDomains.length;
      return res.json({
        synced: desired.length,
        skipped,
        message: !firewallEnabled
          ? "DNS Firewall is off; SafeNet-managed rules were removed from this provider."
          : skipped
            ? `${skipped} active keyword or URL rule(s) were skipped; only DNS domains can sync.`
            : `DNS Firewall rules synced to ${provider === "adguard" ? "AdGuard DNS" : "CleanBrowsing"}.`,
      });
    } catch (error) {
      return respondError(error, res);
    }
  });
}
