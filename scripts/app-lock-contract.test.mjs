import assert from "node:assert/strict";
import {
  chmodSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const readSource = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  appGradle,
  manager,
  activity,
  appLock,
  service,
  instrumentation,
  deviceScript,
  workflow,
  manifest,
  nativeView,
  plugin,
  mainActivity,
  dashboard,
  recoveryService,
  strings,
  composeUi,
  lockLockNotice,
] = await Promise.all([
  readSource("android/app/build.gradle"),
  readSource("android/app/src/main/java/com/safenet/dns/AppLockManager.java"),
  readSource("android/app/src/main/java/com/safenet/dns/LockLockActivity.java"),
  readSource("android/app/src/main/java/com/safenet/dns/AppLockActivity.java"),
  readSource("android/app/src/main/java/com/safenet/dns/OpenLockMonitorService.java"),
  readSource(
    "android/app/src/androidTest/java/com/safenet/dns/AppLockInstrumentationTest.java",
  ),
  readSource("scripts/android-app-lock-device-test.sh"),
  readSource(".github/workflows/build.yml"),
  readSource("android/app/src/main/AndroidManifest.xml"),
  readSource("android/app/src/main/java/com/safenet/dns/NativeAppLockView.java"),
  readSource("android/app/src/main/java/com/safenet/dns/SafeNetVpnPlugin.java"),
  readSource("android/app/src/main/java/com/safenet/dns/MainActivity.java"),
  readSource("client/src/pages/Dashboard.tsx"),
  readSource("server/app-lock-recovery.ts"),
  readSource("android/app/src/main/res/values/strings.xml"),
  readSource("android/app/src/main/java/com/safenet/dns/LockLockComposeUi.kt"),
  readSource("android/third_party/locklock/NOTICE.md"),
]);
const clientApp = await readSource("client/src/App.tsx");

const repositoryRoot = new URL("..", import.meta.url);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractWorkflowRunBlock(stepName) {
  const step = workflow.match(
    new RegExp(
      `^      - name: ${escapeRegExp(stepName)}\\n(?<step>[\\s\\S]*?)(?=^      - name:|^  [A-Za-z0-9_-]+:)`,
      "m",
    ),
  )?.groups?.step;
  assert.ok(step, `Workflow step is missing: ${stepName}`);

  const runStart = step.indexOf("\n        run: |\n");
  assert.notEqual(runStart, -1, `Workflow step has no run block: ${stepName}`);
  return step
    .slice(runStart + "\n        run: |\n".length)
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n")
    .trimEnd();
}

const physicalCheckScript = extractWorkflowRunBlock(
  "Run OpenLock selected-app proof on physical phone",
);
const blockedFallbackScript = extractWorkflowRunBlock(
  "Record blocked OpenLock evidence when the physical runner is unavailable",
);

function readFields(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function createRunnerFixture() {
  const root = mkdtempSync(join(tmpdir(), "android-app-lock-runner-"));
  const bin = join(root, "bin");
  const evidence = join(root, "evidence");
  mkdirSync(bin);
  mkdirSync(evidence);
  for (const command of [
    "awk",
    "bash",
    "head",
    "hostname",
    "mkdir",
    "rm",
    "sed",
    "sha256sum",
    "tee",
    "tr",
    "uname",
  ]) {
    const resolved = execFileSync("which", [command], { encoding: "utf8" }).trim();
    symlinkSync(resolved, join(bin, command));
  }
  return { root, bin, evidence };
}

function installMockAdb(bin, { devices, devicesStatus = 0 }) {
  const adbPath = join(bin, "adb");
  writeFileSync(
    adbPath,
    `#!/usr/bin/env bash
if [[ "\${1:-}" == "devices" ]]; then
  printf '%s\\n' "\${ADB_DEVICES_OUTPUT:-}"
  exit "\${ADB_DEVICES_STATUS:-0}"
fi
exit 0
`,
  );
  chmodSync(adbPath, 0o755);
  return {
    ADB_DEVICES_OUTPUT: devices,
    ADB_DEVICES_STATUS: String(devicesStatus),
  };
}

function runWorkflowScript(script, fixture, environment = {}) {
  return spawnSync("bash", ["-c", script], {
    cwd: repositoryRoot.pathname,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_WORKSPACE: fixture.root,
      ANDROID_APP_LOCK_OUTPUT_DIR: "evidence",
      ANDROID_HOME: fixture.root,
      ANDROID_SDK_ROOT: fixture.root,
      GITHUB_REF: "refs/tags/v1.0.29",
      GITHUB_SHA: "fixture-sha",
      ...environment,
    },
  });
}

