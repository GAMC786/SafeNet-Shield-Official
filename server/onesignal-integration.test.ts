import assert from "node:assert/strict";
import test from "node:test";

test("OneSignal sends only generic high-severity security alerts", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = process.env.REPL_IDENTITY;
  const requests: Array<{ path: string; method: string; body: string }> = [];

  process.env.REPL_IDENTITY = "test-identity";
  globalThis.fetch = async (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input.url);
    const path = requestUrl.pathname.replace("/api/v2/proxy", "") + requestUrl.search;
    requests.push({
      path,
      method: init?.method || "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });

    if (path === "/notifications?app_id=9717b96d-844d-44de-9a84-4e5a7c374b80&limit=1&offset=0") {
      return new Response(JSON.stringify({ total_count: 0, notifications: [] }), { status: 200 });
    }
    if (path === "/notifications" && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "message-1" }), { status: 200 });
    }
    throw new Error(`Unexpected OneSignal path: ${path}`);
  };

  try {
    const { getOneSignalStatus, notifySecurityEvent } = await import("./replit_integrations/onesignal/client");
    assert.deepEqual(await getOneSignalStatus(), {
      connected: true,
      configured: true,
      message: "OneSignal is connected and ready for push security alerts.",
    });

    const result = await notifySecurityEvent({
      eventId: 42,
      severity: "critical",
      threatType: "malware",
      action: "blocked",
    });
    assert.deepEqual(result, {
      sent: true,
      messageId: "message-1",
      message: "Security alert sent to subscribed devices.",
    });

    const notification = requests.find((request) => request.method === "POST");
    const body = JSON.parse(notification?.body || "{}") as {
      app_id?: string;
      included_segments?: string[];
      contents?: { en?: string };
      data?: Record<string, string>;
    };
    assert.equal(body.app_id, "9717b96d-844d-44de-9a84-4e5a7c374b80");
    assert.deepEqual(body.included_segments, ["Subscribed Users"]);
    assert.equal(body.contents?.en, "SafeNet Shield blocked a critical-severity malware threat.");
    assert.deepEqual(body.data, {
      source: "safenet-shield",
      event_id: "42",
      severity: "critical",
      action: "blocked",
    });
    assert.doesNotMatch(notification?.body || "", /example\.com|secret|file-content/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) {
      delete process.env.REPL_IDENTITY;
    } else {
      process.env.REPL_IDENTITY = originalIdentity;
    }
  }
});

test("OneSignal skips low-severity events without calling the provider", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = process.env.REPL_IDENTITY;
  let requestCount = 0;

  process.env.REPL_IDENTITY = "test-identity";
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ id: "unexpected" }), { status: 200 });
  };

  try {
    const { notifySecurityEvent } = await import("./replit_integrations/onesignal/client");
    const result = await notifySecurityEvent({
      eventId: 43,
      severity: "medium",
      threatType: "phishing",
      action: "warned",
    });
    assert.deepEqual(result, {
      sent: false,
      message: "Only high and critical security events send push notifications.",
    });
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) {
      delete process.env.REPL_IDENTITY;
    } else {
      process.env.REPL_IDENTITY = originalIdentity;
    }
  }
});