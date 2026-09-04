import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import session from "express-session";
import test from "node:test";
import type { IStorage } from "./storage";

process.env.DATABASE_URL ??= "postgres://logs-api-test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "logs-api-test";

function getSetCookieValue(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

test("Android activity ingest requires an existing authenticated session", async () => {
  const { registerRoutes } = await import("./routes");
  const { registerRequestOriginMiddleware } = await import("./request-origin");
  const records: Array<Record<string, unknown>> = [];
  const storage = {
    getSettings: async () => ({
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
    }),
    createLog: async (input: Record<string, unknown>) => {
      const record = { id: records.length + 1, ...input, timestamp: new Date() };
      records.push(record);
      return record;
    },
  } as unknown as IStorage;
  const app = express();
  const httpServer = createServer(app);
  app.use(session({
    secret: "logs-api-test",
    resave: false,
    saveUninitialized: false,
  }));
  app.use(express.json());
  registerRequestOriginMiddleware(app);
  await registerRoutes(httpServer, app, storage, { seed: false });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/logs/ingest`;

  const payload = {
    domain: "blocked.example",
    protocol: "doh",
    status: "blocked",
    reason: "domain_blocklist",
  };
  try {
    const unauthenticated = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal(records.length, 0);

    const authStatus = await fetch(
      url.replace("/api/logs/ingest", "/api/auth/status"),
    );
    const cookie = getSetCookieValue(authStatus);
    assert.equal(authStatus.status, 200);
    assert.ok(cookie);

    const accepted = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(accepted.status, 201);
    assert.equal(records.length, 1);
    assert.equal(records[0].source, "android");
    assert.equal(records[0].protocol, "doh");
    assert.equal(records[0].domain, "blocked.example");
    assert.equal(records[0].reason, "domain_blocklist");
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});