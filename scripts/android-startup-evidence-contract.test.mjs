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
  assert.match(
    startupCheck,
    /web_loader=RECORDED\\nwebview_transition=PASS\\nresult=PASS\\n/,
    "startup check must record the successful loader handoff markers",
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
});