import assert from "node:assert/strict";
import test from "node:test";
import {
  FamilyDnsApiError,
  getAdGuardFilterLists,
  setAdGuardFilterList,
  syncFamilyDnsRules,
  verifyFamilyDnsAccount,
} from "./family-dns-api";

test("DNS provider verification only calls the explicitly selected provider API", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url.origin + url.pathname);
    if (url.hostname === "api.adguard-dns.io") {
      return Response.json({ user_rules_settings: { enabled: true, rules: [] } });
    }
    return Response.json({ status: "success", profiles: ["Family"] });
  }) as typeof fetch;
  try {
    await verifyFamilyDnsAccount("adguard", "adguard-token", "server-1");
    assert.deepEqual(urls, ["https://api.adguard-dns.io/oapi/v1/dns_servers/server-1/settings"]);
    urls.length = 0;
    await verifyFamilyDnsAccount("cleanbrowsing", "cleanbrowsing-token", "Family");
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /^https:\/\/my\.cleanbrowsing\.org\/api$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DNS provider verification rejects a token invalid for the selected provider", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response("unauthorized", { status: 401 });
  }) as typeof fetch;
  try {
    await assert.rejects(verifyFamilyDnsAccount("adguard", "wrong-provider-token", "server-1"), FamilyDnsApiError);
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /^https:\/\/api\.adguard-dns\.io\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CleanBrowsing sync preserves manual domains and removes only SafeNet-owned entries", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: URL; method: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, method: init?.method ?? "GET" });
    const action = url.searchParams.get("action");
    if (action === "whitelist/list") return Response.json({ status: "success", whitelist: { Kids: ["manual.allow"] } });
    if (action === "blocklist/list") return Response.json({ status: "success", blocklist: { Kids: ["old.block", "manual.block"] } });
    return Response.json({ status: "success" });
  }) as typeof fetch;
  try {
    const owned = await syncFamilyDnsRules(
      "cleanbrowsing",
      "api-secret",
      "Kids",
      [
        { domain: "new.allow", action: "allow" },
        { domain: "manual.block", action: "block" },
      ],
      ["block:old.block"],
    );
    assert.deepEqual(owned, ["allow:new.allow"]);
    assert.ok(calls.some((call) => call.url.searchParams.get("action") === "blocklist/delete"));
    assert.ok(calls.some((call) => call.url.searchParams.get("action") === "whitelist/add"));
    assert.ok(!calls.some((call) => call.url.searchParams.get("domain_name") === "manual.block"));
    assert.ok(calls.every((call) => call.url.searchParams.get("apikey") === "api-secret"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AdGuard DNS sync preserves manual user rules and updates the managed set", async () => {
  const originalFetch = globalThis.fetch;
  let updatedRules: string[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      updatedRules = body.user_rules_settings.rules;
      return new Response(null, { status: 204 });
    }
    return Response.json({
      user_rules_settings: { enabled: true, rules: ["||manual.example^", "||old.example^"] },
    });
  }) as typeof fetch;
  try {
    const owned = await syncFamilyDnsRules(
      "adguard",
      "api-secret",
      "server-123",
      [
        { domain: "blocked.example", action: "block" },
        { domain: "allowed.example", action: "allow" },
      ],
      ["||old.example^"],
    );
    assert.deepEqual(updatedRules, ["||manual.example^", "||blocked.example^", "@@||allowed.example^"]);
    assert.deepEqual(owned, ["||blocked.example^", "@@||allowed.example^"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AdGuard built-in lists expose current status without custom lists", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/oapi/v2/filter_lists") {
      return Response.json({ items: [
        { filter_id: "adguard_dns_filter", name: "AdGuard DNS filter", description: "Ads and trackers", rules_count: 12000, type: "INTERNAL" },
        { filter_id: "custom_1", name: "My custom filter", type: "CUSTOM" },
      ] });
    }
    return Response.json({
      filter_lists_settings: {
        enabled: true,
        filter_list: [{ filter_id: "adguard_dns_filter", enabled: true }],
      },
    });
  }) as typeof fetch;
  try {
    assert.deepEqual(await getAdGuardFilterLists("api-secret", "server-123"), [{
      filterId: "adguard_dns_filter",
      name: "AdGuard DNS filter",
      description: "Ads and trackers",
      rulesCount: 12000,
      enabled: true,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Updating an AdGuard built-in list preserves unrelated settings and filters", async () => {
  const originalFetch = globalThis.fetch;
  const updates: Array<Record<string, any>> = [];
  let savedFilters: Array<{ filter_id: string; enabled: boolean }> | null = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/oapi/v2/filter_lists") {
      return Response.json({ items: [
        { filter_id: "adguard_dns_filter", name: "AdGuard DNS filter", type: "INTERNAL" },
        { filter_id: "custom_1", name: "Custom", type: "CUSTOM" },
      ] });
    }
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      updates.push(body);
      savedFilters = body.filter_lists_settings.filter_list;
      return new Response(null, { status: 204 });
    }
    return Response.json({
      protection_enabled: true,
      filter_lists_settings: {
        enabled: true,
        filter_list: savedFilters ?? [
          { filter_id: "custom_1", enabled: true },
          { filter_id: "adguard_dns_filter", enabled: false },
        ],
      },
    });
  }) as typeof fetch;
  try {
    const result = await setAdGuardFilterList("api-secret", "server-123", "adguard_dns_filter", true);
    assert.deepEqual(updates, [{
      filter_lists_settings: {
        enabled: true,
        filter_list: [
          { filter_id: "custom_1", enabled: true },
          { filter_id: "adguard_dns_filter", enabled: true },
        ],
      },
    }]);
    assert.equal(result[0]?.enabled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AdGuard list updates reject custom IDs not returned as built-in filters", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return Response.json({ items: [{ filter_id: "custom_1", name: "Custom", type: "CUSTOM" }] });
  }) as typeof fetch;
  try {
    await assert.rejects(
      setAdGuardFilterList("api-secret", "server-123", "custom_1", true),
      /Family DNS provider request failed/,
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
