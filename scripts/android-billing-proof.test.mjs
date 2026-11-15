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
const clerkProxy = await readFile(
  new URL("../server/middlewares/clerkProxyMiddleware.ts", import.meta.url),
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
  assert.match(script, /AUTH_SMOKE_STORAGE_STATE/);
  assert.match(script, /repository secret is required for the Clerk billing session/);
  assert.match(script, /api\/billing\/preflight/);
  assert.match(script, /purchase dialog was not launched/);
  assert.match(script, /configuration_preflight=FAIL/);
  assert.match(script, /billing-action/);
  assert.match(script, /signedOutBillingRecoversFromClerkStartupStall/);
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
  assert.match(instrumentation, /REVENUECAT_BILLING_PROOF result=PASS/);
});

test("packaged Billing proves signed-out Clerk recovery and preserves redirects", () => {
  assert.match(instrumentation, /billing-signed-out/);
  assert.match(instrumentation, /billing-clerk-recovery/);
  assert.match(instrumentation, /billing-clerk-retry/);
  assert.match(instrumentation, /redirect_context=PASS/);
  assert.match(billing, /billing_clerk_stall/);
  assert.match(billing, /data-testid="billing-sign-in"/);
  assert.match(billing, /retryUrl\.searchParams\.delete/);
});

test("packaged Clerk sign-in uses the SafeNet proxy for Android WebViews", () => {
  assert.match(clerkProxy, /getNativeWebViewOrigin/);
  assert.match(clerkProxy, /proxyReq\.setHeader\("Origin", `\$\{protocol\}:\/\/\$\{host\}`\)/);
  assert.match(clerkProxy, /headers\["access-control-allow-origin"\] = nativeOrigin/);
  assert.match(app, /VITE_CLERK_PROXY_URL/);
  assert.match(apkOnlyWorkflow, /VITE_CLERK_PROXY_URL="\$\{api_origin\}\/api\/__clerk"/);
  assert.match(androidBuildScript, /VITE_CLERK_PROXY_URL="\$\{VITE_API_URL\}\/api\/__clerk"/);
  assert.match(workflow, /VITE_CLERK_PROXY_URL="\$\{api_origin\}\/api\/__clerk"/);
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
  assert.match(workflow, /AUTH_SMOKE_STORAGE_STATE repository secret is required before Android billing validation can run/);
  assert.match(workflow, /listSelfHostedRunnersForRepo/);
  assert.match(workflow, /requiredLabel = 'android-play-billing'/);
  assert.match(workflow, /No online idle self-hosted runner has the/);
  assert.match(
    workflow,
    /needs:\s*\[build-android,\s*android-billing-preflight\]/,
  );
  assert.match(workflow, /needs\.android-billing-preflight\.result == 'success'/);
});
