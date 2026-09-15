import assert from "node:assert/strict";
import test from "node:test";

import {
  getCallReputationAvailability,
  lookupCallReputation,
  reportCall,
} from "./call-reputation";

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

test("availability is redacted when the approved source is configured and reachable", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_URL: process.env.SAFE_NET_CALL_REPUTATION_URL,
    SAFE_NET_CALL_REPUTATION_TOKEN: process.env.SAFE_NET_CALL_REPUTATION_TOKEN,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_URL = "https://reputation.example.test/health";
  process.env.SAFE_NET_CALL_REPUTATION_TOKEN = "availability-token";
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(null, { status: 204 });
  };
  try {
    const result = await getCallReputationAvailability();
    assert.deepEqual(result, {
      status: "configured",
      failOpen: true,
      source: "SafeNet approved source",
      provider: "approved-source",
      reportingAvailable: true,
      reason: "The approved caller-reputation source is configured and reachable.",
    });
    assert.equal(request?.method, "HEAD");
    assert.equal(request?.url, "https://reputation.example.test/health");
    assert.equal(request?.headers.get("Authorization"), "Bearer availability-token");
    assert.equal(JSON.stringify(result).includes("availability-token"), false);
    assert.equal(JSON.stringify(result).includes("reputation.example.test"), false);
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});

