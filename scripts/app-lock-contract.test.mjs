import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  manager,
  activity,
  service,
  instrumentation,
  deviceScript,
  workflow,
  manifest,
  nativeView,
  plugin,
  dashboard,
] = await Promise.all([
  readSource("android/app/src/main/java/com/safenet/dns/AppLockManager.java"),
  readSource("android/app/src/main/java/com/safenet/dns/LockLockActivity.java"),
  readSource("android/app/src/main/java/com/safenet/dns/LockLockAccessibilityService.java"),
  readSource(
    "android/app/src/androidTest/java/com/safenet/dns/AppLockInstrumentationTest.java",
  ),
  readSource("scripts/android-app-lock-device-test.sh"),
  readSource(".github/workflows/build.yml"),
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
  assert.match(dashboard, /Secure App Locker by LockLock API/);
  assert.match(dashboard, /brute-force cooldowns/);
  assert.match(dashboard, /salted local hashes/);
  assert.doesNotMatch(dashboard, /disabled=\{!appLock\.supported \|\| !appLock\.status\.available/);
});

test("instrumentation covers lifecycle, permissions, duplicate activity protection, and return flow", () => {
  for (const marker of [
    "setupRecoveryCooldownResetAndDisabledAdminStatus",
    "accessibilityLocksSafeNetAndSecondPackageWithoutDuplicateActivities",
    "physicalDeviceLocksSelectedThirdPartyAppWithoutDuplicateActivities",
    "settings put secure enabled_accessibility_services",
    "dpm remove-active-admin",
    "com.android.settings",
    "dumpsys activity activities",
    "countActivityRecords(activities, \"com.safenet.dns/.LockLockActivity\")",
    "unlockCurrentLockScreen(PIN)",
    "isForegroundPackage(targetPackage)",
    "LOCKLOCK_PHYSICAL_RETURN result=PASS",
    "LOCKLOCK_PHYSICAL_OTHER_APP result=PASS",
    "LOCKLOCK_LIFECYCLE result=PASS",
    "LOCKLOCK_ACCESSIBILITY result=PASS activity_records=1",
  ]) {
    assert.match(instrumentation, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the dedicated runner publishes bounded LockLock evidence", () => {
  for (const marker of [
    'readonly DEFAULT_APK="artifacts/android/app-release.apk"',
    'readonly DEFAULT_TEST_APK="artifacts/android-test/app-release-androidTest.apk"',
    'readonly DEFAULT_APK_CHECKSUM="${DEFAULT_APK}.sha256"',
    'readonly DEFAULT_APK_METADATA="${DEFAULT_APK}.metadata"',
    'TEST_CLASS="${PACKAGE_NAME}.AppLockInstrumentationTest"',
    "sha256sum --check --status",
    'apksigner" verify --verbose "$apk_path"',
    'aapt" dump badging "$apk_path"',
    "release_ref=",
    "release_sha=",
    "artifact_verification=",
    "write_blocked_result",
    "result=BLOCKED",
    "blocker_class=DEVICE_ACCESS",
    "blocker_category=",
    "adb devices -l",
    "runner-metadata.txt",
    "apk_sha256=",
    "logcat -d -t 800",
    "dumpsys activity activities",
    "dumpsys accessibility",
    "dumpsys package",
    "shell getprop",
    "package-state.txt",
    "selected_app_resumed=",
    "temporary_unlock_isolated=",
    "result.txt",
  ]) {
    assert.match(
      deviceScript,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(
    workflow,
    /android-app-lock:\n\s+needs: build-android[\s\S]+android-writable-system/,
  );
  assert.match(
    workflow,
    /android-app-lock-device-test\.sh[\s\S]+app-release-androidTest\.apk/,
  );
  assert.match(
    workflow,
    /writeReleaseArtifactMetadata[\s\S]+app-release\.apk\.metadata/,
  );
  assert.match(
    workflow,
    /--release-ref "\$GITHUB_REF"[\s\S]+--release-sha "\$GITHUB_SHA"/,
  );
  assert.match(
    workflow,
    /Signed APK SHA-256/,
  );
  assert.match(
    workflow,
    /name: SafeNet-DNS-Android-app-lock-evidence[\s\S]+android-app-lock\/latest/,
  );
  assert.match(workflow, /android-locklock-physical\/latest/);
  assert.match(
    workflow,
    /Record blocked LockLock evidence when the physical runner is unavailable[\s\S]+if: always\(\)/,
  );
  assert.match(workflow, /--blocker "\$blocker"[\s\S]+--message "\$message"/);
  assert.match(workflow, /NO_READY_PHYSICAL_PHONE|NO_PHYSICAL_PHONE/);
  assert.match(workflow, /## LockLock Android instrumentation/);
});
