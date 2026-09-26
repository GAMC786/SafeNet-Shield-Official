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
const tailscaleBuildScript = await readFile(
  new URL("./build-tailscale-aar.sh", import.meta.url),
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
const androidVariablesSource = await readFile(
  new URL("../android/variables.gradle", import.meta.url),
  "utf8",
);
const tailscalePluginSource = await readFile(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetTailscalePlugin.java", import.meta.url),
  "utf8",
);
const tailscaleServiceSource = await readFile(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetTailscaleVpnService.java", import.meta.url),
  "utf8",
);
const tailscaleAppSource = await readFile(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetTailscaleApp.java", import.meta.url),
  "utf8",
);
const dashboardSource = await readFile(
  new URL("../client/src/pages/Dashboard.tsx", import.meta.url),
  "utf8",
);
const windscribeCardSource = await readFile(
  new URL("../client/src/components/WindscribeVpnCard.tsx", import.meta.url),
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

test("Tailscale AAR build enters the submodule before invoking Make", () => {
  assert.match(
    tailscaleBuildScript,
    /\(\s*cd "\$source_dir"\s*make libtailscale\s*\)/,
  );
  assert.doesNotMatch(tailscaleBuildScript, /make -C "\$source_dir"/);
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

test("the native plugin keeps Private DNS and shared features", () => {
  for (const method of [
    "getProtectionStatus",
    "getPrivateDnsStatus",
    "setPrivateDnsHostname",
    "openPrivateDnsSettings",
    "syncFirewallConfig",
    "getApkScanStatus",
    "getAiShieldStatus",
    "getCallScreeningStatus",
    "getTetherStatus",
  ]) {
    assert.match(pluginSource, new RegExp(`void ${method}\\(`));
  }
  assert.doesNotMatch(pluginSource, /SafeNetDnsVpnService/);
  assert.doesNotMatch(pluginSource, /SafeNetWireGuard|startWireGuard|stopWireGuard/);
  for (const method of ["getStatus", "connect", "disconnect", "setOptions", "openLoginUrl"]) {
    assert.match(tailscalePluginSource, new RegExp(`void ${method}\\(`));
  }
  assert.match(tailscalePluginSource, /\/localapi\/v0\/status/);
  assert.match(tailscalePluginSource, /\/localapi\/v0\/start/);
  assert.match(tailscalePluginSource, /\/localapi\/v0\/prefs/);
  assert.match(tailscalePluginSource, /ExitNodeID/);
  assert.match(tailscalePluginSource, /RouteAllSet/);
  assert.match(tailscalePluginSource, /CorpDNSSet/);
  assert.match(tailscalePluginSource, /ExitNodeAllowLANAccessSet/);
  assert.match(tailscalePluginSource, /ExitNodeIDSet/);
  assert.match(tailscaleAppSource, /WantRunningSet/);
  assert.match(tailscalePluginSource, /TAILSCALE_UNSUPPORTED/);
  assert.match(tailscalePluginSource, /SDK_INT < 26/);
  assert.match(tailscalePluginSource, /import androidx\.activity\.result\.ActivityResult/);
  assert.match(tailscalePluginSource, /Iterator<String> peerKeys = peers\.keys\(\)/);
  assert.match(tailscalePluginSource, /JSObject exit = new JSObject\(\)/);
  assert.doesNotMatch(tailscalePluginSource, /peers\.keySet\(\)/);
  assert.match(tailscaleServiceSource, /new IpPrefix\(InetAddress\.getByName\(s\), p\)/);
  assert.match(
    tailscaleAppSource,
    /network\.bindSocket\(descriptor\.getFileDescriptor\(\)\);\s*return true;/,
  );
});

test("the Android manifest declares the WireGuard backend VPN service", () => {
  assert.match(
    manifestSource,
    /android:name="com\.wireguard\.android\.backend\.GoBackend\$VpnService"/,
  );
  assert.match(manifestSource, /android\.permission\.BIND_VPN_SERVICE/);
  assert.match(manifestSource, /android\.permission\.FOREGROUND_SERVICE_SYSTEM_EXEMPTED/);
  assert.doesNotMatch(manifestSource, /overrideLibrary/);
  assert.match(androidVariablesSource, /minSdkVersion\s*=\s*26/);
  assert.doesNotMatch(manifestSource, /SafeNetTailscaleVpnService|SafeNetDnsVpnService/);
  assert.doesNotMatch(manifestSource, /SafeNetVpnTileService/);
});

test("Windscribe UI discloses local profile storage and manual-profile limits", () => {
  assert.match(dashboardSource, /WindscribeVpnCard/);
  assert.match(windscribeCardSource, /data-testid="button-import-windscribe-profile"/);
  assert.match(windscribeCardSource, /data-testid="switch-windscribe-vpn"/);
  assert.match(windscribeCardSource, /private key stay encrypted on this device/);
  assert.match(windscribeCardSource, /Windscribe paid plan/);
  assert.match(windscribeCardSource, /split tunneling/);
});

test("the signed smoke lane proves DNS, DDNS, Internet Share, and Private DNS package state", () => {
  assert.match(
    releaseSmokeSource,
    /SafeNetDnsDdnsInstrumentationTest/,
    "the signed smoke lane must run the resolver/DDNS/package instrumentation",
  );
  assert.match(resolverDdnsInstrumentationSource, /dnsResolverCreateEditAndActivateFlow/);
  assert.match(resolverDdnsInstrumentationSource, /ddnsManagementFlow/);
    assert.match(resolverDdnsInstrumentationSource, /signedPackageUsesPrivateDnsWithoutVpnSurface/);
  assert.match(
    resolverDdnsInstrumentationSource,
    /physicalDnsFilteringBlocksSelectedDomainAndAllowsAnother/,
  );
  assert.match(resolverDdnsInstrumentationSource, /PRIVATE_DNS_DEVICE result=PASS/);
  assert.match(releaseSmokeSource, /DNS_RESOLVER_UI result=PASS create=PASS edit=PASS activate=PASS/);
  assert.match(releaseSmokeSource, /DDNS_UI result=PASS create=PASS edit=PASS toggle=PASS delete=PASS/);
  assert.match(releaseSmokeSource, /PRIVATE_DNS_PACKAGE_SURFACE result=PASS vpn_service=ABSENT permission=ABSENT/);
  assert.match(releaseSmokeSource, /INTERNET_SHARE_START result=PASS/);
  assert.match(releaseSmokeSource, /INTERNET_SHARE_STOP result=PASS/);
  assert.match(releaseSmokeSource, /--dns-filtering-validation/);
  assert.match(releaseSmokeSource, /dns_filtering_status/);
  assert.match(releaseSmokeSource, /dns_filtering=%s/);
  assert.match(mainWorkflow, /DNS filtering device proof/);
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

test("APK-only signed builds publish and verify a version-matched formal release", () => {
  assert.match(apkOnlyWorkflow, /permissions:\n  contents: write/);
  assert.match(
    apkOnlyWorkflow,
    /Create or update formal GitHub Release[\s\S]*uses: softprops\/action-gh-release@v2/,
  );
  assert.match(
    apkOnlyWorkflow,
    /tag_name: \$\{\{ steps\.app_version\.outputs\.release_tag \}\}/,
  );
  assert.match(
    apkOnlyWorkflow,
    /SafeNet-Android-APK-\$\{RELEASE_TAG\}\.apk/,
  );
  assert.match(
    apkOnlyWorkflow,
    /Verify formal GitHub Release assets[\s\S]*gh api "repos\/\$GITHUB_REPOSITORY\/releases\/tags\/\$RELEASE_TAG"/,
  );
  assert.match(
    apkOnlyWorkflow,
    /sha256sum --check "\$CHECKSUM_ASSET"/,
  );
  assert.match(
    apkOnlyWorkflow,
    /versionCode='\$ANDROID_VERSION_CODE' versionName='\$ANDROID_VERSION_NAME'/,
  );
  assert.match(
    apkOnlyWorkflow,
    /Formal GitHub Release:\*\*.*\$release_publish_outcome/,
  );
});
