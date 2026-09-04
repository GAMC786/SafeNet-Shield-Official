import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import session from "express-session";
import type { AppSettings } from "@shared/schema";
import type { IStorage } from "./storage";
import { hashPin, isHashedPin, verifyPin } from "./pin-security";
import {
  findLatestPinRecoveryCode,
  getGmailFailureStage,
  PIN_RECOVERY_CODE_TTL_MS,
} from "./gmail";

process.env.DATABASE_URL ??= "postgres://pin-api-smoke-test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "pin-api-smoke-test";
const pinRecoveryEmailSmokeEnabled = process.env.PIN_RECOVERY_EMAIL_SMOKE === "true";
const pinRecoverySmokeEmail = process.env.PIN_RECOVERY_SMOKE_EMAIL?.trim() ?? "";

function createTestStorage(initial?: Partial<AppSettings>) {
  let settings: AppSettings = {
    id: 1,
    pinCode: null,
    pinRecoveryEmail: null,
    pinRecoveryCodeHash: null,
    pinRecoveryCodeExpiresAt: null,
    isPinEnabled: false,
    aiShieldEnabled: false,
    alwaysOnEnabled: false,
    deviceAdminEnabled: false,
    firewallEnabled: false,
    theme: "red-gray-blue",
    ...initial,
  };
  let recoveryResetLock = Promise.resolve();

  return {
    getSettings: async () => settings,
    updateSettings: async (updates: Partial<AppSettings>) => {
      settings = { ...settings, ...updates };
      return settings;
    },
    resetPinWithRecoveryCode: async (email: string, code: string, pin: string) => {
      const previousReset = recoveryResetLock;
      let releaseReset!: () => void;
      recoveryResetLock = new Promise<void>((resolve) => {
        releaseReset = resolve;
      });
      await previousReset;

      try {
        const valid =
          settings.isPinEnabled === true &&
          settings.pinRecoveryEmail?.toLowerCase() === email.toLowerCase() &&
          settings.pinRecoveryCodeExpiresAt !== null &&
          settings.pinRecoveryCodeExpiresAt !== undefined &&
          settings.pinRecoveryCodeExpiresAt.getTime() > Date.now() &&
          verifyPin(settings.pinRecoveryCodeHash, code);
        if (!valid) return false;

        settings = {
          ...settings,
          pinCode: hashPin(pin),
          isPinEnabled: true,
          pinRecoveryCodeHash: null,
          pinRecoveryCodeExpiresAt: null,
        };
        return true;
      } finally {
        releaseReset();
      }
    },
  } as unknown as IStorage;
}

function getSetCookieValue(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function createTestServer(
  storage: IStorage,
  options: {
    generatePinRecoveryCode?: () => string;
    sendPinRecoveryCode?: (to: string, code: string) => Promise<void>;
  } = {},
) {
  const { registerRoutes } = await import("./routes");
  const { registerRequestOriginMiddleware } = await import("./request-origin");
  const app = express();
  const httpServer = createServer(app);
  app.set("trust proxy", true);

  app.use(session({
    secret: "pin-api-smoke-test",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  }));
  app.use(express.json());
  registerRequestOriginMiddleware(app);
  await registerRoutes(httpServer, app, storage, { seed: false, ...options });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

test("PIN settings never enable a lock without a configured four-digit PIN", async () => {
  const storage = createTestStorage();
  const server = await createTestServer(storage);
  let cookie = "";
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", "https://localhost");
    headers.set("X-Forwarded-For", "198.51.100.11");
    if (cookie) headers.set("Cookie", cookie);
    return fetch(`${server.baseUrl}${path}`, { ...init, headers }).then((response) => {
      const nextCookie = getSetCookieValue(response);
      if (nextCookie) cookie = nextCookie;
      return response;
    });
  };

  try {
    const enableWithoutPin = await request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinEnabled: true }),
    });
    assert.equal(enableWithoutPin.status, 400);
    assert.match((await enableWithoutPin.json()).message, /Set a four-digit PIN/);

    const configurePin = await request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinCode: "4827", isPinEnabled: true }),
    });
    assert.equal(configurePin.status, 200);
    const publicSettings = await configurePin.json();
    assert.equal(publicSettings.pinConfigured, true);
    assert.equal("pinCode" in publicSettings, false);
    assert.equal(isHashedPin((await storage.getSettings()).pinCode), true);

    const clearWhileEnabled = await request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinCode: null }),
    });
    assert.equal(clearWhileEnabled.status, 400);

    const malformedPin = await request("/api/settings/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "12" }),
    });
    assert.equal(malformedPin.status, 400);
  } finally {
    await server.close();
  }
});