function assertBlockedEvidence(fixture, expectedCategory) {
  const resultPath = join(fixture.evidence, "result.txt");
  assert.ok(statSync(resultPath).size <= 200_000);
  const fields = readFields(resultPath);
  assert.equal(fields.result, "BLOCKED");
  assert.equal(fields.blocker_category, expectedCategory);
  assert.equal(fields.blocker_class, "DEVICE_ACCESS");
  assert.equal(
    fields.diagnostics,
    "adb-devices.txt,adb-version.txt,device-properties.txt,runner-metadata.txt",
  );
  for (const file of [
    "adb-devices.txt",
    "adb-version.txt",
    "device-properties.txt",
    "runner-metadata.txt",
  ]) {
    assert.ok(
      statSync(join(fixture.evidence, file)).size <= 200_000,
      `${file} exceeded the bounded diagnostic size`,
    );
  }
  return fields;
}

test("App Lock uses a local passcode and the AppLock-style Accessibility Service", () => {
  assert.doesNotMatch(appGradle, /androidx\.biometric:biometric/);
  assert.match(manager, /passcode remains local/);
  assert.match(manager, /PREF_RECOVERY_HASH/);
  assert.match(manager, /HASH_ROUNDS = 100_000/);
  assert.match(manager, /verifyPin\(Context context, String pin\)/);
  assert.match(manager, /attempts >= 5/);
  assert.match(manager, /PREF_COOLDOWN_UNTIL/);
  assert.match(manager, /verifyRecoveryAnswer/);
  assert.match(manager, /isAccessibilityServiceEnabled/);
  assert.match(manager, /disableAntiUninstall/);
  assert.match(manager, /removeActiveAdmin/);
  assert.doesNotMatch(activity, /BiometricPrompt/);
  assert.match(activity, /disableAntiUninstall/);
});

test("AppLock uses explicit Accessibility, overlay, and Device Admin boundaries", () => {
  assert.match(manager, /isAccessibilityServiceEnabled/);
  assert.match(manager, /isOverlayPermissionEnabled/);
  assert.match(manager, /isDeviceAdminEnabled/);
  assert.match(service, /AccessibilityService/);
  assert.match(service, /TYPE_WINDOW_STATE_CHANGED/);
  assert.match(service, /AppLockActivity.class/);
  assert.match(service, /postDelayed\(retryPendingLaunch, RETRY_DELAY_MS\)/);
  assert.match(service, /packageName\.equals\(pendingPackage\)/);
  assert.match(
    service,
    /startActivity\(lockIntent\);[\s\S]*lastLaunchedPackage = packageName;/,
  );
  assert.match(manifest, /BIND_ACCESSIBILITY_SERVICE/);
  assert.doesNotMatch(manifest, /PACKAGE_USAGE_STATS/);
  assert.match(manifest, /SYSTEM_ALERT_WINDOW/);
  assert.match(manifest, /BIND_DEVICE_ADMIN/);
  assert.match(manifest, /QUERY_ALL_PACKAGES/);
});

