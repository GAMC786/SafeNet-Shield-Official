import assert from "node:assert/strict";
import test from "node:test";
import { fetchJsonWithTimeout, getPublicIp } from "./network";

test("public IP lookup falls back when the first provider fails", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("ipify")) {
      throw new TypeError("Failed to fetch");
    }
    return new Response(JSON.stringify({ ip: "198.51.100.44" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    assert.deepEqual(await getPublicIp(), { ip: "198.51.100.44" });
    assert.deepEqual(requestedUrls, [
      "https://api.ipify.org?format=json",
      "https://ipwho.is/",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("network JSON requests expose provider error messages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ message: "provider unavailable" }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );

  try {
    await assert.rejects(
      fetchJsonWithTimeout("https://example.test/status", { timeoutMs: 100 }),
      /provider unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});