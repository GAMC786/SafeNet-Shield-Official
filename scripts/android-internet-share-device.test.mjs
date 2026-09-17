import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const instrumentation = readFileSync(
  new URL("../android/app/src/androidTest/java/com/safenet/dns/SafeNetVpnInstrumentationTest.java", import.meta.url),
  "utf8",
);
const deviceScript = readFileSync(new URL("./android-internet-share-device-test.sh", import.meta.url), "utf8");

test("Internet Share instrumentation covers permission, start, and stop cleanup", () => {
  assert.match(instrumentation, /internetShareStartsAndStopsCleanly/);
  assert.match(instrumentation, /NEARBY_WIFI_DEVICES/);
  assert.match(instrumentation, /INTERNET_SHARE_START result=PASS mode=/);
  assert.match(instrumentation, /INTERNET_SHARE_STOP result=PASS notification=REMOVED group=NULL/);
  assert.match(instrumentation, /hasInternetShareNotification/);
  assert.match(instrumentation, /waitForWifiDirectGroupCleared/);
});

test("physical Internet Share evidence is bound to the signed APK and device profile", () => {
  assert.match(deviceScript, /application_apk_sha256=/);
  assert.match(deviceScript, /device_profile=/);
  assert.match(deviceScript, /INTERNET_SHARE_START result=PASS/);
  assert.match(deviceScript, /INTERNET_SHARE_STOP result=PASS/);
  assert.match(deviceScript, /wifi_direct_group_cleanup=/);
  assert.match(deviceScript, /EMULATOR_TARGET|NO_PHYSICAL_DEVICE/);
  assert.match(deviceScript, /result=BLOCKED/);
});

test("workflow exposes a separate profiled physical Internet Share lane", () => {
  assert.match(workflow, /android_internet_share_physical_validation:/);
  assert.match(workflow, /android-internet-share-physical:/);
  assert.match(workflow, /android-internet-share-device-test\.sh/);
  assert.match(workflow, /SafeNet-DNS-Android-internet-share-physical-evidence/);
});

test("tagged releases publish bounded Internet Share verification evidence", () => {
  assert.match(workflow, /Resolve matching physical Internet Share evidence/);
  assert.match(workflow, /--event workflow_dispatch/);
  assert.match(workflow, /--commit "\$GITHUB_SHA"/);
  assert.match(workflow, /\.headBranch == \$ref/);
  assert.match(workflow, /SafeNet-DNS-Android-internet-share-verification\.txt/);
  assert.match(workflow, /INTERNET_SHARE_RUN_MISSING|INTERNET_SHARE_APK_EVIDENCE_MISMATCH/);
  assert.match(workflow, /Physical Internet Share validation.*does not prevent APK publication/);
  assert.match(workflow, /profile_.*start_result/);
  assert.match(workflow, /profile_.*cleanup_result/);
});