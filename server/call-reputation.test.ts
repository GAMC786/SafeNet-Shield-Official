import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  getCallReputationAvailability,
  lookupCallReputation,
  reportCall,
  resetCallShieldCache,
} from "./call-reputation";

const feed = {
  version: 41,
  updated: "2026-09-05",
  numbers: [
    {
      number: "+15551234567",
      type: "scam",
      reports: 12,
      description: "Test scam number",
    },
    {
      number: "+15557654321",
      type: "robocall",
      reports: 1,
    },
  ],
  prefixes: [
    {
      prefix: "+1555987",
      type: "telemarketing",
    },
  ],
};

beforeEach(() => {
  delete process.env.SAFE_NET_CALL_REPUTATION_PROVIDER;
  delete process.env.SAFE_NET_CALL_REPUTATION_URL;
  delete process.env.SAFE_NET_CALL_REPUTATION_REPORT_URL;
  delete process.env.SAFE_NET_CALL_REPUTATION_TOKEN;
  delete process.env.SAFE_NET_CALLSHIELD_FEED_URL;
  delete process.env.SAFE_NET_CALLSHIELD_REPORT_URL;
  resetCallShieldCache();
});

function restoreFetch(previousFetch: typeof globalThis.fetch) {
  globalThis.fetch = previousFetch;
}

function feedResponse() {
  return new Response(JSON.stringify(feed), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("CallShield is the default configured reputation source without API credentials", async () => {
  globalThis.fetch = async () => {
    throw new Error("availability must not download the feed");
  };
  assert.deepEqual(await getCallReputationAvailability(), {
    status: "configured",
    failOpen: true,
    source: "CallShield",
    provider: "callshield",
    reportingAvailable: true,
    reason:
      "CallShield community data is configured; lookups use a cached feed and fail open when it is unavailable.",
  });
});

test("CallShield blocks high-confidence exact matches", async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return feedResponse();
  };
  try {
    assert.deepEqual(await lookupCallReputation("+1 (555) 123-4567"), {
      available: true,
      action: "block",
      source: "CallShield",
      reason: "CallShield scam: 12 reports.",
    });
    assert.equal(request?.url, "https://raw.githubusercontent.com/SysAdminDoc/CallShield/master/data/spam_numbers.json");
    assert.equal(request?.headers.get("Accept"), "application/json");
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield silences low-count exact matches and spam ranges conservatively", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => feedResponse();
  try {
    const lowCount = await lookupCallReputation("+1 (555) 765-4321");
    assert.equal(lowCount.available, true);
    if (lowCount.available) {
      assert.equal(lowCount.action, "silence");
      assert.match(lowCount.reason ?? "", /robocall: 1 report/);
    }

    const range = await lookupCallReputation("+1 (555) 987-0000");
    assert.equal(range.available, true);
    if (range.available) {
      assert.equal(range.action, "silence");
      assert.match(range.reason ?? "", /telemarketing match/);
    }
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield explicitly allows numbers absent from the feed", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => feedResponse();
  try {
    assert.deepEqual(await lookupCallReputation("+1 (555) 222-3333"), {
      available: true,
      action: "allow",
      source: "CallShield",
      reason: "CallShield found no matching spam number or range.",
    });
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield feed failures remain fail-open", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("feed offline");
  };
  try {
    const result = await lookupCallReputation("+1 (555) 222-3333");
    assert.deepEqual(result, {
      available: false,
      source: "CallShield",
      reason: "CallShield feed is unavailable; the call will be allowed.",
    });
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield rejects malformed feeds instead of creating a block", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    version: "not-a-number",
    numbers: [{ number: "+15551234567", reports: 999 }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  try {
    const result = await lookupCallReputation("+1 (555) 123-4567");
    assert.equal(result.available, false);
    assert.match(result.reason, /feed is unavailable/i);
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield reports are explicit POST submissions", async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ accepted: true }), { status: 202 });
  };
  try {
    assert.deepEqual(await reportCall(" +1 (555) 123-4567 ", "user_report"), {
      accepted: true,
      reason: "Report submitted to the CallShield community database.",
    });
    assert.equal(request?.method, "POST");
    assert.equal(request?.url, "https://callshield-reports.snafumatthew.workers.dev/");
    assert.deepEqual(await request?.json(), {
      number: "+15551234567",
      type: "spam",
    });
  } finally {
    restoreFetch(previousFetch);
  }
});

test("old Call Control configuration cannot reactivate the retired provider", async () => {
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "call-control";
  process.env.SAFE_NET_CALL_CONTROL_API_KEY = "retired-key";
  globalThis.fetch = async () => feedResponse();
  try {
    const result = await lookupCallReputation("+1 (555) 123-4567");
    assert.equal(result.available, true);
    if (result.available) {
      assert.equal(result.source, "CallShield");
      assert.equal(result.action, "block");
    }
  } finally {
    delete process.env.SAFE_NET_CALL_CONTROL_API_KEY;
    restoreFetch(previousFetch);
  }
});

test("approved-source remains available for an explicitly configured custom provider", async () => {
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_PROVIDER = "approved-source";
  process.env.SAFE_NET_CALL_REPUTATION_URL = "https://reputation.example.test/lookup";
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://reputation.example.test/lookup?number=%2B15551234567");
    return new Response(JSON.stringify({
      available: true,
      action: "block",
      source: "approved-test-source",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    assert.deepEqual(await lookupCallReputation("+1 (555) 123-4567"), {
      available: true,
      action: "block",
      source: "approved-test-source",
      reason: undefined,
    });
  } finally {
    restoreFetch(previousFetch);
  }
});