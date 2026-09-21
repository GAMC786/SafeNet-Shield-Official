import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../client/src/pages/Billing.tsx", import.meta.url),
  "utf8",
);

test("Premium billing requests cannot leave the page loading forever", () => {
  assert.match(source, /BILLING_REQUEST_TIMEOUT_MS = 12_000/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /fetchBilling\("\/api\/billing\/status"/);
  assert.match(source, /fetchBilling\("\/api\/billing\/portal"/);
  assert.match(source, /billingStatusError/);
  assert.match(source, /Try again/);
  assert.match(source, /Billing action failed/);
  assert.match(source, /RevenueCat/);
  assert.match(source, /Purchases\.configure/);
  assert.match(source, /Purchases\.getOfferings/);
  assert.match(source, /REVENUECAT_ANDROID_PACKAGE_IDENTIFIER = "\$rc_monthly"/);
  assert.match(source, /REVENUECAT_ANDROID_PRODUCT_IDENTIFIER = "premium_monthly:monthly"/);
  assert.match(source, /candidate\.product\.identifier === REVENUECAT_ANDROID_PRODUCT_IDENTIFIER/);
  assert.match(source, /Purchases\.purchasePackage/);
  assert.match(source, /Purchases\.restorePurchases/);
  assert.doesNotMatch(source, /Stripe/);
});