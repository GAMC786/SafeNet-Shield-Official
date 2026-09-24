import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getTailscaleDeviceStatus, getTailscaleStatus } from "./tailscale-service";

const names = ["TAILSCALE_TAILNET", "TAILSCALE_OAUTH_CLIENT_ID", "TAILSCALE_OAUTH_CLIENT_SECRET"] as const;
const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
afterEach(() => {
  for (const name of names) original[name] === undefined ? delete process.env[name] : process.env[name] = original[name];
  globalThis.fetch = originalFetch;
});
function configure() {
  process.env.TAILSCALE_TAILNET = "example.com";
  process.env.TAILSCALE_OAUTH_CLIENT_ID = "client";
  process.env.TAILSCALE_OAUTH_CLIENT_SECRET = "secret";
}

test("returns not-configured without Tailscale settings", async () => {
  for (const name of names) delete process.env[name];
  const status = await getTailscaleStatus();
  assert.equal(status.status, "not-configured");
  assert.equal(status.deviceCount, null);
});

test("exchanges OAuth credentials and lists devices without exposing secrets", async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    if (String(input).endsWith("/oauth/token")) {
      assert.equal(new Headers(init?.headers).get("authorization"), `Basic ${Buffer.from("client:secret").toString("base64")}`);
      assert.match(String(init?.body), /grant_type=client_credentials/);
      assert.match(String(init?.body), /scope=devices%3Acore%3Aread/);
      return new Response(JSON.stringify({ access_token: "access-secret", expires_in: 3600 }));
    }
    assert.equal(String(input), "https://api.tailscale.com/api/v2/tailnet/example.com/devices");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-secret");
    return new Response(JSON.stringify({ devices: [{ id: "d1", hostname: "phone", connectedToControl: true }] }));
  };
  const status = await getTailscaleStatus();
  assert.equal(status.status, "online");
  assert.equal(status.deviceCount, 1);
  assert.doesNotMatch(JSON.stringify(status), /access-secret|secret/);
  assert.equal(calls, 2);
});

test("maps connectedToControl and matches bounded device fields", async () => {
  configure();
  globalThis.fetch = async (input) => String(input).endsWith("/oauth/token")
    ? new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }))
    : new Response(JSON.stringify({ devices: [{ id: "d2", name: "laptop", user: { email: "owner@example.com" }, connectedToControl: false, addresses: ["100.64.0.2"] }] }));
  assert.deepEqual(await getTailscaleDeviceStatus("d2"), { device: { id: "d2", name: "laptop", owner: "owner@example.com", status: "offline" } });
  assert.equal(await getTailscaleDeviceStatus("missing"), null);
});

test("reports API failures as unavailable", async () => {
  configure();
  globalThis.fetch = async (input) => String(input).endsWith("/oauth/token")
    ? new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }))
    : new Response("", { status: 403 });
  const status = await getTailscaleStatus();
  assert.equal(status.status, "unavailable");
  assert.match(status.message, /rejected/);
});