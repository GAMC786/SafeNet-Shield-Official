import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scriptPath = new URL("./verify-android-release-assets.sh", import.meta.url);

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function createReleaseFixture() {
  const root = mkdtempSync(join(tmpdir(), "android-release-assets-"));
  const assets = join(root, "assets");
  const sdk = join(root, "sdk");
  const tools = join(sdk, "build-tools", "36.0.0");
  const evidence = join(root, "evidence");
  mkdirSync(assets, { recursive: true });
  mkdirSync(tools, { recursive: true });
  mkdirSync(join(evidence, "nested"), { recursive: true });

  writeExecutable(
    join(tools, "apksigner"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  writeExecutable(
    join(tools, "aapt"),
    `#!/usr/bin/env bash
if [[ "$3" == *"androidTest"* ]]; then
  echo "package: name='com.safenet.dns.test' versionCode='1' versionName='1'"
else
  echo "package: name='com.safenet.dns' versionCode='58' versionName='1.0.66'"
fi
`,
  );

  const apk = join(assets, "app-release.apk");
  const testApk = join(assets, "app-release-androidTest.apk");
  const publicAsset = join(root, "apk-content/assets/public/index.html");
  mkdirSync(join(root, "apk-content/assets/public"), { recursive: true });
  writeFileSync(publicAsset, "web bundle");
  writeFileSync(testApk, "instrumentation apk");
  const zipResult = spawnSync("zip", ["-q", apk, "assets/public/index.html"], {
    cwd: join(root, "apk-content"),
    encoding: "utf8",
  });
  assert.equal(zipResult.status, 0, zipResult.stderr);

  const smokeResult = [
    "target=emulator-5554",
    "validation_mode=hosted-emulator-reduced",
    "failure_category=PASS",
    "",
  ].join("\n");
  writeFileSync(join(evidence, "android-smoke-result.txt"), smokeResult);
  writeFileSync(join(evidence, "result.txt"), smokeResult);
  writeFileSync(
    join(evidence, "release-record.txt"),
    "validation_mode=hosted-emulator-reduced\nfailure_category=PASS\nsmoke_step_outcome=success\n",
  );
  writeFileSync(join(evidence, "nested", "diagnostic.txt"), "bounded evidence");
  const archive = join(assets, "SafeNet-DNS-Android-smoke-evidence.tar.gz");
  const tarResult = spawnSync(
    "tar",
    ["-czf", archive, "-C", evidence, "."],
    { encoding: "utf8" },
  );
  assert.equal(tarResult.status, 0, tarResult.stderr);
  cpSync(join(evidence, "android-smoke-result.txt"), join(assets, "SafeNet-DNS-Android-smoke-result.txt"));

  for (const file of [apk, testApk]) {
    const checksumName = `${file}.sha256`;
    const name = file.endsWith("androidTest.apk")
      ? "app-release-androidTest.apk"
      : "app-release.apk";
    const digest = spawnSync("sha256sum", [file], { encoding: "utf8" }).stdout.split(/\s+/)[0];
    writeFileSync(checksumName, `${digest}  ${name}\n`);
  }
  const smokeChecksum = [
    "SafeNet-DNS-Android-smoke-evidence.tar.gz",
    "SafeNet-DNS-Android-smoke-result.txt",
  ].map((name) => {
    const digest = spawnSync("sha256sum", [join(assets, name)], { encoding: "utf8" }).stdout.split(/\s+/)[0];
    return `${digest}  ${name}`;
  });
  writeFileSync(
    join(assets, "SafeNet-DNS-Android-smoke-evidence.sha256"),
    `${smokeChecksum.join("\n")}\n`,
  );

  return { root, assets, sdk };
}

function runVerifier(fixture, summaryPath) {
  return spawnSync(
    "bash",
    [
      scriptPath.pathname,
      "--assets-dir",
      fixture.assets,
      "--expected-version",
      "1.0.66",
      "--expected-version-code",
      "58",
      "--sdk-root",
      fixture.sdk,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
    },
  );
}

test("verifies published APK, checksum, metadata, and smoke evidence contracts", () => {
  const fixture = createReleaseFixture();
  const summaryPath = join(fixture.root, "summary.md");
  const result = runVerifier(fixture, summaryPath);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Verified published Android release assets/);
  assert.match(readFileSync(summaryPath, "utf8"), /- \*\*Status:\*\* passed/);
});

test("fails clearly when a published APK no longer matches its checksum", () => {
  const fixture = createReleaseFixture();
  writeFileSync(join(fixture.assets, "app-release.apk"), "corrupted release asset");
  const summaryPath = join(fixture.root, "summary.md");
  const result = runVerifier(fixture, summaryPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Checksum verification failed for app-release\.apk\.sha256/);
  assert.match(readFileSync(summaryPath, "utf8"), /- \*\*Status:\*\* failed/);
});