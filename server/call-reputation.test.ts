import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { beforeEach } from "node:test";

import {
  getCallReputationAvailability,
  lookupCallReputation,
  reportCall,
  resetCallShieldCache,
  verifyCallShieldShard,
  type CallShieldShardDescriptor,
} from "./call-reputation";
import {
  callShieldManifestFixture,
  callShieldShardFixture,
  callShieldSignatureFixture,
} from "./callshield-fixture";
import {
  CALLSHIELD_OFFLINE_FEED,
  CALLSHIELD_OFFLINE_MANIFEST,
  verifyCallShieldOfflineSnapshot,
} from "./callshield-offline-feed";

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

const CALLSHIELD_MANIFEST_URL =
  "https://raw.githubusercontent.com/SysAdminDoc/CallShield/master/data/spam_numbers.manifest.json";
const CALLSHIELD_SIGNATURE_URL = `${CALLSHIELD_MANIFEST_URL}.sig`;
const CALLSHIELD_SHARD_URL =
  "https://raw.githubusercontent.com/SysAdminDoc/CallShield/master/data/spam_number_shards/53.json";
const SIGNED_FIXTURE_NUMBER = "+12023225388";

function fixtureDescriptor(): CallShieldShardDescriptor {
  const manifest = JSON.parse(
    new TextDecoder().decode(callShieldManifestFixture),
  ) as { shards: CallShieldShardDescriptor[] };
  const descriptor = manifest.shards.find((shard) => shard.id === "53");
  assert.ok(descriptor);
  return descriptor;
}

function fixtureFeedResponse() {
  return new Response(JSON.stringify({
    ...feed,
    numbers: [{ number: SIGNED_FIXTURE_NUMBER, type: "legacy", reports: 3 }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fixtureFetch(options: {
  manifest?: Uint8Array;
  signature?: Uint8Array;
  shard?: Uint8Array;
  legacy?: Response | (() => Response | Promise<Response>);
} = {}) {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (url === CALLSHIELD_MANIFEST_URL) {
      return new Response(options.manifest ?? callShieldManifestFixture, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === CALLSHIELD_SIGNATURE_URL) {
      return new Response(options.signature ?? callShieldSignatureFixture, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (url === CALLSHIELD_SHARD_URL) {
      return new Response(options.shard ?? callShieldShardFixture, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return typeof options.legacy === "function"
      ? options.legacy()
      : options.legacy ?? feedResponse();
  };
}

test("CallShield accepts a fixed signed manifest and routes lookups to its verified shard", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fixtureFetch();
  try {
    assert.deepEqual(await lookupCallReputation(SIGNED_FIXTURE_NUMBER), {
      available: true,
      action: "block",
      source: "CallShield",
      reason: "CallShield robocall: 2 reports; call blocked.",
    });
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield rejects a changed signed manifest and uses the legacy fallback", async () => {
  const previousFetch = globalThis.fetch;
  const changedManifest = new Uint8Array(callShieldManifestFixture);
  changedManifest[changedManifest.length - 1] ^= 1;
  globalThis.fetch = fixtureFetch({
    manifest: changedManifest,
    legacy: fixtureFeedResponse(),
  });
  try {
    assert.deepEqual(await lookupCallReputation(SIGNED_FIXTURE_NUMBER), {
      available: true,
      action: "block",
      source: "CallShield",
      reason: "CallShield legacy: 3 reports; call blocked.",
    });
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield rejects wrong shard hashes, ids, and item counts", () => {
  const descriptor = fixtureDescriptor();
  assert.ok(verifyCallShieldShard(
    callShieldShardFixture,
    descriptor,
    "53",
  ));

  assert.equal(
    verifyCallShieldShard(
      callShieldShardFixture,
      { ...descriptor, sha256: "0".repeat(64) },
      "53",
    ),
    null,
  );
  assert.equal(
    verifyCallShieldShard(callShieldShardFixture, descriptor, "54"),
    null,
  );

  const shardHash = createHash("sha256").update(callShieldShardFixture).digest("hex");
  assert.equal(
    verifyCallShieldShard(
      callShieldShardFixture,
      { ...descriptor, sha256: shardHash, bytes: callShieldShardFixture.byteLength, numbers: descriptor.numbers + 1 },
      "53",
    ),
    null,
  );
});

test("CallShield falls back to the offline snapshot when signed and legacy feeds are unavailable", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fixtureFetch({
    manifest: new Uint8Array(Buffer.from("not signed")),
    legacy: async () => {
      throw new Error("legacy feed offline");
    },
  });
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
      "CallShield is configured; live lookups use the signed manifest and verified content-addressed shard feed, with a verified offline snapshot and legacy feed fallback.",
  });
});

test("CallShield blocks exact matches at every report count", async () => {
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
      reason: "CallShield scam: 12 reports; call blocked.",
    });
    assert.equal(request?.url, "https://raw.githubusercontent.com/SysAdminDoc/CallShield/master/data/spam_numbers.json");
    assert.equal(request?.headers.get("Accept"), "application/json");
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield blocks low-count exact matches and spam ranges", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => feedResponse();
  try {
    const lowCount = await lookupCallReputation("+1 (555) 765-4321");
    assert.equal(lowCount.available, true);
    if (lowCount.available) {
      assert.equal(lowCount.action, "block");
      assert.match(lowCount.reason ?? "", /robocall: 1 report/);
      assert.match(lowCount.reason ?? "", /call blocked/);
    }

    const range = await lookupCallReputation("+1 (555) 987-0000");
    assert.equal(range.available, true);
    if (range.available) {
      assert.equal(range.action, "block");
      assert.match(range.reason ?? "", /telemarketing match; call blocked/);
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
      available: true,
      action: "allow",
      source: "CallShield",
      reason: "CallShield found no matching spam number or range.",
    });
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield uses the verified offline snapshot when a fresh process cannot reach GitHub", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("GitHub is offline");
  };
  try {
    assert.deepEqual(await lookupCallReputation("+1 (905) 771-2581"), {
      available: true,
      action: "block",
      source: "CallShield",
      reason: "CallShield spam: 7 reports; call blocked.",
    });
  } finally {
    restoreFetch(previousFetch);
  }
});

test("CallShield offline manifests require approved data and an exact hash", () => {
  assert.equal(
    verifyCallShieldOfflineSnapshot(
      CALLSHIELD_OFFLINE_FEED,
      CALLSHIELD_OFFLINE_MANIFEST,
      41,
    ),
    true,
  );
  assert.equal(
    verifyCallShieldOfflineSnapshot(
      CALLSHIELD_OFFLINE_FEED,
      { ...CALLSHIELD_OFFLINE_MANIFEST, sha256: "0".repeat(64) },
    ),
    false,
  );
  assert.equal(
    verifyCallShieldOfflineSnapshot(
      CALLSHIELD_OFFLINE_FEED,
      CALLSHIELD_OFFLINE_MANIFEST,
      42,
    ),
    false,
  );
  assert.equal(
    verifyCallShieldOfflineSnapshot(
      CALLSHIELD_OFFLINE_FEED,
      { ...CALLSHIELD_OFFLINE_MANIFEST, redistributable: false },
    ),
    false,
  );
  assert.equal(
    verifyCallShieldOfflineSnapshot(
      CALLSHIELD_OFFLINE_FEED,
      { ...CALLSHIELD_OFFLINE_MANIFEST, formatVersion: 2 },
    ),
    false,
  );
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
    assert.deepEqual(result, {
      available: true,
      action: "allow",
      source: "CallShield",
      reason: "CallShield found no matching spam number or range.",
    });
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