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
const app = await readFile(
  new URL("../client/src/App.tsx", import.meta.url),
  "utf8",
);
const instrumentation = await readFile(
  new URL("../android/app/src/androidTest/java/com/safenet/dns/RevenueCatBillingInstrumentationTest.java", import.meta.url),
  "utf8",
);
const apkOnlyWorkflow = await readFile(
  new URL("../.github/workflows/build-apk-only.yml", import.meta.url),
  "utf8",
);
const androidBuildScript = await readFile(
  new URL("./build-android.sh", import.meta.url),
  "utf8",
);

test("billing proof only accepts signed release artifacts and a Play-enabled runner", () => {
  assert.match(script, /app-release\.apk/);
  assert.match(script, /app-release-androidTest\.apk/);
  assert.match(script, /com\.android\.vending/);
  assert.match(script, /AUTH0_SMOKE_STORAGE_STATE/);
  assert.match(script, /repository secret is required for the Auth0 billing session/);
  assert.match(script, /api\/billing\/preflight/);
  assert.match(script, /purchase dialog was not launched/);
  assert.match(script, /configuration_preflight=FAIL/);
  assert.match(script, /billing-action/);
  assert.match(script, /signedOutBillingRecoversFromAuth0StartupStall/);
  assert.match(script, /account_recovery=PASS/);
  assert.match(script, /REVENUECAT_BILLING_RECOVERY_PROOF result=PASS/);
  assert.match(script, /server_status=PASS/);
});

test("billing proof exercises the native bridge and authenticated status", () => {
  assert.match(instrumentation, /Purchases\.getAppUserID/);
  assert.match(instrumentation, /billing-purchase/);
  assert.match(instrumentation, /billing-restore/);
  assert.match(instrumentation, /api\/billing\/status/);
  assert.match(instrumentation, /hasEntitlement/);
  assert.match(instrumentation, /api\/billing\/preflight/);
  assert.match(instrumentation, /monthlyAvailable/);
  assert.match(instrumentation, /REVENUECAT_BILLING_PROOF result=PASS configuration_preflight=PASS auth0_identity=PASS/);
});

test("packaged Billing proves signed-out Auth0 recovery and preserves redirects", () => {
  assert.match(billing, /data-testid="billing-auth-recovery"/);
  assert.match(billing, /data-testid="billing-auth-retry"/);
  assert.match(instrumentation, /redirect_context=PASS/);
  assert.match(billing, /billing_auth_stall/);
  assert.match(billing, /data-testid="billing-sign-in"/);
  assert.match(billing, /retryUrl\.searchParams\.delete/);
});

test("packaged sign-in uses Auth0 with the SafeNet Android callback", () => {
  assert.match(app, /Auth0Provider/);
  assert.match(app, /safenet:\/\/auth\/callback/);
  assert.match(app, /handleRedirectCallback\(callbackUrl\)/);
  assert.doesNotMatch(apkOnlyWorkflow, /VITE_CLERK_PROXY_URL/);
  assert.doesNotMatch(androidBuildScript, /VITE_CLERK_PROXY_URL/);
  assert.doesNotMatch(workflow, /VITE_CLERK_PROXY_URL/);
});

test("production APKs use the public API instead of the auth smoke host", () => {
  const buildAndroidEnv = workflow.match(/^  build-android:[\s\S]*?^    steps:/m)?.[0] || "";
  assert.match(buildAndroidEnv, /MOBILE_API_URL:\s*https:\/\/safe-net-shield-official\.replit\.app/);
  assert.doesNotMatch(buildAndroidEnv, /MOBILE_API_URL:\s*\$\{\{\s*secrets\.AUTH_SMOKE_BASE_URL/);
});

test("release builds inject a public RevenueCat Android key and gate billing validation", () => {
  assert.match(workflow, /VITE_REVENUECAT_ANDROID_API_KEY:/);
  assert.match(workflow, /android_billing_validation/);
  assert.match(billing, /data-testid="billing-purchase"/);
  assert.match(billing, /data-testid="billing-restore"/);
  assert.match(billing, /data-testid="billing-account"/);
  assert.match(billing, /Purchases\.configure\(\{ apiKey: REVENUECAT_ANDROID_API_KEY \}\)/);
  assert.match(billing, /data-testid="billing-play-manage"/);
  assert.doesNotMatch(billing, /fetchBilling\("\/api\/billing\/preflight"/);
});

test("manual billing validation fails before queueing without its prerequisites", () => {
  assert.match(workflow, /android-billing-preflight:/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /AUTH0_SMOKE_STORAGE_STATE repository secret is required before Android billing validation can run/);
  assert.match(workflow, /listSelfHostedRunnersForRepo/);
  assert.match(workflow, /requiredLabel = 'android-play-billing'/);
  assert.match(workflow, /No online idle self-hosted runner has the/);
  assert.match(
    workflow,
    /needs:\s*\[build-android,\s*android-billing-preflight\]/,
  );
  assert.match(workflow, /needs\.android-billing-preflight\.result == 'success'/);
});