test("PIN verification rate-limits repeated invalid attempts", async () => {
  const storage = createTestStorage({
    pinCode: hashPin("4827"),
    isPinEnabled: true,
  });
  const server = await createTestServer(storage);
  let cookie = "";
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", "https://localhost");
    headers.set("X-Forwarded-For", "198.51.100.12");
    if (cookie) headers.set("Cookie", cookie);
    return fetch(`${server.baseUrl}${path}`, { ...init, headers }).then((response) => {
      const nextCookie = getSetCookieValue(response);
      if (nextCookie) cookie = nextCookie;
      return response;
    });
  };

  try {
    const statusBefore = await request("/api/auth/status");
    assert.deepEqual(await statusBefore.json(), { authenticated: false, pinRequired: true });
    assert.equal(statusBefore.headers.get("cache-control"), "no-store, no-cache, must-revalidate, proxy-revalidate");

    const blocked = await request("/api/settings");
    assert.equal(blocked.status, 401);

    const invalid = await request("/api/settings/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    assert.equal(invalid.status, 401);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const repeatedInvalid = await request("/api/settings/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "0000" }),
      });
      assert.equal(repeatedInvalid.status, 401);
    }
    const rateLimited = await request("/api/settings/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    assert.equal(rateLimited.status, 429);
    assert.ok(Number(rateLimited.headers.get("retry-after")) > 0);

  } finally {
    await server.close();
  }
});

test("PIN recovery replaces the code, unlocks the session, and clears the one-time secret", async () => {
  const storage = createTestStorage({
    pinCode: hashPin("4827"),
    pinRecoveryEmail: "owner@example.com",
    pinRecoveryCodeHash: hashPin("123456"),
    pinRecoveryCodeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    isPinEnabled: true,
  });
  const server = await createTestServer(storage);
  let cookie = "";
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", "https://localhost");
    headers.set("X-Forwarded-For", "198.51.100.13");
    if (cookie) headers.set("Cookie", cookie);
    return fetch(`${server.baseUrl}${path}`, { ...init, headers }).then((response) => {
      const nextCookie = getSetCookieValue(response);
      if (nextCookie) cookie = nextCookie;
      return response;
    });
  };

  try {
    const reset = await request("/api/settings/pin-recovery/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        code: "123456",
        pin: "5931",
      }),
    });
    assert.equal(reset.status, 200);
    assert.deepEqual(await reset.json(), { valid: true });
    assert.equal((await storage.getSettings()).pinRecoveryCodeHash, null);
    assert.equal(verifyPin((await storage.getSettings()).pinCode, "5931"), true);

    const status = await request("/api/auth/status");
    assert.deepEqual(await status.json(), { authenticated: true, pinRequired: true });
  } finally {
    await server.close();
  }
});

test("concurrent PIN recovery attempts can apply only one reset", async () => {
  const storage = createTestStorage({
    pinCode: hashPin("4827"),
    pinRecoveryEmail: "owner@example.com",
    pinRecoveryCodeHash: hashPin("123456"),
    pinRecoveryCodeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    isPinEnabled: true,
  });
  const server = await createTestServer(storage);
  const request = (pin: string) => fetch(`${server.baseUrl}/api/settings/pin-recovery/reset`, {
    method: "POST",
    headers: {
      Origin: "https://localhost",
      "X-Forwarded-For": "198.51.100.16",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "owner@example.com",
      code: "123456",
      pin,
    }),
  });

  try {
    const responses = await Promise.all([request("5931"), request("6042")]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
    const responseBodies = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(
      responseBodies.filter((body) => body.valid === false),
      [{ valid: false, message: "The recovery code is invalid or expired." }],
    );

    const settings = await storage.getSettings();
    assert.equal(
      [verifyPin(settings.pinCode, "5931"), verifyPin(settings.pinCode, "6042")].filter(Boolean).length,
      1,
    );
    assert.equal(settings.pinRecoveryCodeHash, null);
    assert.equal(settings.pinRecoveryCodeExpiresAt, null);
  } finally {
    await server.close();
  }
});

test("PIN recovery invalidates an older code when a newer one is requested", async () => {
  const olderCode = "123456";
  const newerCode = "654321";
  const generatedCodes = [olderCode, newerCode];
  const deliveredCodes: string[] = [];
  const storage = createTestStorage({
    pinCode: hashPin("4827"),
    pinRecoveryEmail: "owner@example.com",
    isPinEnabled: true,
  });
  const server = await createTestServer(storage, {
    generatePinRecoveryCode: () => generatedCodes[deliveredCodes.length],
    sendPinRecoveryCode: async (_email, code) => {
      deliveredCodes.push(code);
    },
  });
  let cookie = "";
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", "https://localhost");
    headers.set("X-Forwarded-For", "198.51.100.15");
    if (cookie) headers.set("Cookie", cookie);
    return fetch(`${server.baseUrl}${path}`, { ...init, headers }).then((response) => {
      const nextCookie = getSetCookieValue(response);
      if (nextCookie) cookie = nextCookie;
      return response;
    });
  };

  try {
    const firstRequestedAt = Date.now();
    const firstRequest = await request("/api/settings/pin-recovery/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com" }),
    });
    assert.equal(firstRequest.status, 200);

    const secondRequestedAt = Date.now();
    const secondRequest = await request("/api/settings/pin-recovery/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com" }),
    });
    assert.equal(secondRequest.status, 200);
    assert.deepEqual(deliveredCodes, [olderCode, newerCode]);

    const currentSettings = await storage.getSettings();
    const expiresAt = currentSettings.pinRecoveryCodeExpiresAt?.getTime() ?? 0;
    assert.ok(expiresAt > secondRequestedAt);
    assert.ok(expiresAt <= secondRequestedAt + PIN_RECOVERY_CODE_TTL_MS + 5_000);
    assert.ok(expiresAt > firstRequestedAt);

    const oldReset = await request("/api/settings/pin-recovery/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        code: olderCode,
        pin: "5931",
      }),
    });
    assert.equal(oldReset.status, 401);

    const newReset = await request("/api/settings/pin-recovery/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.com",
        code: newerCode,
        pin: "5931",
      }),
    });
    assert.equal(newReset.status, 200);
    assert.deepEqual(await newReset.json(), { valid: true });
    assert.equal(verifyPin((await storage.getSettings()).pinCode, "5931"), true);
  } finally {
    await server.close();
  }
});

