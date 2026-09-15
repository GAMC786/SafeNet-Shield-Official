import assert from "node:assert/strict";
import test from "node:test";

import { lookupCallReputation, reportCall } from "./call-reputation";

function restoreEnvironment(
  previous: Record<string, string | undefined>,
  previousFetch: typeof globalThis.fetch,
) {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("call reputation fails open when no approved source is configured", async () => {
  const previousUrl = process.env.SAFE_NET_CALL_REPUTATION_URL;
  delete process.env.SAFE_NET_CALL_REPUTATION_URL;
  try {
    const result = await lookupCallReputation("+1 (555) 123-4567");
    assert.equal(result.available, false);
    assert.match(result.reason, /not configured/i);
  } finally {
    if (previousUrl === undefined) delete process.env.SAFE_NET_CALL_REPUTATION_URL;
    else process.env.SAFE_NET_CALL_REPUTATION_URL = previousUrl;
  }
});

test("call reputation returns an explicit block decision from the approved source", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_URL: process.env.SAFE_NET_CALL_REPUTATION_URL,
    SAFE_NET_CALL_REPUTATION_TOKEN: process.env.SAFE_NET_CALL_REPUTATION_TOKEN,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_URL = "https://reputation.example.test/lookup";
  process.env.SAFE_NET_CALL_REPUTATION_TOKEN = " test-token ";
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({
    available: true,
    action: "block",
    source: "approved-test-source",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await lookupCallReputation("+1 (555) 123-4567");
    assert.deepEqual(result, {
      available: true,
      action: "block",
      source: "approved-test-source",
      reason: undefined,
    });
    assert.equal(request?.url, "https://reputation.example.test/lookup?number=%2B15551234567");
    assert.equal(request?.headers.get("Authorization"), "Bearer test-token");
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});

test("allow, silence, and block are preserved from the approved source", async () => {
  const previousUrl = process.env.SAFE_NET_CALL_REPUTATION_URL;
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_URL = "https://reputation.example.test/lookup";
  try {
    for (const action of ["allow", "silence", "block"] as const) {
      globalThis.fetch = async () => new Response(JSON.stringify({
        available: true,
        action,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      const result = await lookupCallReputation("+1 (555) 123-4567");
      assert.equal(result.available, true);
      if (result.available) assert.equal(result.action, action);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SAFE_NET_CALL_REPUTATION_URL;
    else process.env.SAFE_NET_CALL_REPUTATION_URL = previousUrl;
  }
});

test("invalid or unavailable reputation responses never become a block", async () => {
  const previousUrl = process.env.SAFE_NET_CALL_REPUTATION_URL;
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_URL = "https://reputation.example.test/lookup";
  globalThis.fetch = async () => new Response(JSON.stringify({
    available: true,
    action: "unknown",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const result = await lookupCallReputation("+1 (555) 123-4567");
    assert.equal(result.available, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SAFE_NET_CALL_REPUTATION_URL;
    else process.env.SAFE_NET_CALL_REPUTATION_URL = previousUrl;
  }
});

test("reports reach the configured provider without exposing the provider token to the result", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_URL: process.env.SAFE_NET_CALL_REPUTATION_URL,
    SAFE_NET_CALL_REPUTATION_REPORT_URL: process.env.SAFE_NET_CALL_REPUTATION_REPORT_URL,
    SAFE_NET_CALL_REPUTATION_TOKEN: process.env.SAFE_NET_CALL_REPUTATION_TOKEN,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_URL = "https://reputation.example.test/lookup";
  process.env.SAFE_NET_CALL_REPUTATION_REPORT_URL = "https://reputation.example.test/report";
  process.env.SAFE_NET_CALL_REPUTATION_TOKEN = "report-token";
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(null, { status: 202 });
  };
  try {
    const result = await reportCall(" +1 (555) 123-4567 ", "  user_report  ");
    assert.deepEqual(result, {
      accepted: true,
      reason: "Report submitted to the approved reputation source.",
    });
    assert.equal(request?.method, "POST");
    assert.equal(request?.url, "https://reputation.example.test/report");
    assert.equal(request?.headers.get("Authorization"), "Bearer report-token");
    assert.equal(request?.headers.get("Content-Type"), "application/json");
    assert.deepEqual(await request?.json(), {
      number: "+15551234567",
      reason: "user_report",
    });
    assert.equal(JSON.stringify(result).includes("report-token"), false);
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});

test("an unavailable report provider is reported as rejected instead of throwing", async () => {
  const previousUrl = process.env.SAFE_NET_CALL_REPUTATION_URL;
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_URL = "https://reputation.example.test/report";
  globalThis.fetch = async () => {
    throw new Error("provider offline");
  };
  try {
    const result = await reportCall("+1 (555) 123-4567", undefined);
    assert.equal(result.accepted, false);
    assert.match(result.reason, /could not be reached/i);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SAFE_NET_CALL_REPUTATION_URL;
    else process.env.SAFE_NET_CALL_REPUTATION_URL = previousUrl;
  }
});

test("non-HTTPS or credential-bearing provider URLs remain unavailable", async () => {
  const previousUrl = process.env.SAFE_NET_CALL_REPUTATION_URL;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not run");
  };
  try {
    for (const url of [
      "http://reputation.example.test/lookup",
      "https://user:password@reputation.example.test/lookup",
      "https://reputation.example.test/lookup#token",
    ]) {
      process.env.SAFE_NET_CALL_REPUTATION_URL = url;
      const result = await lookupCallReputation("+1 (555) 123-4567");
      assert.equal(result.available, false);
      assert.match(result.reason, /not configured/i);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SAFE_NET_CALL_REPUTATION_URL;
    else process.env.SAFE_NET_CALL_REPUTATION_URL = previousUrl;
  }
});