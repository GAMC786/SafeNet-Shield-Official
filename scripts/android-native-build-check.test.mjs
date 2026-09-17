import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const nativeBuildScript = await readFile(
  new URL("./check-android-native-build.sh", import.meta.url),
  "utf8",
);
const sdkSetupScript = await readFile(
  new URL("./setup-android-sdk.sh", import.meta.url),
  "utf8",
);
const mainWorkflow = await readFile(
  new URL("../.github/workflows/build.yml", import.meta.url),
  "utf8",
);
const apkOnlyWorkflow = await readFile(
  new URL("../.github/workflows/build-apk-only.yml", import.meta.url),
  "utf8",
);
const pluginSource = await readFile(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetVpnPlugin.java", import.meta.url),
  "utf8",
);
const manifestSource = await readFile(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
const releaseSmokeSource = await readFile(
  new URL("./android-smoke-test.sh", import.meta.url),
  "utf8",
);
const resolverDdnsInstrumentationSource = await readFile(
  new URL(
    "../android/app/src/androidTest/java/com/safenet/dns/SafeNetDnsDdnsInstrumentationTest.java",
    import.meta.url,
  ),
  "utf8",
);

test("Android native check is executable and forces the debug Java build", async () => {
  const scriptStats = await stat(
    new URL("./check-android-native-build.sh", import.meta.url),
  );
  assert.ok((scriptStats.mode & 0o111) !== 0);
  assert.match(nativeBuildScript, /ANDROID_SDK_ROOT/);
  assert.match(nativeBuildScript, /local\.properties/);
  assert.match(nativeBuildScript, /assembleDebug --rerun-tasks/);
});

test("release-capable workflows compile native sources before packaging", () => {
  for (const [name, workflow] of [
    ["main Android workflow", mainWorkflow],
    ["APK-only workflow", apkOnlyWorkflow],
  ]) {
    const setupIndex = workflow.indexOf(
      "Install and verify Android toolchain from Gradle pins",
    );
    const compileIndex = workflow.indexOf(
      "Compile Android native sources before APK packaging",
    );
    const packageIndex = workflow.indexOf(
      "Build signed release APK",
      compileIndex,
    );
    assert.notEqual(setupIndex, -1, `${name} is missing pinned SDK setup`);
    assert.notEqual(compileIndex, -1, `${name} is missing native compile gate`);
    assert.notEqual(packageIndex, -1, `${name} is missing release packaging`);
    assert.ok(setupIndex < compileIndex && compileIndex < packageIndex);
  }
});

test("hosted Android SDK setup publishes bounded infrastructure evidence", () => {
  assert.match(sdkSetupScript, /ANDROID_SDK_SETUP_OUTPUT_DIR/);
  assert.match(sdkSetupScript, /ANDROID_SDK_SETUP_FAILURE/);
  assert.match(mainWorkflow, /tail -c 16000 "\$RUNNER_TEMP\/android-sdk-setup\.log"/);
  assert.match(mainWorkflow, /name: Upload Android SDK setup evidence/);
});

test("the native plugin keeps shared non-VPN features", () => {
  for (const method of [
    "getProtectionStatus",
    "syncFirewallConfig",
    "getApkScanStatus",
    "getAiShieldStatus",
    "getCallScreeningStatus",
    "getTetherStatus",
  ]) {
    assert.match(pluginSource, new RegExp(`void ${method}\\(`));
  }
  assert.doesNotMatch(pluginSource, /SafeNetVpnService|SafeNetWireGuard|startWireGuard|stopWireGuard/);
});

test("the Android manifest has no VPN service or VPN permission", () => {
  assert.doesNotMatch(manifestSource, /android\.net\.VpnService|BIND_VPN_SERVICE|SafeNetVpnService|SafeNetVpnTileService/);
});

test("the signed smoke lane proves DNS, DDNS, Internet Share, and no-VPN package state", () => {
  assert.match(
    releaseSmokeSource,
    /SafeNetDnsDdnsInstrumentationTest/,
    "the signed smoke lane must run the resolver/DDNS/package instrumentation",
  );
  assert.match(resolverDdnsInstrumentationSource, /dnsResolverCreateEditAndActivateFlow/);
  assert.match(resolverDdnsInstrumentationSource, /ddnsManagementFlow/);
  assert.match(resolverDdnsInstrumentationSource, /signedPackageRequestsNoVpnServiceOrPermission/);
  assert.match(releaseSmokeSource, /DNS_RESOLVER_UI result=PASS create=PASS edit=PASS activate=PASS/);
  assert.match(releaseSmokeSource, /DDNS_UI result=PASS create=PASS edit=PASS toggle=PASS delete=PASS/);
  assert.match(releaseSmokeSource, /VPN_PACKAGE_SURFACE result=PASS service=ABSENT permission=ABSENT/);
  assert.match(releaseSmokeSource, /INTERNET_SHARE_START result=PASS/);
  assert.match(releaseSmokeSource, /INTERNET_SHARE_STOP result=PASS/);
});