test("predictive system Back uses the protected lock-screen guard", () => {
  assert.match(activity, /OnBackPressedCallback/);
  assert.match(activity, /getOnBackPressedDispatcher\(\)\.addCallback\(this/);
  assert.match(activity, /LockLockActivity\.this\.onBackPressed\(\)/);
  assert.match(
    instrumentation,
    /systemBackDispatcherCannotDismissProtectedAppLockScreen/,
  );
  assert.match(instrumentation, /getOnBackPressedDispatcher\(\)[\s\S]*\.onBackPressed\(\)/);
});

test("the embedded AppLock dashboard covers setup, app selection, and permission recovery", () => {
  assert.match(appLock, /public final class AppLockActivity extends LockLockActivity/);
  assert.match(appLock, /useEmbeddedAppLockDashboard/);
  assert.match(appLock, /showAppLockDashboard/);
  assert.match(appLock, /Select Apps/);
  assert.match(appLock, /Search apps/);
  assert.match(appLock, /Add protected apps/);
  assert.match(appLock, /Open Accessibility Settings/);
  assert.match(appLock, /Allow overlay/);
  assert.match(appLock, /Open Device Administrator/);
  assert.match(appLock, /AppLock passcode saved/);
  assert.match(appLock, /AppLockManager\.setLockedPackages/);
  assert.match(appLock, /onAuthenticationSucceeded/);
  assert.match(appLock, /EXTRA_OPEN_DASHBOARD_AFTER_AUTH/);
  assert.match(manifest, /android:name="\.AppLockActivity"/);
});

test("the active AppLock configuration is the LockLock Compose integration", () => {
  assert.match(appLock, /LockLockComposeUi\.render/);
  assert.match(appLock, /openHostedSignInFromCompose/);
  assert.match(appGradle, /org\.jetbrains\.kotlin\.android/);
  assert.match(appGradle, /org\.jetbrains\.kotlin\.plugin\.compose/);
  assert.match(appGradle, /androidx\.compose\.material3:material3/);
  assert.match(composeUi, /import androidx\.compose\.ui\.platform\.ViewCompositionStrategy/);
  assert.doesNotMatch(composeUi, /import androidx\.compose\.ui\.platform\.setContent/);
  assert.match(
    composeUi,
    /LockLockSwitch\(checked\) \{ newChecked ->\s*if \(newChecked != checked\) onClick\(\)/,
  );
  assert.match(composeUi, /https:\/\/github\.com\/nethical6\/LockLock/);
  assert.match(composeUi, /Select Apps/);
  assert.match(composeUi, /LockLockRecoveryDialog/);
  assert.match(composeUi, /LockLockAppSelectionItem/);
  assert.match(lockLockNotice, /GNU General Public License v3\.0/);
  assert.match(lockLockNotice, /github\.com\/nethical6\/LockLock/);
});

test("the embedded LockLock pages use SafeNet's cyber visual system", () => {
  assert.match(composeUi, /SafeNetBackground/);
  assert.match(composeUi, /SafeNetPrimary/);
  assert.match(composeUi, /SafeNetAccent/);
  assert.match(composeUi, /FontFamily\.Monospace/);
  assert.match(composeUi, /BorderStroke/);
  assert.match(composeUi, /ANDROID PERMISSION GATE/);
  assert.match(composeUi, /SECURE LOCAL CONTROL/);
  assert.match(composeUi, /safeNetFieldColors/);
});

test("configured users authenticate before opening AppLock management", () => {
  assert.match(mainActivity, /AppLockManager\.MODE_UNLOCK/);
  assert.match(mainActivity, /EXTRA_OPEN_DASHBOARD_AFTER_AUTH/);
  assert.match(appLock, /onAuthenticationSucceeded/);
  assert.match(appLock, /mode = AppLockManager\.MODE_SETUP/);
});

test("enabling, disabling, recovery, and passcode unlock use the native App Lock activity", () => {
  assert.match(plugin, /MODE_SETUP/);
  assert.match(plugin, /MODE_DISABLE/);
  assert.match(plugin, /startActivityForResult\(call, intent, "appLockActivityResult"\)/);
  assert.match(plugin, /appLockActivityResult/);
  assert.match(activity, /Save passcode and enable App Lock/);
  assert.match(activity, /Use passcode fallback/);
  assert.match(activity, /Forgot passcode/);
  assert.match(activity, /verifyRecoveryAnswer/);
  assert.match(activity, /Open Accessibility Settings/);
  assert.match(activity, /Allow App Lock Overlay/);
  assert.match(activity, /Open Device Administrator Settings/);
  assert.doesNotMatch(manifest, /USE_BIOMETRIC/);
});

test("App Lock identifies SafeNet in Android Device Administrator settings", () => {
  assert.match(strings, /<string name="locklock_service_label">SafeNet App Lock<\/string>/);
  assert.doesNotMatch(strings, /OpenLock App Protection/);
});

test("App Lock setup respects system bars and keeps launcher icons in a separate right column", () => {
  assert.match(activity, /WindowCompat\.setDecorFitsSystemWindows\(window, false\)/);
  assert.match(activity, /ViewCompat\.setOnApplyWindowInsetsListener\(scrollView/);
  assert.match(activity, /WindowInsetsCompat\.Type\.systemBars\(\)/);
  assert.match(activity, /applicationInfo\.loadIcon\(getPackageManager\(\)\)/);
  assert.match(activity, /appRow\.setOrientation\(LinearLayout\.HORIZONTAL\)/);
  assert.match(activity, /appCheck\.setEllipsize\(TextUtils\.TruncateAt\.END\)/);
  assert.match(activity, /appRow\.addView\(appCheck, new LinearLayout\.LayoutParams\(\s*0,\s*LinearLayout\.LayoutParams\.MATCH_PARENT,\s*1f/);
  assert.match(activity, /appRow\.addView\(appIconView, new LinearLayout\.LayoutParams\(dp\(40\), -1\)\)/);
  assert.match(activity, /child instanceof LinearLayout && \(\(LinearLayout\) child\)\.getChildCount\(\) > 0/);
});

test("App Lock setup exposes verified email recovery", () => {
  assert.match(activity, /Use email sign-in recovery/);
  assert.match(activity, /showEmailRecovery\(\)/);
  assert.match(activity, /Save a passcode before using email-assisted recovery/);
});

test("email-assisted App Lock recovery resets locally without unlocking directly", () => {
  assert.match(activity, /Email-assisted recovery/);
  assert.match(activity, /\/api\/app-lock\/recovery\/request/);
  assert.match(activity, /\/api\/app-lock\/recovery\/verify/);
  assert.match(activity, /AppLockManager\.resetPin\(this, pinValue\)/);
  assert.match(activity, /AppLockManager\.clearSession\(\)/);
  assert.match(activity, /showUnlock\(\)/);
  assert.match(manager, /public static void resetPin\(Context context, String pin\)/);
  assert.match(manager, /Passcode must contain 4 to 12 digits/);
  assert.match(recoveryService, /CODE_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(recoveryService, /MAX_ATTEMPTS = 5/);
  assert.match(recoveryService, /clerkClient\(\)\.emails\.create/);
  assert.match(recoveryService, /to: \{ userId \}/);
});

test("provider recovery returns through a one-time Android handoff", () => {
  assert.match(manager, /EXTRA_RECOVERY_HANDOFF/);
  assert.match(appLock, /safenet:\/\/app-lock\/recovery/);
  assert.match(activity, /MODE_ACCOUNT_RECOVERY/);
  assert.match(activity, /handoff\/exchange/);
  assert.match(activity, /consumeRecoveryNonce/);
  assert.match(manager, /createRecoveryNonce/);
  assert.match(manager, /hasPendingRecoveryNonce/);
  assert.match(manifest, /android:scheme="safenet"/);
  assert.match(mainActivity, /handleAppLockRecoveryIntent/);
  assert.match(recoveryService, /createAppLockRecoveryHandoff/);
  assert.match(recoveryService, /exchangeAppLockRecoveryHandoff/);
  assert.match(recoveryService, /oauth_handoff/);
  assert.match(clientApp, /app-lock-recovery-complete/);
  assert.match(clientApp, /handoff\/start/);
});

test("App Lock setup uses the SafeNet dashboard visual hierarchy", () => {
  assert.match(activity, /"App Lock Configuration"/);
  assert.match(activity, /sectionLabel\("PASSCODE FALLBACK"\)/);
  assert.match(activity, /sectionLabel\("OFFLINE RECOVERY"\)/);
  assert.match(activity, /sectionLabel\("PROTECTED APPS"\)/);
  assert.match(activity, /sectionLabel\("ANDROID PERMISSIONS"\)/);
  assert.match(activity, /private LinearLayout sectionCard\(\)/);
  assert.match(activity, /title\.toUpperCase\(Locale\.US\)/);
  assert.match(activity, /description\.toUpperCase\(Locale\.US\)/);
});

test("the lock surface and dashboard identify AppLock local passcode protection", () => {
  assert.match(nativeView, /SafeNet App Lock/);
  assert.match(nativeView, /local SafeNet passcode/);
  assert.match(dashboard, /App Lock Protection/);
  assert.match(dashboard, /AppLock-style protection/);
  assert.match(dashboard, /Accessibility Service/);
  assert.doesNotMatch(dashboard, /disabled=\{!appLock\.supported \|\| !appLock\.status\.available/);
});

test("VPN and proxy browser blocking is removed from the Android surface", () => {
  assert.doesNotMatch(plugin, /VpnProxyBrowserBlocker/);
  assert.doesNotMatch(service, /VpnProxyBrowserBlocker/);
  assert.doesNotMatch(manifest, /VpnProxyBrowserBlocker/);
  assert.doesNotMatch(dashboard, /VPN &amp; Proxy Browser Blocker/);
});

test("instrumentation covers lifecycle, permissions, duplicate activity protection, and return flow", () => {
  for (const marker of [
    "appLockDashboardCreatesPasscodeSelectsAppsAndReturnsFromSettings",
    "APPLOCK_DASHBOARD result=PASS",
    "setupRecoveryCooldownResetAndDisabledAdminStatus",
      "accessibilityServiceLocksSafeNetAndSecondPackageWithoutDuplicateActivities",
    "physicalDeviceLocksSelectedThirdPartyAppWithoutDuplicateActivities",
      "settings put secure enabled_accessibility_services",
    "dpm remove-active-admin",
    "LOCKLOCK_PHYSICAL_WRONG_PIN result=PASS",
    "com.android.settings",
    "dumpsys activity activities",
    "countActivityRecords(activities, \"com.safenet.dns/.LockLockActivity\")",
    "unlockCurrentLockScreen(PIN)",
    "rejectCurrentLockScreen(\"0000\")",
    "isForegroundPackage(targetPackage)",
    "LOCKLOCK_PHYSICAL_RETURN result=PASS",
    "LOCKLOCK_PHYSICAL_REOPEN result=PASS",
    "LOCKLOCK_PHYSICAL_REOPEN_AUTH result=PASS",
    "LOCKLOCK_PHYSICAL_OTHER_APP result=PASS",
    "LOCKLOCK_LIFECYCLE result=PASS",
      "OPENLOCK_ACCESSIBILITY result=PASS activity_records=1",
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
    "settings get secure enabled_accessibility_services",
    "dumpsys package",
    "shell getprop",
    "package-state.txt",
    "accessibility_enabled=",
    "selected_app_resumed=",
    "selected_app_reopened_locked=",
    "temporary_unlock_isolated=",
    "APPLOCK_DASHBOARD result=PASS",
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
    /android-app-lock-physical-preflight:[\s\S]+listSelfHostedRunnersForRepo[\s\S]+NO_PHYSICAL_RUNNER/,
  );
  assert.match(
    workflow,
    /android-app-lock-physical:\n\s+needs: \[build-android, android-app-lock-physical-preflight\][\s\S]+runner_available == 'true'/,
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
  assert.match(workflow, /android-openlock-physical\/latest/);
  assert.match(
    workflow,
    /Record blocked OpenLock evidence when the physical runner is unavailable[\s\S]+if: always\(\)/,
  );
  assert.match(workflow, /--blocker "\$blocker"[\s\S]+--message "\$message"/);
  assert.match(workflow, /NO_READY_PHYSICAL_PHONE|NO_PHYSICAL_PHONE/);
  assert.match(workflow, /## OpenLock Android instrumentation/);
});

test("physical LockLock preflight classifies every runner blocker with bounded evidence", () => {
  const scenarios = [
    {
      name: "adb unavailable",
      expectedCategory: "ADB_UNAVAILABLE",
      environment: {
        PATH: "/usr/bin:/bin",
      },
    },
    {
      name: "ADB device discovery failure",
      expectedCategory: "ADB_DEVICE_DISCOVERY_FAILED",
      devices: "adb server could not connect",
      devicesStatus: 1,
    },
    {
      name: "no ready physical phone",
      expectedCategory: "NO_READY_PHYSICAL_PHONE",
      devices: "List of devices attached\nphone-serial\tunauthorized",
      devicesStatus: 0,
    },
    {
      name: "emulator-only discovery",
      expectedCategory: "NO_PHYSICAL_PHONE",
      devices: "List of devices attached\nemulator-5554\tdevice",
      devicesStatus: 0,
    },
  ];

  for (const scenario of scenarios) {
    const fixture = createRunnerFixture();
    const adbEnvironment =
      scenario.devices === undefined
        ? {}
        : installMockAdb(fixture.bin, {
            devices: scenario.devices,
            devicesStatus: scenario.devicesStatus,
          });
    const result = runWorkflowScript(physicalCheckScript, fixture, {
      PATH:
        scenario.devices === undefined
          ? fixture.bin
          : `${fixture.bin}:/usr/bin:/bin`,
      ...adbEnvironment,
    });

    assert.equal(
      result.status,
      78,
      `${scenario.name} did not preserve the blocked exit status:\n${result.stdout}\n${result.stderr}`,
    );
    assertBlockedEvidence(fixture, scenario.expectedCategory);
  }
});

test("physical LockLock runner setup failure writes bounded blocked evidence", () => {
  const fixture = createRunnerFixture();
  const result = runWorkflowScript(blockedFallbackScript, fixture, {
    CHECKOUT_OUTCOME: "failure",
    JAVA_OUTCOME: "success",
    PLATFORM_TOOLS_OUTCOME: "success",
    SDK_OUTCOME: "success",
    APK_DOWNLOAD_OUTCOME: "success",
    TEST_APK_DOWNLOAD_OUTCOME: "success",
    CHECK_OUTCOME: "skipped",
    PATH: "/usr/bin:/bin",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const fields = assertBlockedEvidence(fixture, "RUNNER_PREFLIGHT_FAILED");
  assert.match(fields.message, /step outcome: failure/);
  assert.equal(fields.workflow_checkout_outcome, "failure");
  assert.equal(fields.workflow_check_outcome, "skipped");
});

test("physical LockLock discovery fallback writes a bounded blocker when no result exists", () => {
  const fixture = createRunnerFixture();
  const result = runWorkflowScript(blockedFallbackScript, fixture, {
    CHECKOUT_OUTCOME: "success",
    JAVA_OUTCOME: "success",
    PLATFORM_TOOLS_OUTCOME: "success",
    SDK_OUTCOME: "success",
    APK_DOWNLOAD_OUTCOME: "success",
    TEST_APK_DOWNLOAD_OUTCOME: "success",
    CHECK_OUTCOME: "failure",
    PATH: "/usr/bin:/bin",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const fields = assertBlockedEvidence(fixture, "DEVICE_DISCOVERY_FAILED");
  assert.match(fields.message, /did not produce a result during device discovery/);
  assert.equal(fields.workflow_check_outcome, "failure");
});

test("physical LockLock fallback preserves real-device PASS and application FAIL results", () => {
  for (const resultValue of ["PASS", "FAIL"]) {
    const fixture = createRunnerFixture();
    const resultPath = join(fixture.evidence, "result.txt");
    writeFileSync(
      resultPath,
      `validation_mode=physical-device\nresult=${resultValue}\n`,
    );
    const before = readFileSync(resultPath, "utf8");
    const result = runWorkflowScript(blockedFallbackScript, fixture, {
      CHECKOUT_OUTCOME: "failure",
      CHECK_OUTCOME: "failure",
      PATH: "/usr/bin:/bin",
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(resultPath, "utf8"), before);
    assert.doesNotMatch(readFileSync(resultPath, "utf8"), /^result=BLOCKED$/m);
  }
});
