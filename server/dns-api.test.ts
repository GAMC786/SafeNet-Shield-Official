import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import type { AppSettings } from "@shared/schema";
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
  const servers = new Map<number, TestDnsServer>([
    [1, {
      id: 1,
      name: "SafeNet Default",
      type: "doh",
      primaryAddress: "https://dns.google/dns-query",
      secondaryAddress: "https://cloudflare-dns.com/dns-query",
      isActive: true,
      isCustom: false,
    }],
    [2, {
      id: 2,
      name: "Backup Resolver",
      type: "plain",
      primaryAddress: "94.140.14.14",
      secondaryAddress: "94.140.15.15",
      isActive: false,
      isCustom: true,
    }],
  ]);
  let nextId = 3;
  let settings: AppSettings = {
    id: 1,
    aiShieldEnabled: false,
    alwaysOnEnabled: false,
    deviceAdminEnabled: false,
    firewallEnabled: false,
    preventDnsOverrides: true,
    tailscaleNonDnsFirewallEnabled: false,
    theme: "red-gray-blue",
  };

  return {
    getSettings: async () => settings,
    updateSettings: async (updates: Partial<AppSettings>) => {
      settings = { ...settings, ...updates };
      return settings;
    },
    getBlocklists: async () => [{
      id: 1,
      type: "domain",
      content: "blocked.example",
      category: "custom",
      action: "block",
      isActive: true,
    }],
    getFirewallRules: async () => [{
      id: 1,
      name: "Deny DNS",
      sourceInterface: "lan",
      sourceAddress: "Any",
      destinationInterface: "wan",
      destinationAddress: "Any",
      service: "dns",
      action: "deny",
      isEnabled: true,
      priority: 100,
      createdAt: new Date(),
    }],
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
      if (server.isActive) {
        for (const existing of servers.values()) existing.isActive = false;
      }
      servers.set(server.id, server);
      return server;
    },
    updateDnsServer: async (id, updates) => {
      const server = servers.get(id);
      if (!server) throw new Error("Server not found");
      Object.assign(server, updates);
      return server;
    },
    deleteDnsServer: async (id) => {
      const server = servers.get(id);
      if (!server) throw new Error("DNS resolver not found");
      servers.delete(id);
    },
    activateDnsServer: async (id) => {
      const server = servers.get(id);
      if (!server) throw new Error("Server not found");
      for (const existing of servers.values()) existing.isActive = existing.id === id;
      return server;
    },
  } as unknown as IStorage;
}

function getSetCookieValue(response: Response) {
  const setCookie = response.headers.get("set-cookie");
  return setCookie?.split(";")[0] ?? "";
}

test("DNS configuration supports resolver CRUD and activation from Android and Electron origins", async () => {
  const { registerRoutes } = await import("./routes");
  const { registerRequestOriginMiddleware } = await import("./request-origin");
  const app = express();
  const httpServer = createServer(app);
  const storage = createTestStorage();

  app.use(express.json());
  registerRequestOriginMiddleware(app);
  await registerRoutes(httpServer, app, storage, { seed: false });

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
      const request = async (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        headers.set("Origin", origin);
        if (cookie) headers.set("Cookie", cookie);
        const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
        const nextCookie = getSetCookieValue(response);
        if (nextCookie) cookie = nextCookie;
        return response;
      };

      const listResponse = await request("/api/dns");
      assert.equal(listResponse.status, 200);
      assert.equal((await listResponse.json() as TestDnsServer[]).length, 2);

      const firewallResponse = await request("/api/firewall/config");
      assert.equal(firewallResponse.status, 200);
      const firewallConfig = await firewallResponse.json() as {
        settings: Record<string, unknown>;
        rules: Array<{ action: string }>;
        blocklists: Array<{ content: string }>;
      };
      assert.equal(firewallConfig.settings.firewallEnabled, false);
      assert.equal(firewallConfig.settings.tailscaleNonDnsFirewallEnabled, false);
      assert.equal(firewallConfig.rules[0].action, "deny");
      assert.equal(firewallConfig.blocklists[0].content, "blocked.example");
      if (origin === "https://localhost") {
        const saveNonDnsPolicyResponse = await request("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tailscaleNonDnsFirewallEnabled: true }),
        });
        assert.equal(saveNonDnsPolicyResponse.status, 200);
        const savedSettings = await saveNonDnsPolicyResponse.json() as Record<string, unknown>;
        assert.equal(savedSettings.tailscaleNonDnsFirewallEnabled, true);
        assert.equal(savedSettings.firewallEnabled, false);

        const savedFirewallResponse = await request("/api/firewall/config");
        const savedFirewallConfig = await savedFirewallResponse.json() as {
          settings: Record<string, unknown>;
        };
        assert.equal(savedFirewallConfig.settings.tailscaleNonDnsFirewallEnabled, true);
        assert.equal(savedFirewallConfig.settings.firewallEnabled, false);

        await request("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tailscaleNonDnsFirewallEnabled: false }),
        });
      }
      const createResponse = await request("/api/dns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Family Resolver",
          type: "dot",
          primaryAddress: "1.1.1.3",
          secondaryAddress: "1.0.0.3",
          isCustom: true,
        }),
      });
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json() as TestDnsServer;
      assert.equal(created.name, "Family Resolver");

      const updateResponse = await request(`/api/dns/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Family Resolver" }),
      });
      assert.equal(updateResponse.status, 200);
      assert.equal((await updateResponse.json() as TestDnsServer).name, "Updated Family Resolver");

      const activateResponse = await request(`/api/dns/${created.id}/activate`, { method: "POST" });
      assert.equal(activateResponse.status, 200);
      assert.equal((await activateResponse.json() as TestDnsServer).isActive, true);

      const deleteResponse = await request(`/api/dns/${created.id}`, { method: "DELETE" });
      assert.equal(deleteResponse.status, 204);
      const afterDelete = await request("/api/dns");
      const remaining = await afterDelete.json() as TestDnsServer[];
      assert.equal(remaining.length, 2);
      assert.ok(!remaining.some((server) => server.id === created.id));
      assert.ok(remaining.every((server) => !server.isActive));

      if (origin === "https://desktop.safenet.dns") {
        const activateFinalResolverResponse = await request(`/api/dns/${remaining[0].id}/activate`, { method: "POST" });
        assert.equal(activateFinalResolverResponse.status, 200);
        const deleteInactiveResolverResponse = await request(`/api/dns/${remaining[1].id}`, { method: "DELETE" });
        assert.equal(deleteInactiveResolverResponse.status, 204);
        const deleteFinalActiveResolverResponse = await request(`/api/dns/${remaining[0].id}`, { method: "DELETE" });
        assert.equal(deleteFinalActiveResolverResponse.status, 204);
        const emptyResponse = await request("/api/dns");
        assert.deepEqual(await emptyResponse.json(), []);
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});