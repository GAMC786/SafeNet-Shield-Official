import assert from "node:assert/strict";
import test from "node:test";
import { syncFamilyDnsRules } from "./family-dns-api";

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
