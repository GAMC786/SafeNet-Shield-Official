import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const startupScript = readFileSync(
  new URL("./android-smoke-test.sh", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const buildWorkflow = readFileSync(
  new URL("../.github/workflows/build.yml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

const startupCheckStart = startupScript.indexOf("run_startup_check() {");
const startupCheckEnd = startupScript.indexOf(
  '\necho "Installing release APKs on Android target',
  startupCheckStart,
);
assert.notEqual(startupCheckStart, -1, "startup check function is missing");
assert.notEqual(startupCheckEnd, -1, "startup check function boundary is missing");
const startupCheck = startupScript.slice(startupCheckStart, startupCheckEnd);
const startupEvidenceCheckStart = startupScript.indexOf(
  "verify_startup_evidence() {",
);
const startupEvidenceCheckEnd = startupScript.indexOf(
  "\nstartup_failure() {",
  startupEvidenceCheckStart,
);
assert.notEqual(
  startupEvidenceCheckStart,
  -1,
  "startup evidence completeness check is missing",
);
assert.notEqual(
  startupEvidenceCheckEnd,
  -1,
  "startup evidence completeness check boundary is missing",
);
const startupEvidenceCheck = startupScript.slice(
  startupEvidenceCheckStart,
  startupEvidenceCheckEnd,
);

const startupJobStart = buildWorkflow.indexOf("  android-release-startup:");
const startupJobEnd = buildWorkflow.indexOf("\n  build-windows:", startupJobStart);
assert.notEqual(startupJobStart, -1, "dedicated Android startup job is missing");
assert.notEqual(startupJobEnd, -1, "dedicated Android startup job boundary is missing");
const startupJob = buildWorkflow.slice(startupJobStart, startupJobEnd);

test("Android startup check records the complete evidence contract", () => {
  for (const screenshot of [
    "startup-initial.png",
    "startup-progress.png",
    "startup-handoff.png",
  ]) {
    assert.match(
      startupCheck,
      new RegExp(`capture_startup_screenshot ${screenshot.replace(".", "\\.")}\\b`),
      `startup check must capture ${screenshot}`,
    );
  }

  assert.match(
    startupCheck,
    /capture startup-logcat\.txt adb "\$\{adb_args\[@\]\}" shell logcat -d -t 600/,
    "startup check must capture bounded logcat evidence",
  );
  for (const evidence of [
    "startup-initial.png",
    "startup-progress.png",
    "startup-handoff.png",
    "startup-logcat.txt",
  ]) {
    assert.match(
      startupEvidenceCheck,
      new RegExp(`\\s${evidence.replace(".", "\\.")}\\s`),
      `startup check must require ${evidence}`,
    );
  }
  assert.match(
    startupEvidenceCheck,
    /if \[\[ ! -s "\$output_dir\/\$evidence_name" \]\]/,
    "startup check must reject missing or empty evidence files",
  );
  assert.match(
    startupEvidenceCheck,
    /startup evidence is incomplete; missing or empty files:/,
    "startup check must report incomplete evidence clearly",
  );
  assert.match(
    startupCheck,
    /web_loader=RECORDED\\nwebview_transition=PASS\\nresult=PASS\\n/,
    "startup check must record the successful loader handoff markers",
  );
});

test("dedicated startup job samples the loader at a compact emulator height", () => {
  assert.match(
    startupScript,
    /COMPACT_STARTUP_WM_SIZE="480x640"/,
    "compact startup sampling must use a small-height emulator display",
  );
  assert.match(
    startupScript,
    /shell wm size "\$COMPACT_STARTUP_WM_SIZE"/,
    "compact startup sampling must apply the compact display size",
  );
  assert.match(
    startupScript,
    /SafeNetVpnUiInstrumentationTest#startupLoaderProgressIsMonotonicAndOpaqueUntilHandoff/,
    "compact startup sampling must run the existing startup sampling case",
  );
  assert.match(
    startupScript,
    /restore_compact_wm_size/,
    "compact startup sampling must restore the emulator display size",
  );
  assert.match(
    startupJob,
    /--compact-startup[\s\S]*?--test-apk/,
    "the dedicated startup job must invoke compact sampling with its test APK",
  );
});

test("dedicated Android startup job uploads its evidence directory", () => {
  const evidenceDirectory =
    "android/app/build/reports/android-startup/latest";

  assert.match(
    startupJob,
    /- name: Upload Android startup evidence[\s\S]*?if: always\(\)[\s\S]*?uses: actions\/upload-artifact@v4/,
    "startup evidence upload must run even after a failed startup check",
  );
  assert.match(
    startupJob,
    new RegExp(`path: ${evidenceDirectory.replaceAll("/", "\\/")}`),
    "startup job must upload the startup evidence directory",
  );
  assert.match(
    startupJob,
    /--output "\$GITHUB_WORKSPACE\/android\/app\/build\/reports\/android-startup\/latest"/,
    "startup check output must match the uploaded evidence directory",
  );
  assert.match(
    startupJob,
    /path: android\/app\/build\/reports\/android-startup\/latest[\s\S]*?if-no-files-found: error/,
    "startup evidence upload must fail when its directory is missing",
  );
});