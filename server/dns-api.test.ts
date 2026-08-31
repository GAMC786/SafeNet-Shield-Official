import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import session from "express-session";
import type { IStorage } from "./storage";

process.env.DATABASE_URL ??= "postgres://dns-smoke-test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "dns-smoke-test";

type TestDnsServer = {
  id: number;
  name: string;
  type: "plain" | "doh" | "dot";
  primaryAddress: string;
  secondaryAddress: string | null;
  isActive: boolean | null;
  isCustom: boolean | null;
};

function createTestStorage(): IStorage {
  const servers = new Map<number, TestDnsServer>();
  let nextId = 1;

  return {
    getSettings: async () => ({
      id: 1,
      pinCode: null,
      isPinEnabled: false,
      aiShieldEnabled: false,
      alwaysOnEnabled: false,
      deviceAdminEnabled: false,
      firewallEnabled: false,
      theme: "red-gray-blue",
    }),
    getDnsServers: async () => [...servers.values()],
    createDnsServer: async (input) => {
      const server: TestDnsServer = {
        id: nextId++,
        name: input.name,
        type: input.type,
        primaryAddress: input.primaryAddress,
        secondaryAddress: input.secondaryAddress ?? null,
        isActive: input.isActive ?? false,
        isCustom: input.isCustom ?? true,
      };
      servers.set(server.id, server);
      return server;
    },
    updateDnsServer: async (id, updates) => {
      const server = servers.get(id);
      if (!server) {
        throw new Error("Server not found");
      }

      Object.assign(server, updates);
      return server;
    },
    deleteDnsServer: async (id) => {
      servers.delete(id);
    },
    activateDnsServer: async (id) => {
      for (const server of servers.values()) {
        server.isActive = server.id === id;
      }

      const server = servers.get(id);
      if (!server) {
        throw new Error("Server not found");
      }
      return server;
    },
  } as unknown as IStorage;
}

function getSetCookieValue(response: Response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie?.split(";")[0] ?? "";
}

test("DNS create/update/activate/list/delete works from Android and Electron origins", async () => {
  const { registerRoutes } = await import("./routes");
  const { registerRequestOriginMiddleware } = await import("./request-origin");
  const app = express();
  const httpServer = createServer(app);
  const testStorage = createTestStorage();

  app.use(
    session({
      secret: "dns-api-smoke-test",
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax" },
    }),
  );
  app.use(express.json());
  registerRequestOriginMiddleware(app);
  await registerRoutes(httpServer, app, testStorage, { seed: false });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
    httpServer.once("error", reject);
  });

  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (const origin of ["https://localhost", "https://desktop.safenet.dns"]) {
      let cookie = "";
      let createdId: number | undefined;

      const request = async (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        headers.set("Origin", origin);
        if (cookie) {
          headers.set("Cookie", cookie);
        }

        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers,
        });
        const nextCookie = getSetCookieValue(response);
        if (nextCookie) {
          cookie = nextCookie;
        }
        return response;
      };
      const assertCorsHeaders = (response: Response) => {
        assert.equal(response.headers.get("access-control-allow-origin"), origin);
        assert.equal(response.headers.get("access-control-allow-credentials"), "true");
      };

      try {
        const authResponse = await request("/api/auth/status");
        assert.equal(authResponse.status, 200);
        assertCorsHeaders(authResponse);
        assert.deepEqual(await authResponse.json(), {
          authenticated: true,
          pinRequired: false,
        });

        const createResponse = await request("/api/dns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `CI temporary DNS (${origin})`,
            type: "plain",
            primaryAddress: "192.0.2.53",
            secondaryAddress: "192.0.2.54",
            isActive: false,
            isCustom: true,
          }),
        });
        assert.equal(createResponse.status, 201);
        assertCorsHeaders(createResponse);
        const created = (await createResponse.json()) as TestDnsServer;
        createdId = created.id;
        assert.equal(created.type, "plain");
        assert.equal(created.primaryAddress, "192.0.2.53");

        const updateResponse = await request(`/api/dns/${created.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `CI updated DNS (${origin})`,
            primaryAddress: "192.0.2.55",
            secondaryAddress: "192.0.2.56",
          }),
        });
        assert.equal(updateResponse.status, 200);
        assertCorsHeaders(updateResponse);
        const updated = (await updateResponse.json()) as TestDnsServer;
        assert.deepEqual(updated, {
          ...created,
          name: `CI updated DNS (${origin})`,
          primaryAddress: "192.0.2.55",
          secondaryAddress: "192.0.2.56",
        });

        const activateResponse = await request(`/api/dns/${created.id}/activate`, {
          method: "POST",
        });
        assert.equal(activateResponse.status, 200);
        assertCorsHeaders(activateResponse);
        const activated = (await activateResponse.json()) as TestDnsServer;
        assert.equal(activated.id, created.id);
        assert.equal(activated.isActive, true);
        assert.equal(activated.primaryAddress, "192.0.2.55");

        const listResponse = await request("/api/dns");
        assert.equal(listResponse.status, 200);
        assertCorsHeaders(listResponse);
        const listed = (await listResponse.json()) as TestDnsServer[];
        assert.deepEqual(listed.find((server) => server.id === created.id), {
          ...created,
          name: `CI updated DNS (${origin})`,
          primaryAddress: "192.0.2.55",
          secondaryAddress: "192.0.2.56",
          isActive: true,
        });
      } finally {
        if (createdId !== undefined) {
          const deleteResponse = await request(`/api/dns/${createdId}`, {
            method: "DELETE",
          });
          assert.equal(deleteResponse.status, 204);
          assertCorsHeaders(deleteResponse);

          const listAfterCleanupResponse = await request("/api/dns");
          assert.equal(listAfterCleanupResponse.status, 200);
          assertCorsHeaders(listAfterCleanupResponse);
          const remaining = (await listAfterCleanupResponse.json()) as TestDnsServer[];
          assert.ok(!remaining.some((server) => server.id === createdId));
        }
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});