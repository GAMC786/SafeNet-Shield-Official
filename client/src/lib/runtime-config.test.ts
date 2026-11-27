import assert from "node:assert/strict";
import test from "node:test";

import { loadSafeNetRuntimeConfig } from "./runtime-config";

test("uses complete compile-time authentication settings without a network request", async () => {
  let requests = 0;
  const config = await loadSafeNetRuntimeConfig(
    {
      DEV: true,
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      VITE_CLERK_PROXY_URL: "https://api.example.test/api/__clerk",
      VITE_SUPABASE_DEVELOPMENT_URL: "https://dev.supabase.test",
      VITE_SUPABASE_DEVELOPMENT_PUBLISHABLE_KEY: "dev-public-key",
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
  assert.equal(config.supabaseUrl, "https://dev.supabase.test");
});

test("loads missing APK settings from the configured public API origin", async () => {
  let requestedUrl = "";
  const config = await loadSafeNetRuntimeConfig(
    {
      DEV: false,
      VITE_API_URL: "https://api.example.test/",
      VITE_CLERK_PROXY_URL: "https://api.example.test/api/__clerk",
    },
    {
      origin: "https://localhost",
      fetcher: async (input) => {
        requestedUrl = input;
        return new Response(JSON.stringify({
          clerkPublishableKey: "pk_live_public",
          clerkProxyUrl: "https://api.example.test/api/__clerk",
          supabaseUrl: "https://project.supabase.test",
          supabasePublishableKey: "supabase-public-key",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  );

  assert.equal(requestedUrl, "https://api.example.test/api/auth/config");
  assert.equal(config.clerkPublishableKey, "pk_live_public");
  assert.equal(config.supabaseUrl, "https://project.supabase.test");
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
