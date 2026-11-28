import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

import { registerRequestOriginMiddleware } from "./request-origin";
import { createPublicMobileAuthConfig, registerMobileAuthConfigRoute } from "./mobile-auth-config";

test("mobile auth config returns only public production settings for the API host", () => {
  const config = createPublicMobileAuthConfig(
    {
      NODE_ENV: "production",
      AUTH0_DOMAIN: " safenet.auth0.com ",
      AUTH0_CLIENT_ID: " public-client-id ",
      AUTH0_AUDIENCE: " https://api.safenet.test ",
    },
    "https://safe-net-shield-official.replit.app/",
  );

  assert.deepEqual(config, {
    auth0Domain: "safenet.auth0.com",
    auth0ClientId: "public-client-id",
    auth0Audience: "https://api.safenet.test",
    googleEnabled: false,
  });
});

test("mobile auth config exposes shared Auth0 application settings", () => {
  const config = createPublicMobileAuthConfig(
    {
      NODE_ENV: "development",
      AUTH0_DOMAIN: "safenet.auth0.com",
      AUTH0_CLIENT_ID: "public-client-id",
      AUTH0_AUDIENCE: "https://api.safenet.test",
    },
    "http://localhost:5000",
  );

  assert.equal(config?.auth0Domain, "safenet.auth0.com");
  assert.equal(config?.auth0Audience, "https://api.safenet.test");
});

test("mobile auth config reports whether Better Auth Google sign-in is configured", () => {
  const config = createPublicMobileAuthConfig({
    AUTH0_DOMAIN: "safenet.auth0.com",
    AUTH0_CLIENT_ID: "public-client-id",
    AUTH0_AUDIENCE: "https://api.safenet.test",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
  }, "https://api.safenet.test");
  assert.equal(config?.googleEnabled, true);
});

test("mobile auth config fails closed when required public settings are missing", () => {
  assert.equal(
    createPublicMobileAuthConfig(
      { NODE_ENV: "production", AUTH0_CLIENT_ID: "public-client-id" },
      "https://api.example.test",
    ),
    null,
  );
});

test("mobile auth config is public to the Capacitor origin and is not cached", async () => {
  const app = express();
  registerRequestOriginMiddleware(app);
  registerMobileAuthConfigRoute(app, {
    NODE_ENV: "production",
    AUTH0_DOMAIN: "safenet.auth0.com",
    AUTH0_CLIENT_ID: "public-client-id",
    AUTH0_AUDIENCE: "https://api.safenet.test",
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/config`, {
      headers: { Origin: "https://localhost" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://localhost");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).auth0Audience, "https://api.safenet.test");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
