import assert from "node:assert/strict";
import test from "node:test";

test("Cloudflare connector status and DNS updates use the managed connection", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = process.env.REPL_IDENTITY;
  const calls: Array<{ path: string; method: string; connector: string | null; body: string }> = [];

  process.env.REPL_IDENTITY = "test-identity";
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
  }
});

test("Cloudflare status reports an authenticated account without zones as not ready", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = process.env.REPL_IDENTITY;

  process.env.REPL_IDENTITY = "test-identity";
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
  }
});

test("SafeNet DDNS routes the current public IP through the Cloudflare A record", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = process.env.REPL_IDENTITY;
  const calls: Array<{ path: string; method: string; body: string }> = [];

  process.env.REPL_IDENTITY = "test-identity";
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
  }
});