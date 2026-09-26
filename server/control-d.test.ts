import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { IStorage } from "./storage";
import { encryptControlDToken, decryptControlDToken } from "./control-d-crypto";
import { registerControlDRoutes } from "./control-d-routes";
import type { ControlDCredential } from "@shared/schema";

test("Control D tokens are encrypted and bound to their SafeNet owner", () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-with-enough-entropy-0123456789";
  try {
    const encrypted = encryptControlDToken("control-d-token-for-user-a", "user-a");
    assert.notEqual(encrypted.tokenCiphertext, "control-d-token-for-user-a");
    assert.equal(decryptControlDToken(encrypted, "user-a"), "control-d-token-for-user-a");
    assert.throws(() => decryptControlDToken(encrypted, "user-b"));
  } finally {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});

test("Control D account data and profile updates are isolated to the signed-in user", async () => {
  const originalSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-with-enough-entropy-0123456789";

  const records = new Map<string, ControlDCredential>();
  for (const [userId, token] of [["user-a", "token-a"], ["user-b", "token-b"]] as const) {
    records.set(userId, {
      userId,
      ...encryptControlDToken(token, userId),
      connectedAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  }

  const fakeStorage = {
    getControlDCredential: async (userId: string) => records.get(userId) ?? null,
    saveControlDCredential: async (
      userId: string,
      credential: Pick<ControlDCredential, "tokenCiphertext" | "tokenIv" | "tokenAuthTag" | "encryptionKeyVersion">,
    ) => {
      const current = records.get(userId);
      const saved = {
        userId,
        ...credential,
        connectedAt: current?.connectedAt ?? new Date(),
        updatedAt: new Date(),
      };
      records.set(userId, saved);
      return saved;
    },
    deleteControlDCredential: async (userId: string) => { records.delete(userId); },
  } as unknown as IStorage;

  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
    calls.push(`${token}:${init?.method ?? "GET"}:${url.pathname}`);
    const owner = token === "token-a" || token === "new-token" ? "a" : "b";
    if (url.pathname === "/users") {
      return Response.json({
        success: true,
        body: { PK: `account-${owner}`, email: `${owner}@example.test` },
      });
    }
    if (url.pathname === "/profiles") {
      return Response.json({
        success: true,
        body: { profiles: [{ PK: `profile-${owner}`, name: `Profile ${owner}`, updated: 1 }] },
      });
    }
    if (url.pathname === "/devices") {
      return Response.json({
        success: true,
        body: {
          devices: [{
            PK: `device-${owner}`,
            device_id: `device-${owner}`,
            name: `Endpoint ${owner}`,
            profile: { PK: `profile-${owner}`, name: `Profile ${owner}` },
            resolvers: { dot: `${owner}.dns.controld.dev`, doh: `https://${owner}.dns.controld.dev` },
          }],
        },
      });
    }
    if (url.pathname === `/devices/device-${owner}` && init?.method === "PUT") {
      return Response.json({
        success: true,
        body: {
          PK: `device-${owner}`,
          device_id: `device-${owner}`,
          name: `Endpoint ${owner}`,
          profile: { PK: "profile-updated", name: "Updated profile" },
          resolvers: { dot: `${owner}.dns.controld.dev`, doh: `https://${owner}.dns.controld.dev` },
        },
      });
    }
    return Response.json({ success: false, message: "not found" }, { status: 404 });
  };

  const app = express();
  app.use(express.json());
  registerControlDRoutes(app, fakeStorage, fakeFetch, {
    requireAuth: (req, res, next) => {
      if (!req.header("x-test-user")) {
        return res.status(401).json({ message: "Sign in is required to manage Control D." });
      }
      return next();
    },
    getUserId: (req) => req.header("x-test-user") ?? null,
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const unauthenticated = await fetch(`${baseUrl}/api/control-d/connection`);
    assert.equal(unauthenticated.status, 401);

    const userAResponse = await fetch(`${baseUrl}/api/control-d/account?userId=user-b`, {
      headers: { "x-test-user": "user-a" },
    });
    const userA = await userAResponse.json() as { profiles: Array<{ id: string }>; devices: Array<{ id: string }> };
    assert.equal(userAResponse.status, 200);
    assert.equal(userA.profiles[0]?.id, "profile-a");
    assert.equal(userA.devices[0]?.id, "device-a");

    const userBResponse = await fetch(`${baseUrl}/api/control-d/account`, {
      headers: { "x-test-user": "user-b" },
    });
    const userB = await userBResponse.json() as { profiles: Array<{ id: string }>; devices: Array<{ id: string }> };
    assert.equal(userBResponse.status, 200);
    assert.equal(userB.profiles[0]?.id, "profile-b");
    assert.equal(userB.devices[0]?.id, "device-b");

    const validUpdate = await fetch(`${baseUrl}/api/control-d/devices/device-a/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": "user-a" },
      body: JSON.stringify({ profileId: "profile-a" }),
    });
    assert.equal(validUpdate.status, 200);
    assert.equal(calls.includes("token-a:PUT:/devices/device-a"), true);

    const crossAccountUpdate = await fetch(`${baseUrl}/api/control-d/devices/device-b/profile`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-test-user": "user-a" },
      body: JSON.stringify({ profileId: "profile-b" }),
    });
    assert.equal(crossAccountUpdate.status, 404);
    assert.equal(calls.some((call) => call === "token-a:PUT:/devices/device-b"), false);

    const connectResponse = await fetch(`${baseUrl}/api/control-d/connect`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "user-a" },
      body: JSON.stringify({ token: "new-token" }),
    });
    const connectBody = await connectResponse.json() as Record<string, unknown>;
    assert.equal(connectResponse.status, 200);
    assert.equal(JSON.stringify(connectBody).includes("new-token"), false);
    assert.equal(decryptControlDToken(records.get("user-a")!, "user-a"), "new-token");
    assert.equal(decryptControlDToken(records.get("user-b")!, "user-b"), "token-b");

    const disconnectResponse = await fetch(`${baseUrl}/api/control-d/connection`, {
      method: "DELETE",
      headers: { "x-test-user": "user-a" },
    });
    assert.equal(disconnectResponse.status, 204);
    assert.equal(records.has("user-a"), false);
    assert.equal(records.has("user-b"), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (originalSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSecret;
  }
});