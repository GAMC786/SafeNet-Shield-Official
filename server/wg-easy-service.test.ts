import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getWgEasyStatus } from "./wg-easy-service";

const originalUrl = process.env.WG_EASY_URL;
const originalEndpoint = process.env.WG_EASY_WIREGUARD_ENDPOINT;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.WG_EASY_URL;
  else process.env.WG_EASY_URL = originalUrl;
  if (originalEndpoint === undefined) delete process.env.WG_EASY_WIREGUARD_ENDPOINT;
  else process.env.WG_EASY_WIREGUARD_ENDPOINT = originalEndpoint;
  globalThis.fetch = originalFetch;
});

test("returns a valid not-configured response when no WG-Easy host is set", async () => {
  delete process.env.WG_EASY_URL;
  process.env.WG_EASY_WIREGUARD_ENDPOINT = "vpn.example.test:51820";

  assert.deepEqual(await getWgEasyStatus(), {
    configured: false,
    adminUrl: null,
    wireguardEndpoint: "vpn.example.test:51820",
    status: "not-configured",
    checkedAt: null,
    message: "Connect a WG-Easy host to enable the VPN administration panel.",
    tunnelVerification: {
      status: "not-run",
      checkedAt: null,
      peerCreated: false,
      peerDeleted: false,
      peerHandshakeAt: null,
      hostHandshakeAt: null,
      message:
        "The admin UI check does not prove UDP connectivity. Run the disposable-peer verifier on the WG-Easy host.",
    },
  });
});

test("rejects an invalid WG-Easy URL without making a network request", async () => {
  process.env.WG_EASY_URL = "not-a-url";
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("", { status: 200 });
  };

  const status = await getWgEasyStatus();

  assert.equal(status.status, "not-configured");
  assert.equal(status.message, "WG_EASY_URL must be an HTTP or HTTPS URL without embedded credentials.");
  assert.equal(fetchCalled, false);
});

test("reports a reachable WG-Easy host and preserves the public endpoint", async () => {
  process.env.WG_EASY_URL = "https://wg.example.test/";
  process.env.WG_EASY_WIREGUARD_ENDPOINT = "vpn.example.test:51820";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://wg.example.test");
    assert.equal(init?.method, "GET");
    return new Response("<html>WG-Easy</html>", { status: 200 });
  };

  const status = await getWgEasyStatus();

  assert.equal(status.configured, true);
  assert.equal(status.adminUrl, "https://wg.example.test");
  assert.equal(status.wireguardEndpoint, "vpn.example.test:51820");
  assert.equal(status.status, "online");
  assert.equal(status.tunnelVerification.status, "not-run");
  assert.match(status.message, /UDP tunnel connectivity is reported separately/);
  assert.match(status.checkedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});