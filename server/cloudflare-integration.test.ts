import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://cloudflare-integration-test";

test("Cloudflare connector status and DNS updates use the managed connection", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = process.env.REPL_IDENTITY;
  const originalToken = process.env.CLOUDFLARE_API_TOKEN;
  const calls: Array<{ path: string; method: string; connector: string | null; body: string }> = [];

  process.env.REPL_IDENTITY = "test-identity";
  delete process.env.CLOUDFLARE_API_TOKEN;
  globalThis.fetch = async (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input.url);
    const path = requestUrl.pathname.replace("/api/v2/proxy", "") + requestUrl.search;
    const headers = new Headers(init?.headers);
    calls.push({
      path,
      method: init?.method || "GET",
      connector: headers.get("Connector-Name"),
      body: typeof init?.body === "string" ? init.body : "",
    });

    if (path === "/v4/user/tokens/verify") {
      return new Response(JSON.stringify({
        success: true,
        result: { status: "active" },
      }), { status: 200 });
    }
    if (path === "/v4/zones?per_page=50&status=active") {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: "zone-1", name: "example.com" }],
      }), { status: 200 });
    }
    if (path === "/v4/zones/zone-1/dns_records?type=A&name=home.example.com") {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: "record-1" }],
      }), { status: 200 });
    }
    if (path === "/v4/zones/zone-1/dns_records/record-1") {
      return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
    }
    throw new Error(`Unexpected Cloudflare path: ${path}`);
  };

  try {
    const { getCloudflareStatus, updateCloudflareDns } = await import("./replit_integrations/cloudflare/client");
    const status = await getCloudflareStatus();
    assert.deepEqual(status, {
      connected: true,
      authenticated: true,
      ready: true,
      activeZoneCount: 1,
      message: "Cloudflare is connected with 1 active zone.",
    });

    await updateCloudflareDns("home.example.com", "198.51.100.20");
    const updateCall = calls.at(-1);
    assert.equal(updateCall?.method, "PUT");
    assert.equal(updateCall?.connector, "cloudflare");
    assert.deepEqual(JSON.parse(updateCall?.body || "{}"), {
      type: "A",
      name: "home.example.com",
      content: "198.51.100.20",
      ttl: 1,
      proxied: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) {
      delete process.env.REPL_IDENTITY;
    } else {
      process.env.REPL_IDENTITY = originalIdentity;
    }
    if (originalToken === undefined) {
      delete process.env.CLOUDFLARE_API_TOKEN;
    } else {
      process.env.CLOUDFLARE_API_TOKEN = originalToken;
    }
  }
});

test("Cloudflare status reports an authenticated account without zones as not ready", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = process.env.REPL_IDENTITY;
  const originalToken = process.env.CLOUDFLARE_API_TOKEN;

  process.env.REPL_IDENTITY = "test-identity";
  delete process.env.CLOUDFLARE_API_TOKEN;
  globalThis.fetch = async (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input.url);
    const path = requestUrl.pathname.replace("/api/v2/proxy", "") + requestUrl.search;
    if (path === "/v4/user/tokens/verify") {
      return new Response(JSON.stringify({ success: true, result: { status: "active" } }), { status: 200 });
    }
    if (path === "/v4/zones?per_page=50&status=active") {
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    }
    throw new Error(`Unexpected Cloudflare path: ${path}`);
  };

  try {
    const { getCloudflareStatus } = await import("./replit_integrations/cloudflare/client");
    assert.deepEqual(await getCloudflareStatus(), {
      connected: true,
      authenticated: true,
      ready: false,
      activeZoneCount: 0,
      message: "Cloudflare is authenticated, but the account has no active zones.",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) {
      delete process.env.REPL_IDENTITY;
    } else {
      process.env.REPL_IDENTITY = originalIdentity;
    }
    if (originalToken === undefined) {
      delete process.env.CLOUDFLARE_API_TOKEN;
    } else {
      process.env.CLOUDFLARE_API_TOKEN = originalToken;
    }
  }
});

