import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getNetBirdPeerStatus, getNetBirdStatus } from "./netbird-service";

const names = ["NETBIRD_MANAGEMENT_URL", "NETBIRD_DASHBOARD_URL", "NETBIRD_API_TOKEN"] as const;
const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const name of names) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  globalThis.fetch = originalFetch;
});

test("returns not-configured without NetBird settings", async () => {
  for (const name of names) delete process.env[name];
  const status = await getNetBirdStatus();
  assert.equal(status.status, "not-configured");
  assert.equal(status.configured, false);
  assert.equal(status.peerCount, null);
});

test("validates management URL and avoids requests", async () => {
  process.env.NETBIRD_MANAGEMENT_URL = "not-a-url";
  process.env.NETBIRD_DASHBOARD_URL = "https://dashboard.example.test";
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response(""); };
  const status = await getNetBirdStatus();
  assert.match(status.message, /NETBIRD_MANAGEMENT_URL/);
  assert.equal(called, false);
});

test("reports online peers using Token auth without exposing token", async () => {
  process.env.NETBIRD_MANAGEMENT_URL = "https://management.example.test/";
  process.env.NETBIRD_DASHBOARD_URL = "https://dashboard.example.test/";
  process.env.NETBIRD_API_TOKEN = "secret-token";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://management.example.test/api/peers");
    assert.equal(new Headers(init?.headers).get("authorization"), "Token secret-token");
    return new Response(JSON.stringify({ peers: [{ id: "one" }, { id: "two" }] }), { status: 200 });
  };
  const status = await getNetBirdStatus();
  assert.equal(status.status, "online");
  assert.equal(status.peerCount, 2);
  assert.doesNotMatch(JSON.stringify(status), /secret-token/);
  assert.match(status.message, /NetBird Dashboard/);
});

test("returns bounded matching peer fields", async () => {
  process.env.NETBIRD_MANAGEMENT_URL = "https://management.example.test";
  process.env.NETBIRD_API_TOKEN = "secret-token";
  globalThis.fetch = async () => new Response(JSON.stringify({
    peers: [{ id: "peer-1", hostname: "phone", user_id: "owner-id", connected: true, ip: "100.64.0.1", sensitive: "secret" }],
  }));
  const result = await getNetBirdPeerStatus("phone");
  assert.deepEqual(result, { peer: { id: "peer-1", name: "phone", owner: "owner-id", status: "online" } });
  assert.doesNotMatch(JSON.stringify(result), /100\.64|sensitive|secret-token/);
});

test("treats an explicitly disconnected peer as offline", async () => {
  process.env.NETBIRD_MANAGEMENT_URL = "https://management.example.test";
  process.env.NETBIRD_API_TOKEN = "secret-token";
  globalThis.fetch = async () => new Response(JSON.stringify({
    peers: [{ id: "peer-2", name: "laptop", user_id: "owner-id", connected: false, online: true, status: "online" }],
  }));
  const result = await getNetBirdPeerStatus("peer-2");
  assert.deepEqual(result, { peer: { id: "peer-2", name: "laptop", owner: "owner-id", status: "offline" } });
});

test("returns unavailable on timeout and rejects non-2xx", async () => {
  process.env.NETBIRD_MANAGEMENT_URL = "https://management.example.test";
  process.env.NETBIRD_DASHBOARD_URL = "https://dashboard.example.test";
  process.env.NETBIRD_API_TOKEN = "secret-token";
  globalThis.fetch = async () => new Response("", { status: 401 });
  const status = await getNetBirdStatus();
  assert.equal(status.status, "unavailable");
  assert.match(status.message, /rejected the API token/);
});