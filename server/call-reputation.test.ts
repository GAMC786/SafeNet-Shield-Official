import assert from "node:assert/strict";
import test from "node:test";

import { lookupCallReputation } from "./call-reputation";

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
  const previousUrl = process.env.SAFE_NET_CALL_REPUTATION_URL;
  const previousFetch = globalThis.fetch;
  process.env.SAFE_NET_CALL_REPUTATION_URL = "https://reputation.example.test/lookup";
  globalThis.fetch = async () => new Response(JSON.stringify({
    available: true,
    action: "block",
    source: "approved-test-source",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const result = await lookupCallReputation("+1 (555) 123-4567");
    assert.deepEqual(result, {
      available: true,
      action: "block",
      source: "approved-test-source",
      reason: undefined,
    });
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