import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  "Run LockLock selected-app proof on physical phone",
);
const blockedFallbackScript = extractWorkflowRunBlock(
  "Record blocked LockLock evidence when the physical runner is unavailable",
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
  return { root, bin, evidence };
}

function resolveCommand(command) {
  for (const directory of (process.env.PATH || "").split(":")) {
    if (!directory) continue;
    const candidate = join(directory, command);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Continue through the PATH entries.
    }
  }
  throw new Error(`Could not resolve required test command: ${command}`);
}

function createAdbFreePath(bin) {
  for (const command of [
    "awk",
    "bash",
    "cat",
    "head",
    "hostname",
    "mkdir",
    "rm",
    "sed",
    "tee",
    "tr",
    "uname",
    "wc",
  ]) {
    symlinkSync(resolveCommand(command), join(bin, command));
  }
  return bin;
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
          ? createAdbFreePath(fixture.bin)
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
