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
      CLERK_PUBLISHABLE_KEY: " pk_live_public ",
      CLERK_SECRET_KEY: "must-not-be-returned",
      VITE_SUPABASE_URL: " https://project.supabase.co ",
      VITE_SUPABASE_PUBLISHABLE_KEY: " public-supabase-key ",
      VITE_SUPABASE_DEVELOPMENT_URL: "https://development.supabase.co",
      VITE_SUPABASE_DEVELOPMENT_PUBLISHABLE_KEY: "development-key",
    },
    "https://safe-net-shield-official.replit.app/",
  );

  assert.deepEqual(config, {
    clerkPublishableKey: "pk_live_public",
    clerkProxyUrl: "https://safe-net-shield-official.replit.app/api/__clerk",
    supabaseUrl: "https://project.supabase.co",
    supabasePublishableKey: "public-supabase-key",
  });
  assert.doesNotMatch(JSON.stringify(config), /must-not-be-returned/);
});

test("mobile auth config selects development Supabase settings outside production", () => {
  const config = createPublicMobileAuthConfig(
    {
      NODE_ENV: "development",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      VITE_SUPABASE_URL: "https://production.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "production-key",
      VITE_SUPABASE_DEVELOPMENT_URL: "https://development.supabase.co",
      VITE_SUPABASE_DEVELOPMENT_PUBLISHABLE_KEY: "development-key",
    },
    "http://localhost:5000",
  );

  assert.equal(config?.supabaseUrl, "https://development.supabase.co");
  assert.equal(config?.supabasePublishableKey, "development-key");
  assert.equal(config?.clerkProxyUrl, "http://localhost:5000/api/__clerk");
});

test("mobile auth config fails closed when required public settings are missing", () => {
  assert.equal(
    createPublicMobileAuthConfig(
      { NODE_ENV: "production", CLERK_PUBLISHABLE_KEY: "pk_live_public" },
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
    CLERK_PUBLISHABLE_KEY: "pk_live_public",
    VITE_SUPABASE_URL: "https://project.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "public-supabase-key",
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
    assert.equal((await response.json()).clerkProxyUrl, `http://127.0.0.1:${address.port}/api/__clerk`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
});
