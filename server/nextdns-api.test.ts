import assert from "node:assert/strict";
import test from "node:test";
import { syncNextDnsRules } from "./nextdns-api";

test("NextDNS sync updates the allow and deny lists without deleting manual entries", async () => {
  const lists: Record<string, Map<string, { id: string; active: boolean }>> = {
    allowlist: new Map([
      ["manual.example", { id: "manual.example", active: true }],
      ["old-safe.example", { id: "old-safe.example", active: true }],
    ]),
    denylist: new Map([["old-block.example", { id: "old-block.example", active: true }]]),
  };
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const fetchMock: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const path = url.pathname;
    const match = path.match(/\/profiles\/profile1\/(allowlist|denylist)(?:\/(.+))?$/);
    assert.ok(match);
    const [, list, item] = match;
    const entries = lists[list];
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (method === "GET") {
      return Response.json({ data: [...entries.values()] });
    }
    const id = item ? decodeURIComponent(item) : body.id;
    if (method === "POST") entries.set(id, { id, active: true });
    if (method === "PATCH") entries.set(id, { id, active: body.active });
    if (method === "DELETE") {
      entries.delete(id);
      return new Response(null, { status: 204 });
    }
    return Response.json({ data: { id } });
  };

  const synced = await syncNextDnsRules(
    "test-api-key",
    "profile1",
    [
      { domain: "manual.example", action: "allow" },
      { domain: "new-safe.example", action: "allow" },
      { domain: "blocked.example", action: "block" },
    ],
    [
      { domain: "old-safe.example", action: "allow", ownedBySafeNet: true },
      { domain: "old-block.example", action: "block", ownedBySafeNet: true },
      { domain: "manual.example", action: "allow", ownedBySafeNet: false },
    ],
    fetchMock,
  );

  assert.equal(lists.allowlist.has("old-safe.example"), false);
  assert.equal(lists.denylist.has("old-block.example"), false);
  assert.equal(lists.allowlist.has("manual.example"), true);
  assert.equal(lists.allowlist.has("new-safe.example"), true);
  assert.equal(lists.denylist.has("blocked.example"), true);
  assert.deepEqual(synced, [
    { domain: "manual.example", action: "allow", ownedBySafeNet: false },
    { domain: "new-safe.example", action: "allow", ownedBySafeNet: true },
    { domain: "blocked.example", action: "block", ownedBySafeNet: true },
  ]);
  assert.ok(calls.every((call) => call.method === "GET" || call.path.startsWith("/profiles/profile1/")));
});

test("NextDNS sync preserves previously owned entries and re-enables disabled remote rules", async () => {
  const calls: string[] = [];
  const fetchMock: typeof fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    const method = init.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (method === "GET" && path.endsWith("/allowlist")) {
      return Response.json({ data: [{ id: "safe.example", active: false }] });
    }
    if (method === "GET") return Response.json({ data: [] });
    return Response.json({ data: {} });
  };

  const synced = await syncNextDnsRules(
    "test-api-key",
    "profile1",
    [{ domain: "safe.example", action: "allow" }],
    [{ domain: "safe.example", action: "allow", ownedBySafeNet: true }],
    fetchMock,
  );

  assert.ok(calls.some((call) => call.startsWith("PATCH ")));
  assert.deepEqual(synced, [{ domain: "safe.example", action: "allow", ownedBySafeNet: true }]);
});
