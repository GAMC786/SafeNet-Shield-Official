import assert from "node:assert/strict";
import test from "node:test";

import { loadSafeNetRuntimeConfig } from "./runtime-config";

test("uses complete compile-time authentication settings without a network request", async () => {
  let requests = 0;
  const config = await loadSafeNetRuntimeConfig(
    {
      DEV: true,
      VITE_AUTH0_DOMAIN: "safenet-dev.us.auth0.com",
      VITE_AUTH0_CLIENT_ID: "dev-client-id",
      VITE_AUTH0_AUDIENCE: "https://api.safenet.test",
    },
    {
      origin: "http://localhost:5000",
      fetcher: async () => {
        requests += 1;
        throw new Error("Should use the complete static configuration.");
      },
    },
  );

  assert.equal(requests, 0);
  assert.equal(config.auth0Domain, "safenet-dev.us.auth0.com");
});

test("loads missing APK settings from the configured public API origin", async () => {
  let requestedUrl = "";
  const config = await loadSafeNetRuntimeConfig(
    {
      DEV: false,
      VITE_API_URL: "https://api.example.test/",
    },
    {
      origin: "https://localhost",
      fetcher: async (input) => {
        requestedUrl = input;
        return new Response(JSON.stringify({
          auth0Domain: "safenet-prod.us.auth0.com",
          auth0ClientId: "prod-client-id",
          auth0Audience: "https://api.safenet.test",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  );

  assert.equal(requestedUrl, "https://api.example.test/api/auth/config");
  assert.equal(config.auth0Domain, "safenet-prod.us.auth0.com");
  assert.equal(config.auth0Audience, "https://api.safenet.test");
});

test("keeps startup retryable when public auth configuration is unavailable", async () => {
  await assert.rejects(
    loadSafeNetRuntimeConfig(
      { DEV: false, VITE_API_URL: "https://api.example.test" },
      {
        origin: "https://localhost",
        fetcher: async () => new Response("unavailable", { status: 503 }),
      },
    ),
    /public authentication settings are unavailable/,
  );
});
