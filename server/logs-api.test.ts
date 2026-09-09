import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import type { IStorage } from "./storage";

process.env.DATABASE_URL ??= "postgres://logs-api-test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "logs-api-test";

test("Android activity ingest requires a Clerk-authenticated request", async () => {
  const { registerRoutes } = await import("./routes");
  const { registerRequestOriginMiddleware } = await import("./request-origin");
  const records: Array<Record<string, unknown>> = [];
  const storage = {
    getSettings: async () => ({
      id: 1,
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
  app.use(express.json());
  registerRequestOriginMiddleware(app);
  await registerRoutes(httpServer, app, storage, {
    seed: false,
    getUserId: (req) => req.headers["x-test-user"] === "true" ? "logs-test-user" : null,
  });

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

    const authStatus = await fetch(url.replace("/api/logs/ingest", "/api/auth/status"));
    assert.equal(authStatus.status, 200);
    assert.deepEqual(await authStatus.json(), { authenticated: false });

    const accepted = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        "x-test-user": "true",
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