import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const installFailureParserPath = new URL(
  "./android-install-failure-parser.sh",
  import.meta.url,
);
const installFailureParser = await readFile(installFailureParserPath, "utf8");
const resolverDdnsInstrumentationSource = await readFile(
  new URL(
    "../android/app/src/androidTest/java/com/safenet/dns/SafeNetDnsDdnsInstrumentationTest.java",
    import.meta.url,
  ),
  "utf8",
);

test("Android native check is executable and supports bounded debug and release instrumentation builds", async () => {
  const scriptStats = await stat(
    new URL("./check-android-native-build.sh", import.meta.url),
  );
  assert.ok((scriptStats.mode & 0o111) !== 0);
  assert.match(nativeBuildScript, /ANDROID_SDK_ROOT/);
  assert.match(nativeBuildScript, /local\.properties/);
  assert.match(nativeBuildScript, /assembleDebug --rerun-tasks/);
  assert.match(nativeBuildScript, /:app:assembleReleaseAndroidTest/);
  assert.match(nativeBuildScript, /--release-instrumentation/);
  assert.match(nativeBuildScript, /max_diagnostics_bytes=16000/);
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
  const releaseCompileIndex = mainWorkflow.indexOf(
    "Compile release instrumentation target before signing",
  );
  const releasePackageIndex = mainWorkflow.indexOf(
    "Build release instrumentation APK",
    releaseCompileIndex,
  );
  assert.notEqual(releaseCompileIndex, -1, "main Android workflow is missing release instrumentation preflight");
  assert.notEqual(releasePackageIndex, -1, "main Android workflow is missing signed instrumentation packaging");
  assert.ok(releaseCompileIndex < releasePackageIndex);
});

test("hosted Android SDK setup publishes bounded infrastructure evidence", () => {
  assert.match(sdkSetupScript, /ANDROID_SDK_SETUP_OUTPUT_DIR/);
  assert.match(sdkSetupScript, /ANDROID_SDK_SETUP_FAILURE/);
  assert.match(mainWorkflow, /tail -c 16000 "\$RUNNER_TEMP\/android-sdk-setup\.log"/);
  assert.match(mainWorkflow, /name: Upload Android SDK setup evidence/);
});

test("the native plugin keeps DNS filtering and shared features", () => {
  for (const method of [
    "getProtectionStatus",
    "getDnsProtectionStatus",
    "startDnsProtection",
    "stopDnsProtection",
    "syncFirewallConfig",
    "getApkScanStatus",
    "getAiShieldStatus",
    "getCallScreeningStatus",
    "getTetherStatus",
  ]) {
    assert.match(pluginSource, new RegExp(`void ${method}\\(`));
  }
  assert.match(pluginSource, /SafeNetDnsVpnService/);
  assert.doesNotMatch(pluginSource, /SafeNetWireGuard|startWireGuard|stopWireGuard/);
});

test("the Android manifest has the DNS-only VPN service and permission", () => {
  assert.match(manifestSource, /android\.net\.VpnService/);
  assert.match(manifestSource, /android\.permission\.BIND_VPN_SERVICE/);
  assert.match(manifestSource, /SafeNetDnsVpnService/);
  assert.doesNotMatch(manifestSource, /SafeNetVpnTileService|SafeNetWireGuard/);
});

test("the signed smoke lane proves DNS, DDNS, Internet Share, and DNS-VPN package state", () => {
  assert.match(
    releaseSmokeSource,
    /SafeNetDnsDdnsInstrumentationTest/,
    "the signed smoke lane must run the resolver/DDNS/package instrumentation",
  );
  assert.match(resolverDdnsInstrumentationSource, /dnsResolverCreateEditAndActivateFlow/);
  assert.match(resolverDdnsInstrumentationSource, /ddnsManagementFlow/);
  assert.match(resolverDdnsInstrumentationSource, /signedPackageContainsDnsFilteringVpnOnly/);
  assert.match(releaseSmokeSource, /DNS_RESOLVER_UI result=PASS create=PASS edit=PASS activate=PASS/);
  assert.match(releaseSmokeSource, /DDNS_UI result=PASS create=PASS edit=PASS toggle=PASS delete=PASS/);
  assert.match(releaseSmokeSource, /DNS_VPN_PACKAGE_SURFACE result=PASS service=PRESENT permission=PRESENT/);
  assert.match(releaseSmokeSource, /INTERNET_SHARE_START result=PASS/);
  assert.match(releaseSmokeSource, /INTERNET_SHARE_STOP result=PASS/);
});

test("signed APK install failures preserve sanitized package-manager evidence", () => {
  const fixture =
    "adb: failed to install /home/runner/work/safe-net/android/app-release.apk: " +
    "Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE: token=do-not-publish]";
  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        "source \"$1\"",
        "printf 'category=%s\\n' \"$(classify_android_install_failure \"$2\" 1)\"",
        "printf 'outcome=%s\\n' \"$(sanitize_android_install_outcome \"$2\")\"",
      ].join("\n"),
      "android-install-failure-test",
      installFailureParserPath.pathname,
      fixture,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^category=INSTALL_FAILED_INSUFFICIENT_STORAGE$/m);
  assert.match(result.stdout, /Failure \[INSTALL_FAILED_INSUFFICIENT_STORAGE:/);
  assert.doesNotMatch(result.stdout, /\/home\/runner\/work/);
  assert.doesNotMatch(result.stdout, /do-not-publish/);
  assert.doesNotMatch(result.stdout, /logcat/);
  assert.match(releaseSmokeSource, /failure_category=ANDROID_INSTALL_FAILURE/);
  assert.match(releaseSmokeSource, /instrumentation_apk_attempted=/);
  assert.match(releaseSmokeSource, /install-device-diagnostics\.txt/);
  assert.match(mainWorkflow, /ANDROID_INSTALL_FAILURE/);
  assert.match(installFailureParser, /4096/);
  assert.match(mainWorkflow, /install_failure_category=/);
  assert.match(mainWorkflow, /install-device-diagnostics\.txt/);
  assert.match(mainWorkflow, /Android install diagnostics:/);
});

test("release summaries expose native compile outcomes", () => {
  assert.match(mainWorkflow, /android_native_compile_outcome:/);
  assert.match(mainWorkflow, /android_native_instrumentation_compile_outcome:/);
  assert.match(mainWorkflow, /Native Android compile:/);
  assert.match(mainWorkflow, /Native release instrumentation compile:/);
  assert.match(apkOnlyWorkflow, /NATIVE_COMPILE_OUTCOME:/);
  assert.match(apkOnlyWorkflow, /Native Android compile:/);
});
