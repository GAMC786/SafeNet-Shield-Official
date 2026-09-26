import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { IStorage } from "./storage";
import { getRequestUserId, requireAuth } from "./auth";
import {
  ControlDApiError,
  listControlDDevices,
  listControlDProfiles,
  updateControlDDeviceProfile,
  verifyControlDToken,
} from "./control-d-api";
import {
  ControlDCredentialEncryptionError,
  decryptControlDToken,
  encryptControlDToken,
} from "./control-d-crypto";

const connectBodySchema = z.object({
  token: z.string().trim().min(1).max(2048),
}).strict();

const profileBodySchema = z.object({
  profileId: z.string().trim().min(1).max(128),
}).strict();

function respondToControlDError(
  error: unknown,
  res: Response,
  options: { savedCredential?: boolean } = {},
) {
  if (error instanceof ControlDCredentialEncryptionError) {
    return res.status(503).json({
      message: "SafeNet could not access the encrypted Control D connection. Disconnect and reconnect it.",
    });
  }
  if (error instanceof ControlDApiError) {
    if (error.kind === "rejected") {
      return res.status(options.savedCredential ? 409 : 400).json({
        message: options.savedCredential
          ? "Control D rejected the saved token. Disconnect and reconnect your account."
          : "Control D rejected this API token. Check it and try again.",
      });
    }
    return res.status(502).json({
      message: "Control D is temporarily unavailable. Try again shortly.",
    });
  }

  console.error("Control D request failed:", error instanceof Error ? error.name : "unknown error");
  return res.status(500).json({ message: "Control D could not complete this request." });
}

export function registerControlDRoutes(
  app: Express,
  storage: IStorage,
  fetchImpl: typeof fetch = fetch,
  auth: {
    requireAuth?: RequestHandler;
    getUserId?: (req: Request) => string | null;
  } = {},
) {
  const authGate = auth.requireAuth ?? requireAuth;
  const getUserId = auth.getUserId ?? getRequestUserId;
  const ownerId = (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Sign in is required to manage Control D." });
      return null;
    }
    return userId;
  };

  app.get("/api/control-d/connection", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    try {
      const credential = await storage.getControlDCredential(userId);
      return res.json({
        connected: Boolean(credential),
        connectedAt: credential?.connectedAt.toISOString() ?? null,
      });
    } catch {
      return res.status(503).json({ message: "Control D connection status is unavailable." });
    }
  });

  app.post("/api/control-d/connect", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    const parsed = connectBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Enter a valid Control D API token." });
    }

    try {
      // Derive and encrypt before contacting Control D so missing key
      // configuration fails closed without sending the token upstream.
      const encrypted = encryptControlDToken(parsed.data.token, userId);
      await verifyControlDToken(parsed.data.token, fetchImpl);
      const saved = await storage.saveControlDCredential(userId, encrypted);
      return res.json({
        connected: true,
        connectedAt: saved.connectedAt.toISOString(),
      });
    } catch (error) {
      return respondToControlDError(error, res);
    }
  });

  app.delete("/api/control-d/connection", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    try {
      await storage.deleteControlDCredential(userId);
      return res.status(204).send();
    } catch {
      return res.status(503).json({ message: "SafeNet could not disconnect Control D." });
    }
  });

  app.get("/api/control-d/account", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    try {
      const credential = await storage.getControlDCredential(userId);
      if (!credential) {
        return res.status(409).json({ message: "Connect a Control D account first." });
      }
      const token = decryptControlDToken(credential, userId);
      const [profiles, devices] = await Promise.all([
        listControlDProfiles(token, fetchImpl),
        listControlDDevices(token, fetchImpl),
      ]);
      return res.json({ profiles, devices });
    } catch (error) {
      return respondToControlDError(error, res, { savedCredential: true });
    }
  });

  app.patch("/api/control-d/devices/:deviceId/profile", authGate, async (req, res) => {
    const userId = ownerId(req, res);
    if (!userId) return;
    const deviceId = z.string().trim().min(1).max(128).safeParse(req.params.deviceId);
    const parsed = profileBodySchema.safeParse(req.body);
    if (!deviceId.success || !parsed.success) {
      return res.status(400).json({ message: "Choose a valid endpoint and profile." });
    }

    try {
      const credential = await storage.getControlDCredential(userId);
      if (!credential) {
        return res.status(409).json({ message: "Connect a Control D account first." });
      }
      const token = decryptControlDToken(credential, userId);
      const [profiles, devices] = await Promise.all([
        listControlDProfiles(token, fetchImpl),
        listControlDDevices(token, fetchImpl),
      ]);
      const profile = profiles.find((item) => item.id === parsed.data.profileId);
      const device = devices.find((item) => item.id === deviceId.data);
      if (!profile || !device) {
        return res.status(404).json({
          message: "That endpoint or profile is not in your connected Control D account.",
        });
      }

      const updatedDevice = await updateControlDDeviceProfile(
        token,
        device.id,
        profile.id,
        fetchImpl,
      );
      return res.json({ device: updatedDevice });
    } catch (error) {
      return respondToControlDError(error, res, { savedCredential: true });
    }
  });
}