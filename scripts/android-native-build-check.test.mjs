import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const nativeBuildScript = await readFile(
  new URL("./check-android-native-build.sh", import.meta.url),
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
const serviceSource = await readFile(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetVpnService.java", import.meta.url),
  "utf8",
);
const tileSource = await readFile(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetVpnTileService.java", import.meta.url),
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
    assert.ok(
      setupIndex < compileIndex && compileIndex < packageIndex,
      `${name} must set up the SDK, compile native sources, then package`,
    );
  }
});

test("resolver address family is forwarded into the native service", () => {
  assert.match(pluginSource, /EXTRA_IP_VERSION/);
  assert.match(serviceSource, /intent\.getStringExtra\(EXTRA_IP_VERSION\)/);
  assert.match(serviceSource, /private final String ipVersion/);
  assert.match(serviceSource, /resolveHost\(address, ipVersion\)/);
  assert.match(serviceSource, /resolveHost\(endpoint\.host, ipVersion\)/);
  assert.match(serviceSource, /resolveHost\(uri\.getHost\(\), ipVersion\)/);
});

test("AI Shield native sources use the pinned Android and TensorFlow Lite APIs", async () => {
  const managerSource = await readFile(
    new URL("../android/app/src/main/java/com/safenet/dns/AiShieldManager.java", import.meta.url),
    "utf8",
  );
  const classifierSource = await readFile(
    new URL("../android/app/src/main/java/com/safenet/dns/AiShieldClassifier.java", import.meta.url),
    "utf8",
  );

  assert.match(managerSource, /manager\.openCamera\(cameraId,\s*createCameraStateCallback/);
  assert.doesNotMatch(managerSource, /manager\.openCamera\(createCameraStateCallback/);
  assert.match(classifierSource, /input\.dataType\(\)/);
  assert.match(classifierSource, /output\.dataType\(\)/);
  assert.doesNotMatch(classifierSource, /(?:input|output)\.type\(\)/);
});

test("the Quick Settings WireGuard tile forwards its selected DNS servers", () => {
  assert.match(tileSource, /PREF_WIREGUARD_DNS_SERVERS/);
  assert.match(
    tileSource,
    /startAsync\(\s*selectedDnsServers,\s*this::postUpdateTile/s,
  );
});