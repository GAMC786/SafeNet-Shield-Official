import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const instrumentation = readFileSync(
  new URL("../android/app/src/androidTest/java/com/safenet/dns/SafeNetInternetShareInstrumentationTest.java", import.meta.url),
  "utf8",
);
const tetherManager = readFileSync(
  new URL("../android/app/src/main/java/com/safenet/dns/TetherShareManager.java", import.meta.url),
  "utf8",
);
const tetherProxy = readFileSync(
  new URL("../android/app/src/main/java/com/safenet/dns/TetherShareProxy.java", import.meta.url),
  "utf8",
);
const plugin = readFileSync(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetVpnPlugin.java", import.meta.url),
  "utf8",
);
const manifest = readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
const tetherHook = readFileSync(
  new URL("../client/src/hooks/use-tether-share.ts", import.meta.url),
  "utf8",
);
const deviceScript = readFileSync(new URL("./android-internet-share-device-test.sh", import.meta.url), "utf8");

test("Internet Share instrumentation covers permission, start, and stop cleanup", () => {
  assert.match(instrumentation, /internetShareStartsAndStopsCleanly/);
  assert.match(instrumentation, /internetShareClientUsesAdvertisedProxy/);
  assert.match(instrumentation, /NEARBY_WIFI_DEVICES/);
  assert.match(instrumentation, /INTERNET_SHARE_START result=PASS mode=/);
  assert.match(instrumentation, /INTERNET_SHARE_READY result=PASS proxy=ADVERTISED/);
  assert.match(instrumentation, /INTERNET_SHARE_CLIENT_PROXY_CONFIG result=PASS/);
  assert.match(instrumentation, /INTERNET_SHARE_STOP result=PASS/);
  assert.match(instrumentation, /getTetherStatus/);
});

test("the APK declares the normal Wi-Fi Direct permissions", () => {
  assert.match(manifest, /android\.permission\.ACCESS_WIFI_STATE/);
  assert.match(manifest, /android\.permission\.CHANGE_WIFI_STATE/);
  assert.match(manifest, /android\.permission\.NEARBY_WIFI_DEVICES/);
});

test("permission recovery retries a pending share start after Android Settings", () => {
  assert.match(plugin, /permissionGranted/);
  assert.match(plugin, /Allow Nearby devices in Android app settings/);
  assert.match(tetherHook, /pendingStartRef/);
  assert.match(tetherHook, /document\.addEventListener\("visibilitychange"/);
  assert.match(tetherHook, /nextStatus\?\.permissionGranted === true/);
  assert.match(tetherHook, /await start\(\)\.catch\(\(\) => null\)/);
});

test("physical Internet Share evidence is bound to the signed APK and device profile", () => {
  assert.match(deviceScript, /application_apk_sha256=/);
  assert.match(deviceScript, /instrumentation_apk_sha256=/);
  assert.match(deviceScript, /device_profile=/);
  assert.match(deviceScript, /INTERNET_SHARE_START result=PASS/);
  assert.match(deviceScript, /INTERNET_SHARE_STOP result=PASS/);
  assert.match(deviceScript, /wifi_direct_group_cleanup=/);
  assert.match(deviceScript, /client_connection=/);
  assert.match(deviceScript, /credential_handoff=/);
  assert.match(deviceScript, /APP_HANDOFF/);
  assert.match(deviceScript, /redact_credentials/);
  assert.match(deviceScript, /proxy_configuration=/);
  assert.match(deviceScript, /proxy_response=/);
  assert.match(deviceScript, /proxy_https_response=/);
  assert.match(deviceScript, /proxy_http_diagnostic=/);
  assert.match(deviceScript, /client_proxy_cleanup=/);
  assert.match(deviceScript, /client_wifi_cleanup=/);
  assert.match(deviceScript, /--client-serial/);
  assert.match(deviceScript, /EMULATOR_TARGET|NO_PHYSICAL_DEVICE/);
  assert.match(deviceScript, /result=BLOCKED/);
});

test("workflow exposes a separate profiled physical Internet Share lane", () => {
  assert.match(workflow, /android_internet_share_physical_validation:/);
  assert.match(workflow, /android-internet-share-physical:/);
  assert.match(workflow, /android-internet-share-device-test\.sh/);
  assert.match(workflow, /android_internet_share_client_serials:/);
  assert.match(workflow, /\.\[\$profile\]/);
  assert.match(workflow, /ANDROID_INTERNET_SHARE_CLIENT_SERIALS_INPUT/);
  assert.match(workflow, /ANDROID_INTERNET_SHARE_DEVICE_PROFILE/);
  assert.match(workflow, /SafeNet-DNS-Android-internet-share-physical-evidence/);
});

test("tagged releases publish bounded Internet Share verification evidence", () => {
  assert.match(workflow, /Resolve matching physical Internet Share evidence/);
  assert.match(workflow, /--event workflow_dispatch/);
  assert.match(workflow, /--commit "\$GITHUB_SHA"/);
  assert.match(workflow, /\.headBranch == \$ref/);
  assert.match(workflow, /SafeNet-DNS-Android-internet-share-verification\.txt/);
  assert.match(workflow, /INTERNET_SHARE_RUN_MISSING|INTERNET_SHARE_APK_EVIDENCE_MISMATCH/);
  assert.match(workflow, /INTERNET_SHARE_INSTRUMENTATION_APK_EVIDENCE_MISMATCH/);
  assert.match(workflow, /failure_class/);
  assert.match(workflow, /DEVICE_ACCESS/);
  assert.match(workflow, /Physical Internet Share validation.*does not prevent APK publication/);
  assert.match(workflow, /profile_.*start_result/);
  assert.match(workflow, /profile_.*client_connection/);
  assert.match(workflow, /profile_.*proxy_response/);
  assert.match(workflow, /profile_.*proxy_https_response/);
  assert.match(workflow, /profile_.*proxy_http_diagnostic/);
  assert.match(workflow, /profile_.*cleanup_result/);
});

test("proxy evidence does not persist the client network secret or request contents", () => {
  assert.doesNotMatch(instrumentation, /passphrase64/);
  assert.doesNotMatch(instrumentation, /Log\.[iewd].*passphrase/);
  assert.doesNotMatch(deviceScript, /printf .*passphrase/);
  assert.doesNotMatch(deviceScript, /printf .*passphrase64/);
  const clientMethod = instrumentation.match(
    /public void internetShareClientUsesAdvertisedProxy\(\)[\s\S]*?\n    \}\n\n    private JSONObject waitForStarted/,
  )?.[0] ?? "";
  assert.notEqual(clientMethod, "");
  assert.doesNotMatch(clientMethod, /getInputStream\(\)/);
  assert.doesNotMatch(clientMethod, /Log\.[iewd].*proxyUrl/);
});

test("the Internet Share proxy emits real HTTP line endings", () => {
  assert.match(tetherProxy, /Connection: close\\r\\n\\r\\n/);
  assert.doesNotMatch(tetherProxy, /Connection: close\\\\r\\\\n\\\\r\\\\n/);
  assert.match(tetherProxy, /200 Connection Established\\r\\n/);
});