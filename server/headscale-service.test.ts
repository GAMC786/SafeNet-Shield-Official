import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getHeadscaleStatus } from "./headscale-service";

const originalHeadscaleUrl = process.env.HEADSCALE_URL;
const originalHeadplaneUrl = process.env.HEADPLANE_URL;
const originalApiKey = process.env.HEADSCALE_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalHeadscaleUrl === undefined) delete process.env.HEADSCALE_URL;
  else process.env.HEADSCALE_URL = originalHeadscaleUrl;
  if (originalHeadplaneUrl === undefined) delete process.env.HEADPLANE_URL;
  else process.env.HEADPLANE_URL = originalHeadplaneUrl;
  if (originalApiKey === undefined) delete process.env.HEADSCALE_API_KEY;
  else process.env.HEADSCALE_API_KEY = originalApiKey;
  globalThis.fetch = originalFetch;
});

test("returns a not-configured response when Headscale and Headplane are not set", async () => {
  delete process.env.HEADSCALE_URL;
  delete process.env.HEADPLANE_URL;
  delete process.env.HEADSCALE_API_KEY;

  const status = await getHeadscaleStatus();

  assert.equal(status.configured, false);
  assert.equal(status.status, "not-configured");
  assert.equal(status.headscaleUrl, null);
  assert.equal(status.headplaneUrl, null);
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
  assert.equal(status.status, "online");
  assert.equal(status.nodeCount, 2);
  assert.match(status.message, /Headplane is ready/);
  assert.match(status.checkedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});