import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [manager, activity, nativeView, plugin, dashboard] = await Promise.all([
  readSource("android/app/src/main/java/com/safenet/dns/AppLockManager.java"),
  readSource("android/app/src/main/java/com/safenet/dns/MainActivity.java"),
  readSource("android/app/src/main/java/com/safenet/dns/NativeAppLockView.java"),
  readSource("android/app/src/main/java/com/safenet/dns/SafeNetVpnPlugin.java"),
  readSource("client/src/pages/Dashboard.tsx"),
]);

test("app lock delegates credentials to Android and permits retries", () => {
  assert.match(manager, /new BiometricPrompt\(/);
  assert.match(
    manager,
    /BIOMETRIC_STRONG\s*\|\s*BiometricManager\.Authenticators\.DEVICE_CREDENTIAL/,
  );
  assert.match(manager, /setDeviceCredentialAllowed\(true\)/);
  assert.match(manager, /onAuthenticationSucceeded/);
  assert.match(manager, /onAuthenticationFailed\(\)/);
  assert.match(manager, /promptActive = false;\s*callback\.onSuccess\(\)/);
  assert.match(manager, /promptActive = false;\s*callback\.onFailure/);
  assert.match(manager, /prompt\.authenticate\(promptBuilder\.build\(\)\)/);
  assert.match(
    manager,
    /catch \(RuntimeException error\)[\s\S]*promptActive = false;[\s\S]*could not be opened/,
  );
});

test("enabling and unlocking only change SafeNet state after authentication", () => {
  assert.match(
    plugin,
    /authenticateForAppLock\(call, enabled, enabled[\s\S]*Enable AndroidX Secure App Lock/,
  );
  assert.match(
    plugin,
    /onSuccess\(\)[\s\S]*AppLockManager\.setEnabled\(getContext\(\), enabledAfterAuthentication\)/,
  );
  assert.match(
    plugin,
    /onFailure\(String message\)[\s\S]*call\.reject\(message, "APP_LOCK_AUTHENTICATION_FAILED"\)/,
  );
  assert.doesNotMatch(plugin, /DevicePolicyManager|setLockTask|requestDismissKeyguard/);
});

test("the lock surface exposes Android credentials and security-settings recovery", () => {
  assert.match(nativeView, /Enter credentials/);
  assert.match(nativeView, /SafeNet never sees or stores it/);
  assert.match(nativeView, /Open Android security settings/);
  assert.match(activity, /Settings\.ACTION_SECURITY_SETTINGS/);
  assert.match(activity, /No Android credential is available/);
  assert.match(activity, /This does not lock your phone or other apps/);
  assert.match(dashboard, /SafeNet never stores them or locks your phone/);
  assert.match(dashboard, /data-testid="button-lock-app-now"/);
});