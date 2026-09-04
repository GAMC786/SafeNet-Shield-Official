import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import session from "express-session";
import type { AppSettings, DdnsUpdater, InsertDdnsUpdater } from "@shared/schema";
import type { IStorage } from "./storage";

process.env.DATABASE_URL ??= "postgres://ddns-smoke-test";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "ddns-smoke-test";

const testSettings: AppSettings = {
  id: 1,
  pinCode: null,
  isPinEnabled: false,
  aiShieldEnabled: false,
  alwaysOnEnabled: false,
  deviceAdminEnabled: false,
  firewallEnabled: false,
  theme: "red-gray-blue",
};

function createTestStorage() {
  let nextId = 1;
  const updaters: DdnsUpdater[] = [];

  const storage = {
    getSettings: async () => testSettings,
    getDdnsUpdaters: async () => updaters,
    createDdnsUpdater: async (input: InsertDdnsUpdater) => {
      const updater: DdnsUpdater = {
        id: nextId++,
        hostname: input.hostname,
        provider: input.provider,
        apiKey: input.apiKey ?? "",
        customUrl: input.customUrl ?? null,
        lastIpAddress: null,
        lastUpdateTime: null,
        lastFailureMessage: null,
        lastFailureTime: null,
        isEnabled: input.isEnabled ?? true,
        updateInterval: input.updateInterval ?? 3600000,
      };
      updaters.push(updater);
      return updater;
    },
    updateDdnsIpInfo: async (id: number, ipAddress: string) => {
      const updater = updaters.find((entry) => entry.id === id);
      assert.ok(updater);
      updater.lastIpAddress = ipAddress;
      updater.lastUpdateTime = new Date();
      updater.lastFailureMessage = null;
      updater.lastFailureTime = null;
      return updater;
    },
    updateDdnsFailureInfo: async (id: number, message: string) => {
      const updater = updaters.find((entry) => entry.id === id);
      assert.ok(updater);
      updater.lastFailureMessage = message;
      updater.lastFailureTime = new Date();
      return updater;
    },
  };

  return storage as unknown as IStorage;
}