test("PIN recovery delivers a mailbox code and rejects it after expiry", {
  skip: !pinRecoveryEmailSmokeEnabled
    ? "Opt-in real-mailbox check is disabled."
    : false,
}, async () => {
  if (!pinRecoverySmokeEmail) {
    throw new Error("PIN recovery mailbox is not configured (Gmail configuration stage).");
  }

  const storage = createTestStorage({
    pinCode: hashPin("4827"),
    pinRecoveryEmail: pinRecoverySmokeEmail,
    isPinEnabled: true,
  });
  const server = await createTestServer(storage);
  let cookie = "";
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", "https://localhost");
    headers.set("X-Forwarded-For", "198.51.100.14");
    if (cookie) headers.set("Cookie", cookie);
    return fetch(`${server.baseUrl}${path}`, { ...init, headers }).then((response) => {
      const nextCookie = getSetCookieValue(response);
      if (nextCookie) cookie = nextCookie;
      return response;
    });
  };

  const requestedAt = new Date();
  try {
    const requested = await request("/api/settings/pin-recovery/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pinRecoverySmokeEmail }),
    });
    if (requested.status !== 200) {
      throw new Error("PIN recovery endpoint failed before Gmail delivery.");
    }
    const requestedBody = await requested.json() as { sent?: boolean };
    if (requestedBody.sent !== true) {
      throw new Error("PIN recovery endpoint did not accept the mailbox request.");
    }

    const deadline = Date.now() + 90_000;
    let delivered: Awaited<ReturnType<typeof findLatestPinRecoveryCode>> = null;
    while (Date.now() <= deadline) {
      try {
        delivered = await findLatestPinRecoveryCode(pinRecoverySmokeEmail, requestedAt);
      } catch (error) {
        throw new Error(`Gmail ${getGmailFailureStage(error)} stage failed while checking delivery.`);
      }
      if (delivered) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (!delivered) {
      throw new Error("Gmail delivery stage timed out waiting for the recovery message.");
    }
    if (!/^\d{6}$/.test(delivered.code)) {
      throw new Error("Gmail delivery stage returned an invalid recovery message.");
    }

    const stored = await storage.getSettings();
    const expiresAt = stored.pinRecoveryCodeExpiresAt?.getTime() ?? 0;
    if (expiresAt <= requestedAt.getTime() ||
        expiresAt > requestedAt.getTime() + PIN_RECOVERY_CODE_TTL_MS + 5_000) {
      throw new Error("PIN recovery endpoint configured an unexpected expiry.");
    }

    await storage.updateSettings({
      pinRecoveryCodeExpiresAt: new Date(Date.now() - 1),
    });
    const expired = await request("/api/settings/pin-recovery/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: pinRecoverySmokeEmail,
        code: delivered.code,
        pin: "5931",
      }),
    });
    if (expired.status !== 401) {
      throw new Error("PIN recovery endpoint accepted an expired recovery code.");
    }
  } finally {
    await server.close();
  }
});

test("PIN verification unlocks a session after an invalid attempt", async () => {
  const storage = createTestStorage({
    pinCode: hashPin("4827"),
    isPinEnabled: true,
  });
  const server = await createTestServer(storage);
  let cookie = "";
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", "https://localhost");
    if (cookie) headers.set("Cookie", cookie);
    return fetch(`${server.baseUrl}${path}`, { ...init, headers }).then((response) => {
      const nextCookie = getSetCookieValue(response);
      if (nextCookie) cookie = nextCookie;
      return response;
    });
  };

  try {
    const statusBefore = await request("/api/auth/status");
    assert.deepEqual(await statusBefore.json(), { authenticated: false, pinRequired: true });

    const blocked = await request("/api/settings");
    assert.equal(blocked.status, 401);

    const invalid = await request("/api/settings/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    assert.equal(invalid.status, 401);

    const verified = await request("/api/settings/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "4827" }),
    });
    assert.equal(verified.status, 200);
    assert.deepEqual(await verified.json(), { valid: true });

    const statusAfter = await request("/api/auth/status");
    assert.deepEqual(await statusAfter.json(), { authenticated: true, pinRequired: true });
    const settings = await request("/api/settings");
    assert.equal(settings.status, 200);
  } finally {
    await server.close();
  }
});