test("availability remains fail-open when the approved source cannot be reached", async () => {
  const previousUrl = process.env.SAFE_NET_CALL_REPUTATION_URL;
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_URL = "https://reputation.example.test/health";
  globalThis.fetch = async () => {
    throw new Error("provider offline");
  };
  try {
    const result = await getCallReputationAvailability();
    assert.equal(result.status, "unavailable");
    assert.equal(result.failOpen, true);
    assert.match(result.reason, /could not be reached/i);
  } finally {
    globalThis.fetch = previousFetch;
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

test("Call Control Identify maps its documented response into SafeNet actions", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_PROVIDER: process.env.SAFE_NET_CALL_REPUTATION_PROVIDER,
    SAFE_NET_CALL_CONTROL_BASE_URL: process.env.SAFE_NET_CALL_CONTROL_BASE_URL,
    SAFE_NET_CALL_CONTROL_API_KEY: process.env.SAFE_NET_CALL_CONTROL_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "call-control-identify";
  process.env.SAFE_NET_CALL_CONTROL_BASE_URL =
    "https://api.callcontrol.example/api/2015-11-01/Reputation";
  process.env.SAFE_NET_CALL_CONTROL_API_KEY = "call-control-test-key";
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    return new Response(JSON.stringify({
      CallType: "Scam",
      Confidence: 9,
      IsSpam: true,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await lookupCallReputation("+1 (555) 123-4567");
    assert.deepEqual(result, {
      available: true,
      action: "block",
      source: "Call Control Identify",
      reason: "Call Control Identify: Scam, confidence 9/10.",
    });
    assert.equal(
      requests[0]?.url,
      "https://api.callcontrol.example/api/2015-11-01/Reputation/%2B15551234567?api_key=call-control-test-key",
    );
    assert.equal(requests[0]?.method, "GET");
    assert.equal(requests[0]?.headers.get("Authorization"), null);
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});

test("Call Control Identify preserves conservative allow and silence outcomes", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_PROVIDER: process.env.SAFE_NET_CALL_REPUTATION_PROVIDER,
    SAFE_NET_CALL_CONTROL_BASE_URL: process.env.SAFE_NET_CALL_CONTROL_BASE_URL,
    SAFE_NET_CALL_CONTROL_API_KEY: process.env.SAFE_NET_CALL_CONTROL_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "call-control-identify";
  process.env.SAFE_NET_CALL_CONTROL_BASE_URL =
    "https://api.callcontrol.example/api/2015-11-01/Reputation";
  process.env.SAFE_NET_CALL_CONTROL_API_KEY = "call-control-test-key";
  try {
    for (const payload of [
      { CallType: "Telemarketing", Confidence: 6, IsSpam: true, expected: "silence" },
      { CallType: "Unknown", Confidence: 2, IsSpam: true, expected: "allow" },
      { CallType: "Business", Confidence: 10, IsSpam: false, expected: "allow" },
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      const result = await lookupCallReputation("+1 (555) 123-4567");
      assert.equal(result.available, true);
      if (result.available) assert.equal(result.action, payload.expected);
    }
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});

test("Call Control Identify exposes configuration without probing a paid endpoint", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_PROVIDER: process.env.SAFE_NET_CALL_REPUTATION_PROVIDER,
    SAFE_NET_CALL_CONTROL_BASE_URL: process.env.SAFE_NET_CALL_CONTROL_BASE_URL,
    SAFE_NET_CALL_CONTROL_API_KEY: process.env.SAFE_NET_CALL_CONTROL_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "call-control-identify";
  process.env.SAFE_NET_CALL_CONTROL_BASE_URL =
    "https://api.callcontrol.example/api/2015-11-01/Reputation";
  process.env.SAFE_NET_CALL_CONTROL_API_KEY = "call-control-test-key";
  globalThis.fetch = async () => {
    throw new Error("availability must not make a provider request");
  };
  try {
    assert.deepEqual(await getCallReputationAvailability(), {
      status: "configured",
      failOpen: true,
      source: "Call Control Identify",
      provider: "call-control-identify",
      reportingAvailable: false,
      reason: "Call Control Identify is configured; live access is verified during lookup.",
    });
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});

test("Call Control Identify reports fail open on malformed and rate-limited responses", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_PROVIDER: process.env.SAFE_NET_CALL_REPUTATION_PROVIDER,
    SAFE_NET_CALL_CONTROL_BASE_URL: process.env.SAFE_NET_CALL_CONTROL_BASE_URL,
    SAFE_NET_CALL_CONTROL_API_KEY: process.env.SAFE_NET_CALL_CONTROL_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "call-control-identify";
  process.env.SAFE_NET_CALL_CONTROL_BASE_URL =
    "https://api.callcontrol.example/api/2015-11-01/Reputation";
  process.env.SAFE_NET_CALL_CONTROL_API_KEY = "call-control-test-key";
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ IsSpam: "yes" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const malformed = await lookupCallReputation("+1 (555) 123-4567");
    assert.equal(malformed.available, false);
    assert.match(malformed.reason, /invalid response/i);

    globalThis.fetch = async () => new Response(null, { status: 429 });
    const limited = await lookupCallReputation("+1 (555) 123-4567");
    assert.equal(limited.available, false);
    assert.match(limited.reason, /rate limit/i);
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});

test("Call Control Identify does not pretend to accept reports", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_PROVIDER: process.env.SAFE_NET_CALL_REPUTATION_PROVIDER,
    SAFE_NET_CALL_CONTROL_BASE_URL: process.env.SAFE_NET_CALL_CONTROL_BASE_URL,
    SAFE_NET_CALL_CONTROL_API_KEY: process.env.SAFE_NET_CALL_CONTROL_API_KEY,
  };
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "call-control-identify";
  process.env.SAFE_NET_CALL_CONTROL_BASE_URL =
    "https://api.callcontrol.example/api/2015-11-01/Reputation";
  process.env.SAFE_NET_CALL_CONTROL_API_KEY = "call-control-test-key";
  try {
    assert.deepEqual(await reportCall("+1 (555) 123-4567", "user_report"), {
      accepted: false,
      reason:
        "Call Control's public APIs do not publish a report endpoint. Add the number to SafeNet's local blocklist for immediate protection.",
    });
  } finally {
    if (previous.SAFE_NET_CALL_REPUTATION_PROVIDER === undefined) {
      delete process.env.SAFE_NET_CALL_REPUTATION_PROVIDER;
    } else {
      process.env.SAFE_NET_CALL_REPUTATION_PROVIDER =
        previous.SAFE_NET_CALL_REPUTATION_PROVIDER;
    }
    if (previous.SAFE_NET_CALL_CONTROL_BASE_URL === undefined) {
      delete process.env.SAFE_NET_CALL_CONTROL_BASE_URL;
    } else {
      process.env.SAFE_NET_CALL_CONTROL_BASE_URL =
        previous.SAFE_NET_CALL_CONTROL_BASE_URL;
    }
    if (previous.SAFE_NET_CALL_CONTROL_API_KEY === undefined) {
      delete process.env.SAFE_NET_CALL_CONTROL_API_KEY;
    } else {
      process.env.SAFE_NET_CALL_CONTROL_API_KEY =
        previous.SAFE_NET_CALL_CONTROL_API_KEY;
    }
  }
});

test("Call Control Protect maps its documented actions and optional customer number", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_PROVIDER: process.env.SAFE_NET_CALL_REPUTATION_PROVIDER,
    SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL: process.env.SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL,
    SAFE_NET_CALL_CONTROL_CUSTOMER_NUMBER: process.env.SAFE_NET_CALL_CONTROL_CUSTOMER_NUMBER,
    SAFE_NET_CALL_CONTROL_API_KEY: process.env.SAFE_NET_CALL_CONTROL_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "call-control";
  process.env.SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL =
    "https://api.callcontrol.example/api/2015-11-01/Enterprise/ShouldBlock";
  process.env.SAFE_NET_CALL_CONTROL_CUSTOMER_NUMBER = "+1 (416) 555-1212";
  process.env.SAFE_NET_CALL_CONTROL_API_KEY = "call-control-test-key";
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify("voiceMail"), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await lookupCallReputation("+1 (555) 123-4567");
    assert.deepEqual(result, {
      available: true,
      action: "silence",
      source: "Call Control Protect",
      reason: "Call Control Protect returned silence.",
    });
    assert.equal(
      request?.url,
      "https://api.callcontrol.example/api/2015-11-01/Enterprise/ShouldBlock/%2B15551234567/%2B14165551212?api_key=call-control-test-key",
    );
    assert.equal(request?.method, "GET");
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});

test("Call Control Protect takes precedence and Identify provides a bounded fallback", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_PROVIDER: process.env.SAFE_NET_CALL_REPUTATION_PROVIDER,
    SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL: process.env.SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL,
    SAFE_NET_CALL_CONTROL_BASE_URL: process.env.SAFE_NET_CALL_CONTROL_BASE_URL,
    SAFE_NET_CALL_CONTROL_API_KEY: process.env.SAFE_NET_CALL_CONTROL_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "call-control";
  process.env.SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL =
    "https://api.callcontrol.example/api/2015-11-01/Enterprise/ShouldBlock";
  process.env.SAFE_NET_CALL_CONTROL_BASE_URL =
    "https://api.callcontrol.example/api/2015-11-01/Reputation";
  process.env.SAFE_NET_CALL_CONTROL_API_KEY = "call-control-test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 429 })
      : new Response(JSON.stringify({
          CallType: "Telemarketing",
          Confidence: 6,
          IsSpam: true,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
  };
  try {
    const result = await lookupCallReputation("+1 (555) 123-4567");
    assert.equal(calls, 2);
    assert.deepEqual(result, {
      available: true,
      action: "silence",
      source: "Call Control Identify (fallback)",
      reason: "Call Control Identify: Telemarketing, confidence 6/10. Protect was unavailable.",
    });
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});

test("Call Control Protect availability does not probe the provider", async () => {
  const previous = {
    SAFE_NET_CALL_REPUTATION_PROVIDER: process.env.SAFE_NET_CALL_REPUTATION_PROVIDER,
    SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL: process.env.SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL,
    SAFE_NET_CALL_CONTROL_API_KEY: process.env.SAFE_NET_CALL_CONTROL_API_KEY,
  };
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "call-control";
  process.env.SAFE_NET_CALL_CONTROL_PROTECT_BASE_URL =
    "https://api.callcontrol.example/api/2015-11-01/Enterprise/ShouldBlock";
  process.env.SAFE_NET_CALL_CONTROL_API_KEY = "call-control-test-key";
  globalThis.fetch = async () => {
    throw new Error("availability must not make a provider request");
  };
  try {
    assert.deepEqual(await getCallReputationAvailability(), {
      status: "configured",
      failOpen: true,
      source: "Call Control Protect + Identify",
      provider: "call-control",
      reportingAvailable: false,
      reason: "Call Control Protect is configured as primary; Identify is available as fallback when configured.",
    });
  } finally {
    restoreEnvironment(previous, previousFetch);
  }
});