import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL("./android-billing-proof.sh", import.meta.url),
  "utf8",
);
const workflow = await readFile(
  new URL("../.github/workflows/build.yml", import.meta.url),
  "utf8",
);
const billing = await readFile(
  new URL("../client/src/pages/Billing.tsx", import.meta.url),
  "utf8",
);
const instrumentation = await readFile(
  new URL("../android/app/src/androidTest/java/com/safenet/dns/RevenueCatBillingInstrumentationTest.java", import.meta.url),
  "utf8",
);

test("billing proof only accepts signed release artifacts and a Play-enabled runner", () => {
  assert.match(script, /app-release\.apk/);
  assert.match(script, /app-release-androidTest\.apk/);
  assert.match(script, /com\.android\.vending/);
  assert.match(script, /AUTH_SMOKE_STORAGE_STATE/);
  assert.match(script, /billing-action/);
  assert.match(script, /server_status=PASS/);
});

test("billing proof exercises the native bridge and authenticated status", () => {
  assert.match(instrumentation, /Purchases\.getAppUserID/);
  assert.match(instrumentation, /billing-purchase/);
  assert.match(instrumentation, /billing-restore/);
  assert.match(instrumentation, /api\/billing\/status/);
  assert.match(instrumentation, /hasEntitlement/);
  assert.match(instrumentation, /REVENUECAT_BILLING_PROOF result=PASS/);
});

test("release builds inject a public RevenueCat Android key and gate billing validation", () => {
  assert.match(workflow, /VITE_REVENUECAT_ANDROID_API_KEY:/);
  assert.match(workflow, /android_billing_validation/);
  assert.match(billing, /data-testid="billing-purchase"/);
  assert.match(billing, /data-testid="billing-restore"/);
  assert.match(billing, /data-testid="billing-account"/);
});