test("Cloudflare API token requests use direct Cloudflare authorization", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.CLOUDFLARE_API_TOKEN;
  const requests: Array<{ url: string; authorization: string }> = [];

  process.env.CLOUDFLARE_API_TOKEN = "test-cloudflare-token";
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("Authorization") || "",
    });
    return new Response(JSON.stringify({
      success: true,
      result: { status: "active" },
    }), { status: 200 });
  };

  try {
    const { getCloudflareStatus } = await import("./replit_integrations/cloudflare/client");
    const status = await getCloudflareStatus();
    assert.equal(status.connected, true);
    assert.equal(status.authenticated, true);
    assert.deepEqual(requests.map((request) => request.url), [
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      "https://api.cloudflare.com/client/v4/zones?per_page=50&status=active",
    ]);
    assert.deepEqual(
      requests.map((request) => request.authorization),
      ["Bearer test-cloudflare-token", "Bearer test-cloudflare-token"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.CLOUDFLARE_API_TOKEN;
    } else {
      process.env.CLOUDFLARE_API_TOKEN = originalToken;
    }
  }
});

test("SafeNet DDNS routes the current public IP through the Cloudflare A record", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = process.env.REPL_IDENTITY;
  const originalToken = process.env.CLOUDFLARE_API_TOKEN;
  const calls: Array<{ path: string; method: string; body: string }> = [];

  process.env.REPL_IDENTITY = "test-identity";
  delete process.env.CLOUDFLARE_API_TOKEN;
  globalThis.fetch = async (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input.url);
    const path = requestUrl.pathname.replace("/api/v2/proxy", "") + requestUrl.search;
    calls.push({
      path,
      method: init?.method || "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });

    if (path === "/v4/zones?per_page=50&status=active") {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: "zone-1", name: "example.com" }],
      }), { status: 200 });
    }
    if (path === "/v4/zones/zone-1/dns_records?type=A&name=home.example.com") {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: "record-1" }],
      }), { status: 200 });
    }
    if (path === "/v4/zones/zone-1/dns_records/record-1") {
      return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
    }
    throw new Error(`Unexpected Cloudflare path: ${path}`);
  };

  try {
    const { checkAndUpdateDdns } = await import("./ddns-service");
    const updater = {
      id: 21,
      hostname: "home.example.com",
      provider: "safenet" as const,
      apiKey: "",
      customUrl: null,
      lastIpAddress: "198.51.100.19",
      lastUpdateTime: new Date(Date.now() - 7200 * 1000),
      lastFailureMessage: null,
      lastFailureTime: null,
      isEnabled: true,
      updateInterval: 3600000,
    };
    let savedIp = "";
    const results = await checkAndUpdateDdns("198.51.100.20", {
      getDdnsUpdaters: async () => [updater],
      updateDdnsIpInfo: async (_id, ipAddress) => {
        savedIp = ipAddress;
        return { ...updater, lastIpAddress: ipAddress, lastUpdateTime: new Date() };
      },
    });

    assert.deepEqual(results, [{
      updaterId: updater.id,
      hostname: updater.hostname,
      success: true,
    }]);
    assert.equal(savedIp, "198.51.100.20");
    const updateCall = calls.at(-1);
    assert.equal(updateCall?.method, "PUT");
    assert.deepEqual(JSON.parse(updateCall?.body || "{}"), {
      type: "A",
      name: "home.example.com",
      content: "198.51.100.20",
      ttl: 1,
      proxied: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) {
      delete process.env.REPL_IDENTITY;
    } else {
      process.env.REPL_IDENTITY = originalIdentity;
    }
    if (originalToken === undefined) {
      delete process.env.CLOUDFLARE_API_TOKEN;
    } else {
      process.env.CLOUDFLARE_API_TOKEN = originalToken;
    }
  }
});