test("DDNS status polls stay read-only and IP Link endpoints require HTTPS", async () => {
  const { registerRoutes } = await import("./routes");
  const { registerRequestOriginMiddleware } = await import("./request-origin");
  const app = express();
  const httpServer = createServer(app);
  const storage = createTestStorage();

  app.use(
    session({
      secret: "ddns-api-smoke-test",
      resave: false,
      saveUninitialized: false,
    }),
  );
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
  const originalFetch = globalThis.fetch;
  const request = originalFetch.bind(globalThis);
  let providerRequests = 0;
  globalThis.fetch = async () => {
    providerRequests += 1;
    throw new Error("A status read must not contact an external DDNS provider");
  };

  try {
    const statusReads = await Promise.all(
      Array.from({ length: 3 }, () => request(`${baseUrl}/api/ddns`)),
    );
    assert.deepEqual(statusReads.map((response) => response.status), [200, 200, 200]);
    assert.deepEqual(await statusReads[0].json(), []);
    assert.equal(providerRequests, 0);

    const create = (customUrl: string, updateInterval?: number) =>
      request(`${baseUrl}/api/ddns`, {
        method: "POST",
        headers: {
          Origin: "https://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hostname: "home.example.test",
          provider: "iplink",
          customUrl,
          ...(updateInterval === undefined ? {} : { updateInterval }),
        }),
      });

    const httpResponse = await create("http://updates.example.test/{ip}");
    assert.equal(httpResponse.status, 400);
    assert.match((await httpResponse.json()).message, /HTTPS/);

    const httpsResponse = await create("https://updates.example.test/{ip}", 123456);
    assert.equal(httpsResponse.status, 201);
    const httpsPayload = await httpsResponse.json();
    assert.equal(httpsPayload.provider, "iplink");
    assert.equal(httpsPayload.updateInterval, 123456);
    const invalidIntervalResponse = await create("https://updates.example.test/{ip}", 999);
    assert.equal(invalidIntervalResponse.status, 400);
    assert.match((await invalidIntervalResponse.json()).message, /milliseconds/);
    assert.equal(providerRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("DDNS status refresh cadence is 500 milliseconds", async () => {
  const { DDNS_STATUS_REFRESH_INTERVAL_MS } = await import("../client/src/hooks/ddns-constants");
  assert.equal(DDNS_STATUS_REFRESH_INTERVAL_MS, 500);
});

test("DDNS scheduler does not write to a provider inside the configured interval", async () => {
  const { checkAndUpdateDdns } = await import("./ddns-service");
  const currentIp = "198.51.100.20";
  const updater: DdnsUpdater = {
    id: 7,
    hostname: "home.example.test",
    provider: "duckdns",
    apiKey: "test-token",
    customUrl: null,
    lastIpAddress: "198.51.100.19",
    lastUpdateTime: new Date(Date.now() - 500),
    lastFailureMessage: null,
    lastFailureTime: null,
    isEnabled: true,
    updateInterval: 3600000,
  };
  let providerRequests = 0;
  let storageWrites = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerRequests += 1;
    return new Response("OK", { status: 200 });
  };

  try {
    await checkAndUpdateDdns(currentIp, {
      getDdnsUpdaters: async () => [updater],
      updateDdnsIpInfo: async () => {
        storageWrites += 1;
        return updater;
      },
    });
    assert.equal(providerRequests, 0);
    assert.equal(storageWrites, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DDNS scheduler writes to an elapsed provider interval independently of status reads", async () => {
  const { checkAndUpdateDdns } = await import("./ddns-service");
  const currentIp = "198.51.100.20";
  const updater: DdnsUpdater = {
    id: 8,
    hostname: "home.example.test",
    provider: "duckdns",
    apiKey: "test-token",
    customUrl: null,
    lastIpAddress: currentIp,
    lastUpdateTime: new Date(Date.now() - 7200 * 1000),
    lastFailureMessage: null,
    lastFailureTime: null,
    isEnabled: true,
    updateInterval: 3600000,
  };
  const providerUrls: string[] = [];
  const updatedIds: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    providerUrls.push(String(input));
    return new Response("OK", { status: 200 });
  };

  try {
    await checkAndUpdateDdns(currentIp, {
      getDdnsUpdaters: async () => [updater],
      updateDdnsIpInfo: async (id, ipAddress) => {
        updatedIds.push(id);
        return {
          ...updater,
          id,
          lastIpAddress: ipAddress,
          lastUpdateTime: new Date(),
          lastFailureMessage: null,
          lastFailureTime: null,
        };
      },
    });
    assert.equal(providerUrls.length, 1);
    assert.match(providerUrls[0], /duckdns\.org\/update/);
    assert.deepEqual(updatedIds, [updater.id]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DDNS updates skip an updater while its provider request is in flight", async () => {
  const { checkAndUpdateDdns } = await import("./ddns-service");
  const currentIp = "198.51.100.21";
  const updater: DdnsUpdater = {
    id: 9,
    hostname: "home.example.test",
    provider: "duckdns",
    apiKey: "test-token",
    customUrl: null,
    lastIpAddress: "198.51.100.20",
    lastUpdateTime: new Date(Date.now() - 7200 * 1000),
    lastFailureMessage: null,
    lastFailureTime: null,
    isEnabled: true,
    updateInterval: 3600000,
  };
  let providerRequests = 0;
  let resolveProviderStarted: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => {
    resolveProviderStarted = resolve;
  });
  let releaseProviderResponse: (() => void) | undefined;
  const providerResponse = new Promise<Response>((resolve) => {
    releaseProviderResponse = () => resolve(new Response("NO", { status: 200 }));
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerRequests += 1;
    if (providerRequests === 1) {
      resolveProviderStarted?.();
      await providerStarted;
      return providerResponse;
    }
    return new Response("OK", { status: 200 });
  };

  const schedulerStorage = {
    getDdnsUpdaters: async () => [updater],
    updateDdnsIpInfo: async () => updater,
  };

  try {
    const firstUpdate = checkAndUpdateDdns(currentIp, schedulerStorage);
    await providerStarted;
    const secondUpdate = checkAndUpdateDdns(currentIp, schedulerStorage);
    await secondUpdate;
    assert.equal(providerRequests, 1);

    releaseProviderResponse?.();
    await firstUpdate;

    await checkAndUpdateDdns(currentIp, schedulerStorage);
    assert.equal(providerRequests, 2);
  } finally {
    resolveProviderStarted?.();
    releaseProviderResponse?.();
    globalThis.fetch = originalFetch;
  }
});

test("DDNS provider rejection returns an explicit failure result", async () => {
  const { checkAndUpdateDdns } = await import("./ddns-service");
  const updater: DdnsUpdater = {
    id: 10,
    hostname: "home.example.test",
    provider: "duckdns",
    apiKey: "test-token",
    customUrl: null,
    lastIpAddress: "198.51.100.20",
    lastUpdateTime: new Date(Date.now() - 7200 * 1000),
    lastFailureMessage: null,
    lastFailureTime: null,
    isEnabled: true,
    updateInterval: 3600000,
  };
  let storageWrites = 0;
  let failureWrites = 0;
  let failureMessage = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("KO", { status: 200 });

  try {
    const results = await checkAndUpdateDdns("198.51.100.21", {
      getDdnsUpdaters: async () => [updater],
      updateDdnsIpInfo: async () => {
        storageWrites += 1;
        return updater;
      },
      updateDdnsFailureInfo: async (id, message) => {
        failureWrites += 1;
        failureMessage = message;
        return { ...updater, id, lastFailureMessage: message, lastFailureTime: new Date() };
      },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    if (!results[0].success) {
      assert.match(results[0].error, /DuckDNS rejected the update/);
      assert.match(results[0].error, /KO/);
    }
    assert.equal(storageWrites, 0);
    assert.equal(failureWrites, 1);
    assert.match(failureMessage, /DuckDNS rejected the update/);
    assert.equal(updater.lastIpAddress, "198.51.100.20");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DDNS network errors return an explicit failure result", async () => {
  const { checkAndUpdateDdns } = await import("./ddns-service");
  const updater: DdnsUpdater = {
    id: 11,
    hostname: "home.example.test",
    provider: "duckdns",
    apiKey: "test-token",
    customUrl: null,
    lastIpAddress: "198.51.100.20",
    lastUpdateTime: new Date(Date.now() - 7200 * 1000),
    lastFailureMessage: null,
    lastFailureTime: null,
    isEnabled: true,
    updateInterval: 3600000,
  };
  let storageWrites = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("connection refused");
  };

  try {
    const results = await checkAndUpdateDdns("198.51.100.21", {
      getDdnsUpdaters: async () => [updater],
      updateDdnsIpInfo: async () => {
        storageWrites += 1;
        return updater;
      },
      updateDdnsFailureInfo: async (id, message) => ({
        ...updater,
        id,
        lastFailureMessage: message,
        lastFailureTime: new Date(),
      }),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].success, false);
    if (!results[0].success) {
      assert.match(results[0].error, /Network error while contacting DuckDNS/);
      assert.match(results[0].error, /connection refused/);
    }
    assert.equal(storageWrites, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DDNS status exposes the latest failure without provider credentials", async () => {
  const { registerRoutes } = await import("./routes");
  const { registerRequestOriginMiddleware } = await import("./request-origin");
  const app = express();
  const httpServer = createServer(app);
  const storage = createTestStorage();
  const updater = await storage.createDdnsUpdater({
    hostname: "home.example.test",
    provider: "duckdns",
    apiKey: "secret-token",
    customUrl: null,
    updateInterval: 1000,
  });
  await storage.updateDdnsFailureInfo(updater.id, "DuckDNS rejected the update (HTTP 401): token expired");

  app.use(
    session({
      secret: "ddns-api-smoke-test",
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(express.json());
  registerRequestOriginMiddleware(app);
  await registerRoutes(httpServer, app, storage, { seed: false });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
    httpServer.once("error", reject);
  });

  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ddns`);
    const payload = await response.json() as Array<Record<string, unknown>>;
    assert.equal(response.status, 200);
    assert.equal(payload[0].lastIpAddress, null);
    assert.equal(payload[0].lastFailureMessage, "DuckDNS rejected the update (HTTP 401): token expired");
    assert.ok(payload[0].lastFailureTime);
    assert.equal("apiKey" in payload[0], false);
    assert.equal("customUrl" in payload[0], false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("manual DDNS updates return a non-success response with provider failure details", async () => {
  const { registerRoutes } = await import("./routes");
  const { registerRequestOriginMiddleware } = await import("./request-origin");
  const app = express();
  const httpServer = createServer(app);
  const storage = createTestStorage();
  await storage.createDdnsUpdater({
    hostname: "home.example.test",
    provider: "duckdns",
    apiKey: "test-token",
    updateInterval: 1000,
  });

  app.use(
    session({
      secret: "ddns-api-smoke-test",
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(express.json());
  registerRequestOriginMiddleware(app);
  await registerRoutes(httpServer, app, storage, { seed: false });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
    httpServer.once("error", reject);
  });

  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("connection refused");
  };

  try {
    const response = await originalFetch(`http://127.0.0.1:${address.port}/api/ddns/update-all`, {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clientIp: "198.51.100.21" }),
    });
    const payload = await response.json() as {
      message: string;
      results: Array<{ success: boolean; error?: string }>;
    };

    assert.equal(response.status, 502);
    assert.match(payload.message, /DDNS provider update failed/);
    assert.match(payload.message, /Network error while contacting DuckDNS/);
    assert.equal(payload.results[0].success, false);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});