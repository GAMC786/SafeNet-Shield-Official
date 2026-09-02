import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const workflow = readFileSync(
  path.resolve(process.cwd(), ".github/workflows/build.yml"),
  "utf8",
).replace(/\r\n/g, "\n");
const smokeScript = readFileSync(
  path.resolve(process.cwd(), "scripts/android-smoke-test.sh"),
  "utf8",
);
const runnerScript = readFileSync(
  path.resolve(process.cwd(), "scripts/provision-android-runner.sh"),
  "utf8",
);

function getStepBlock(stepName: string) {
  const stepStart = workflow.indexOf(`      - name: ${stepName}`);
  assert.notEqual(stepStart, -1, `Workflow step not found: ${stepName}`);

  const nextStep = workflow.indexOf("\n      - name:", stepStart + 1);
  return workflow.slice(stepStart, nextStep === -1 ? undefined : nextStep);
}

test("non-tag fixture validation preflights system trust before Android builds", () => {
  const preflightStart = workflow.indexOf(
    "      - name: Preflight Android emulator system trust",
  );
  const buildStart = workflow.indexOf(
    "      - name: Build and sync mobile web assets",
  );

  assert.ok(preflightStart >= 0);
  assert.ok(buildStart > preflightStart);

  const preflightStep = getStepBlock("Preflight Android emulator system trust");
  assert.match(preflightStep, /ANDROID_SMOKE_RESOLVER_MODE == 'fixture'/);
  assert.match(preflightStep, /android-smoke-test\.sh --preflight/);
  assert.match(preflightStep, /android-smoke\/latest\/preflight/);
});

test("system trust preflight records strict write and cleanup checks", () => {
  assert.match(smokeScript, /--preflight\s+Probe Android system trust capabilities/);
  assert.match(smokeScript, /adb .* root/);
  assert.match(smokeScript, /adb .* remount/);
  assert.match(smokeScript, /adb .* push .*preflight_ca/);
  assert.match(smokeScript, /adb .* shell rm -f "\$preflight_remote_ca"/);
  assert.match(smokeScript, /temporary preflight CA remained/);
  assert.match(smokeScript, /failure_category=FIXTURE_FAILURE/);
  assert.match(smokeScript, /preflight-result\.txt/);
});

test("tagged releases require the dedicated writable Android runner", () => {
  assert.match(
    workflow,
    /android-release-smoke:\n\s+needs: build-android\n\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)/,
  );
  assert.match(
    workflow,
    /runs-on: \[self-hosted, linux, x64, android-writable-system\]/,
  );
  assert.match(workflow, /target: aosp_atd/);
  assert.match(
    workflow,
    /--apk "\$GITHUB_WORKSPACE\/artifacts\/android\/app-release\.apk"/,
  );
  assert.match(
    workflow,
    /--test-apk "\$GITHUB_WORKSPACE\/artifacts\/android-test\/app-release-androidTest\.apk"/,
  );
  assert.match(workflow, /needs: \[build-android, build-windows, android-release-smoke\]/);
  assert.match(runnerScript, /system-images;android-\$\{api_level\};aosp_atd;x86_64/);
  assert.match(runnerScript, /build-tools;\$build_tools_version/);
  assert.match(runnerScript, /\/dev\/kvm/);
});