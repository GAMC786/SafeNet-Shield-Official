import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  getClamAvStatus,
  scanWithClamAv,
  verifyClamAv,
} from "./clamav-service";

const originalUrl = process.env.CLAMAV_REST_URL;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalUrl === undefined) {
    delete process.env.CLAMAV_REST_URL;
  } else {
    process.env.CLAMAV_REST_URL = originalUrl;
  }
  globalThis.fetch = originalFetch;
});

test("ClamAV verification proves both clean and EICAR threat responses", async () => {
  process.env.CLAMAV_REST_URL = "http://clamav.example.test/";
  let scanCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok", version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(url, "http://clamav.example.test/scan");
    scanCount += 1;
    const body = Buffer.from(init?.body as Uint8Array).toString("utf8");
    return new Response(
      body.includes("EICAR")
        ? JSON.stringify({ infected: true, viruses: ["Eicar-Test-Signature"] })
        : JSON.stringify({ infected: false, message: "OK" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const verification = await verifyClamAv();
  assert.equal(verification.verified, true);
  assert.equal(verification.cleanScan?.verdict, "clean");
  assert.equal(verification.threatScan?.verdict, "threat");
  assert.equal(verification.threatScan?.threatName, "Eicar-Test-Signature");
  assert.equal(scanCount, 2);

  const status = await getClamAvStatus();
  assert.equal(status.reachable, true);
  assert.equal(status.verified, true);
  assert.equal(status.engineVersion, "1.2.3");

  const scan = await scanWithClamAv(Buffer.from("a clean user file"));
  assert.equal(scan.verdict, "clean");
});

test("ClamAV scanning stays unavailable until verification passes", async () => {
  process.env.CLAMAV_REST_URL = "http://unverified-clamav.example.test";
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });

  await assert.rejects(
    () => scanWithClamAv(Buffer.from("a file")),
    /not verified/,
  );
});

test("ClamAV proof is shared across instances and invalidated by engine changes", async () => {
  process.env.CLAMAV_REST_URL = "http://shared-clamav.example.test";
  let engineVersion = "1.2.3";
  let persisted: Awaited<ReturnType<NonNullable<Parameters<typeof verifyClamAv>[0]>["getClamAvVerification"]>> = null;
  const store = {
    getClamAvVerification: async () => persisted,
    saveClamAvVerification: async (record: NonNullable<typeof persisted>) => {
      persisted = record;
    },
  };

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok", version: engineVersion }), { status: 200 });
    }
    const body = Buffer.from(init?.body as Uint8Array).toString("utf8");
    return new Response(
      body.includes("EICAR")
        ? JSON.stringify({ infected: true, viruses: ["Eicar-Test-Signature"] })
        : JSON.stringify({ infected: false, message: "OK" }),
      { status: 200 },
    );
  };

  await verifyClamAv(store);
  assert.equal(persisted?.engineVersion, "1.2.3");

  // A separate store object represents a fresh instance reading the shared
  // row; it must not need process-local proof to report or perform scans.
  const freshInstanceStore = {
    getClamAvVerification: async () => persisted,
    saveClamAvVerification: async () => {},
  };
  const sharedStatus = await getClamAvStatus(freshInstanceStore);
  assert.equal(sharedStatus.verified, true);
  assert.equal(sharedStatus.lastVerifiedEngineVersion, "1.2.3");
  await scanWithClamAv(Buffer.from("a clean file"), freshInstanceStore);

  engineVersion = "1.2.4";
  const changedStatus = await getClamAvStatus(freshInstanceStore);
  assert.equal(changedStatus.verified, false);
  assert.equal(changedStatus.lastVerifiedEngineVersion, "1.2.3");
  await assert.rejects(
    () => scanWithClamAv(Buffer.from("a clean file"), freshInstanceStore),
    /not verified/,
  );
});

test("ClamAV configuration with embedded credentials is rejected", async () => {
  process.env.CLAMAV_REST_URL = "https://user:password@clamav.example.test";

  const status = await getClamAvStatus();
  assert.equal(status.configured, false);
  assert.equal(status.reachable, false);
  assert.match(status.message, /without embedded credentials/);
});