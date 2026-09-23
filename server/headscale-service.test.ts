import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getHeadscaleNodeStatus, getHeadscaleStatus } from "./headscale-service";

const originalHeadscaleUrl = process.env.HEADSCALE_URL;
const originalHeadplaneUrl = process.env.HEADPLANE_URL;
const originalHeadplaneNodeApiUrl = process.env.HEADPLANE_NODE_API_URL;
const originalHeadplaneNodeApiToken = process.env.HEADPLANE_NODE_API_TOKEN;
const originalApiKey = process.env.HEADSCALE_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalHeadscaleUrl === undefined) delete process.env.HEADSCALE_URL;
  else process.env.HEADSCALE_URL = originalHeadscaleUrl;
  if (originalHeadplaneUrl === undefined) delete process.env.HEADPLANE_URL;
  else process.env.HEADPLANE_URL = originalHeadplaneUrl;
  if (originalHeadplaneNodeApiUrl === undefined) delete process.env.HEADPLANE_NODE_API_URL;
  else process.env.HEADPLANE_NODE_API_URL = originalHeadplaneNodeApiUrl;
  if (originalHeadplaneNodeApiToken === undefined) delete process.env.HEADPLANE_NODE_API_TOKEN;
  else process.env.HEADPLANE_NODE_API_TOKEN = originalHeadplaneNodeApiToken;
  if (originalApiKey === undefined) delete process.env.HEADSCALE_API_KEY;
  else process.env.HEADSCALE_API_KEY = originalApiKey;
  globalThis.fetch = originalFetch;
});

test("returns a not-configured response when Headscale and Headplane are not set", async () => {
  delete process.env.HEADSCALE_URL;
  delete process.env.HEADPLANE_URL;
  delete process.env.HEADPLANE_NODE_API_URL;
  delete process.env.HEADPLANE_NODE_API_TOKEN;
  delete process.env.HEADSCALE_API_KEY;

  const status = await getHeadscaleStatus();

  assert.equal(status.configured, false);
  assert.equal(status.status, "not-configured");
  assert.equal(status.headscaleUrl, null);
  assert.equal(status.headplaneUrl, null);
  assert.equal(status.headplaneNodeApiConfigured, false);
  assert.equal(status.nodeCount, null);
});

test("rejects invalid Headscale URLs without making a network request", async () => {
  process.env.HEADSCALE_URL = "not-a-url";
  process.env.HEADPLANE_URL = "https://headplane.example.test";
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("", { status: 200 });
  };

  const status = await getHeadscaleStatus();

  assert.equal(status.status, "not-configured");
  assert.equal(
    status.message,
    "HEADSCALE_URL must be an HTTP or HTTPS URL without embedded credentials.",
  );
  assert.equal(fetchCalled, false);
});

test("reports reachable Headscale nodes and keeps Headplane as the admin URL", async () => {
  process.env.HEADSCALE_URL = "https://headscale.example.test/";
  process.env.HEADPLANE_URL = "https://headplane.example.test/";
  process.env.HEADPLANE_NODE_API_URL = "https://headplane.example.test/api/safenet/node-status";
  process.env.HEADPLANE_NODE_API_TOKEN = "test-headplane-token";
  process.env.HEADSCALE_API_KEY = "test-api-key";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://headscale.example.test/api/v1/node");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-api-key");
    return new Response(JSON.stringify({ nodes: [{ id: 1 }, { id: 2 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const status = await getHeadscaleStatus();

  assert.equal(status.configured, true);
  assert.equal(status.headscaleUrl, "https://headscale.example.test");
  assert.equal(status.headplaneUrl, "https://headplane.example.test");
  assert.equal(status.headplaneNodeApiConfigured, true);
  assert.doesNotMatch(JSON.stringify(status), /test-headplane-token/);
  assert.equal(status.status, "online");
  assert.equal(status.nodeCount, 2);
  assert.match(status.message, /Headplane is ready/);
  assert.match(status.checkedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("rejects a Headplane node endpoint with embedded credentials", async () => {
  process.env.HEADSCALE_URL = "https://headscale.example.test";
  process.env.HEADPLANE_URL = "https://headplane.example.test";
  process.env.HEADPLANE_NODE_API_URL = "https://user:password@headplane.example.test/api/node";
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response("", { status: 200 });
  };

  const status = await getHeadscaleStatus();

  assert.equal(status.status, "not-configured");
  assert.match(status.message, /HEADPLANE_NODE_API_URL/);
  assert.equal(fetchCalled, false);
});

test("returns only bounded node fields for the physical proof adapter", async () => {
  process.env.HEADSCALE_URL = "https://headscale.example.test";
  process.env.HEADSCALE_API_KEY = "test-api-key";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://headscale.example.test/api/v1/node");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-api-key");
    return new Response(JSON.stringify({
      nodes: [{
        name: "safenet-phone",
        user: { name: "safenet", id: 7 },
        online: true,
        ipAddresses: ["100.64.0.1"],
        lastSeen: "sensitive-value",
      }],
    }), { status: 200 });
  };

  const status = await getHeadscaleNodeStatus("safenet-phone");

  assert.deepEqual(status, {
    node: {
      name: "safenet-phone",
      visibility: "visible",
      owner: "safenet",
      status: "online",
    },
  });
  assert.doesNotMatch(JSON.stringify(status), /test-api-key|100\.64\.0\.1|sensitive-value/);
});
