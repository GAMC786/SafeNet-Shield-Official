import assert from "node:assert/strict";
import test from "node:test";

test("DeepCleer is unavailable and sends nothing until onboarding configuration exists", async () => {
  const original = {
    accessKey: process.env.DEEPCLEER_ACCESS_KEY,
    apiKey: process.env.DEEPCLEER_API_KEY,
    appId: process.env.DEEPCLEER_APP_ID,
    eventId: process.env.DEEPCLEER_EVENT_ID,
    tokenId: process.env.DEEPCLEER_TOKEN_ID,
    endpoint: process.env.DEEPCLEER_IMAGE_ENDPOINT,
  };
  let requestCount = 0;
  const originalFetch = globalThis.fetch;
  delete process.env.DEEPCLEER_ACCESS_KEY;
  delete process.env.DEEPCLEER_API_KEY;
  delete process.env.DEEPCLEER_APP_ID;
  delete process.env.DEEPCLEER_EVENT_ID;
  delete process.env.DEEPCLEER_TOKEN_ID;
  delete process.env.DEEPCLEER_IMAGE_ENDPOINT;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response("unexpected", { status: 200 });
  };

  try {
    const { getDeepCleerStatus, moderateDeepCleerImage } = await import("./deepcleer-service");
    const status = getDeepCleerStatus();
    assert.equal(status.available, false);
    assert.equal(status.configured, false);
    assert.deepEqual(status.capabilities, ["image", "video", "livestream", "text", "audio"]);
    await assert.rejects(
      () => moderateDeepCleerImage({
        consent: true,
        source: "camera",
        imageBase64: "data:image/jpeg;base64,ZmFrZQ==",
      }),
      (error: Error & { code?: string }) => error.code === "DEEPCLEER_UNAVAILABLE",
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      DEEPCLEER_ACCESS_KEY: original.accessKey,
      DEEPCLEER_API_KEY: original.apiKey,
      DEEPCLEER_APP_ID: original.appId,
      DEEPCLEER_EVENT_ID: original.eventId,
      DEEPCLEER_TOKEN_ID: original.tokenId,
      DEEPCLEER_IMAGE_ENDPOINT: original.endpoint,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("DeepCleer refuses image data without explicit consent", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response("unexpected", { status: 200 });
  };
  try {
    const { moderateDeepCleerImage } = await import("./deepcleer-service");
    await assert.rejects(
      () => moderateDeepCleerImage({
        consent: false as never,
        source: "screen",
        imageBase64: "data:image/png;base64,ZmFrZQ==",
      }),
      (error: Error & { code?: string }) => error.code === "DEEPCLEER_CONSENT_REQUIRED",
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepCleer sends an explicitly consented image to the configured HTTPS endpoint", async () => {
  const original = {
    accessKey: process.env.DEEPCLEER_ACCESS_KEY,
    appId: process.env.DEEPCLEER_APP_ID,
    eventId: process.env.DEEPCLEER_EVENT_ID,
    tokenId: process.env.DEEPCLEER_TOKEN_ID,
    endpoint: process.env.DEEPCLEER_IMAGE_ENDPOINT,
  };
  const originalFetch = globalThis.fetch;
  let request: { url: string; body: Record<string, unknown> } | null = null;
  process.env.DEEPCLEER_ACCESS_KEY = "test-access-key";
  process.env.DEEPCLEER_APP_ID = "test-app";
  process.env.DEEPCLEER_EVENT_ID = "test-event";
  process.env.DEEPCLEER_TOKEN_ID = "test-device";
  process.env.DEEPCLEER_IMAGE_ENDPOINT = "https://vendor.example/image/v4";
  globalThis.fetch = async (input, init) => {
    request = {
      url: typeof input === "string" ? input : input.url,
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
    };
    return new Response(JSON.stringify({ riskLevel: "safe" }), { status: 200 });
  };

  try {
    const { getDeepCleerStatus, moderateDeepCleerImage } = await import("./deepcleer-service");
    assert.equal(getDeepCleerStatus().available, true);
    const result = await moderateDeepCleerImage({
      consent: true,
      source: "screen",
      imageBase64: "ZmFrZS1pbWFnZQ==",
    });
    assert.equal(result.provider, "deepcleer");
    assert.equal(result.source, "screen");
    assert.equal(request?.url, "https://vendor.example/image/v4");
    assert.deepEqual(request?.body, {
      accessKey: "test-access-key",
      appId: "test-app",
      eventId: "test-event",
      type: "EROTIC",
      data: {
        img: "ZmFrZS1pbWFnZQ==",
        tokenId: "test-device",
      },
      acceptLang: "en",
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      DEEPCLEER_ACCESS_KEY: original.accessKey,
      DEEPCLEER_APP_ID: original.appId,
      DEEPCLEER_EVENT_ID: original.eventId,
      DEEPCLEER_TOKEN_ID: original.tokenId,
      DEEPCLEER_IMAGE_ENDPOINT: original.endpoint,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});