import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  manager,
  activity,
  service,
  manifest,
  nativeView,
  plugin,
  dashboard,
] = await Promise.all([
  readSource("android/app/src/main/java/com/safenet/dns/AppLockManager.java"),
  readSource("android/app/src/main/java/com/safenet/dns/LockLockActivity.java"),
  readSource("android/app/src/main/java/com/safenet/dns/LockLockAccessibilityService.java"),
  readSource("android/app/src/main/AndroidManifest.xml"),
  readSource("android/app/src/main/java/com/safenet/dns/NativeAppLockView.java"),
  readSource("android/app/src/main/java/com/safenet/dns/SafeNetVpnPlugin.java"),
  readSource("client/src/pages/Dashboard.tsx"),
]);

test("LockLock stores offline hashes and applies brute-force cooldowns", () => {
  assert.match(manager, /salted passcode\/recovery hashes/);
  assert.match(manager, /HASH_ROUNDS = 100_000/);
  assert.match(manager, /verifyPin\(Context context, String pin\)/);
  assert.match(manager, /attempts >= 5/);
  assert.match(manager, /PREF_COOLDOWN_UNTIL/);
  assert.match(manager, /verifyRecoveryAnswer/);
  assert.doesNotMatch(manager, /BiometricPrompt/);
});

test("LockLock uses explicit Accessibility and Device Admin boundaries", () => {
  assert.match(manager, /isAccessibilityEnabled/);
  assert.match(manager, /isDeviceAdminEnabled/);
  assert.match(service, /AccessibilityService/);
  assert.match(service, /LockLockActivity.class/);
  assert.match(service, /blockSafeNetUninstallIfVisible/);
  assert.match(manifest, /BIND_ACCESSIBILITY_SERVICE/);
  assert.match(manifest, /BIND_DEVICE_ADMIN/);
  assert.match(manifest, /QUERY_ALL_PACKAGES/);
});

test("enabling, disabling, and recovery use the native LockLock activity", () => {
  assert.match(plugin, /MODE_SETUP/);
  assert.match(plugin, /MODE_DISABLE/);
  assert.match(plugin, /startActivityForResult\(call, intent, "appLockActivityResult"\)/);
  assert.match(plugin, /appLockActivityResult/);
  assert.match(activity, /Save passcode and enable LockLock/);
  assert.match(activity, /Forgot passcode/);
  assert.match(activity, /verifyRecoveryAnswer/);
  assert.match(activity, /Open Accessibility Settings/);
  assert.match(activity, /Open Device Administrator Settings/);
});

test("the lock surface and dashboard use the LockLock product label", () => {
  assert.match(nativeView, /Secure App Lock by LockLock API/);
  assert.match(nativeView, /Offline LockLock protection/);
  assert.match(dashboard, /Secure App Lock by LockLock API/);
  assert.match(dashboard, /brute-force cooldowns/);
  assert.match(dashboard, /salted local hashes/);
  assert.doesNotMatch(dashboard, /disabled=\{!appLock\.supported \|\| !appLock\.status\.available/);
});