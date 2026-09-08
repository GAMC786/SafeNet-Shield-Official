import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scriptPath = new URL("./resolve-android-release-metadata.sh", import.meta.url);
const repositoryRoot = new URL("..", import.meta.url);

function createFixture(buildGradle) {
  const directory = mkdtempSync(join(tmpdir(), "android-release-metadata-"));
  mkdirSync(join(directory, "android", "app"), { recursive: true });
  writeFileSync(join(directory, "android", "app", "build.gradle"), buildGradle);
  return directory;
}

function runResolver(directory, args = []) {
  return spawnSync("bash", [scriptPath.pathname, ...args], {
    cwd: directory,
    encoding: "utf8",
  });
}

test("resolves the shared metadata contract and writes GitHub outputs", () => {
  const directory = createFixture(`
    defaultConfig {
        versionCode 52
        versionName "1.0.60"
    }
  `);
  const outputFile = join(directory, "github-output");

  const result = runResolver(directory, [
    "--expected-version",
    "1.0.60",
    "--expected-label",
    "package.json",
    "--mismatch-prefix",
    "App version mismatch",
    "--output",
    outputFile,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(outputFile, "utf8"),
    "version_name=1.0.60\nversion_code=52\nversion=1.0.60\n",
  );
});

test("uses one error when Gradle metadata is incomplete", () => {
  const directory = createFixture('versionName "1.0.60"\n');
  const result = runResolver(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Could not resolve versionName and versionCode from android\/app\/build\.gradle\./,
  );
});

test("uses the caller's context for version mismatch errors", () => {
  const directory = createFixture(`
    versionCode 52
    versionName "1.0.60"
  `);
  const result = runResolver(directory, [
    "--expected-version",
    "1.0.61",
    "--expected-label",
    "tag",
    "--mismatch-prefix",
    "Release version mismatch",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Release version mismatch: tag=1\.0\.61, android\/app\/build\.gradle=1\.0\.60/,
  );
});

test("both release workflows consume the shared metadata contract", async () => {
  const { readFile } = await import("node:fs/promises");
  const [buildGradle, apkOnlyWorkflow, releaseWorkflow] = await Promise.all([
    readFile(new URL("android/app/build.gradle", repositoryRoot), "utf8"),
    readFile(
      new URL(".github/workflows/build-apk-only.yml", repositoryRoot),
      "utf8",
    ),
    readFile(new URL(".github/workflows/build.yml", repositoryRoot), "utf8"),
  ]);

  const versionCode = buildGradle.match(
    /^\s*versionCode\s+([0-9]+)\s*$/m,
  )?.[1];
  const versionName = buildGradle.match(
    /^\s*versionName\s+"([^"]+)"\s*$/m,
  )?.[1];
  assert.ok(versionCode, "android/app/build.gradle must define versionCode");
  assert.ok(versionName, "android/app/build.gradle must define versionName");

  const validators = [
    {
      name: "APK-only workflow",
      workflow: apkOnlyWorkflow,
      block: apkOnlyWorkflow.match(
        /      - name: Verify APK and manual PIN bundle\n(?<block>[\s\S]*?)(?=\n      - name:)/,
      )?.groups?.block,
      summaryBlock: apkOnlyWorkflow.match(
        /      - name: Publish Android APK summary\n(?<block>[\s\S]*?)(?=\n      - name:|$)/,
      )?.groups?.block,
      versionNameVariable: "APP_VERSION",
      versionCodeVariable: "APP_VERSION_CODE",
      pinCheck: /grep -R -q "Secure Access Required" android\/app\/src\/main\/assets\/public/,
      instrumentationPackage: null,
      instrumentationSummaryRow:
        /\*\*Instrumentation APK verification:\*\*.*not run in APK-only workflow/,
      apkArtifactSource:
        /APK_ARTIFACT_URL:\s+\$\{\{\s*steps\.upload-apk-only\.outputs\.artifact-url\s+\|\|\s+format\('\{0\}\/\{1\}\/actions\/runs\/\{2\}#artifacts',\s*github\.server_url,\s*github\.repository,\s*github\.run_id\)\s*\}\}/,
    },
    {
      name: "tagged release workflow",
      workflow: releaseWorkflow,
      block: releaseWorkflow.match(
        /      - name: Verify Android release APKs\n(?<block>[\s\S]*?)(?=\n      - name:)/,
      )?.groups?.block,
      summaryBlock: releaseWorkflow.match(
        /      - name: Publish Android release summary\n(?<block>[\s\S]*?)(?=\n      - name:|$)/,
      )?.groups?.block,
      versionNameVariable: "ANDROID_VERSION_NAME",
      versionCodeVariable: "ANDROID_VERSION_CODE",
      pinCheck: /unzip -l "\$apk" \| grep -F "assets\/public\/"/,
      instrumentationPackage: /package: name='com\.safenet\.dns\.test'/,
      instrumentationSummaryRow:
        /\*\*Signed instrumentation APK verification:\*\*.*\$instrumentation_outcome.*preserved instrumentation artifact.*\$instrumentation_url/,
      apkArtifactSource:
        /APK_ARTIFACT_URL:\s+\$\{\{\s*needs\.build-android\.outputs\.android_apk_artifact_url\s+\|\|\s+format\('\{0\}\/\{1\}\/actions\/runs\/\{2\}#artifacts',\s*github\.server_url,\s*github\.repository,\s*github\.run_id\)\s*\}\}/,
    },
  ];

  for (const validator of validators) {
    assert.ok(validator.block, `${validator.name} verifier block is missing`);
    const block = validator.block;
    assert.ok(
      validator.summaryBlock,
      `${validator.name} summary block is missing`,
    );
    const summaryBlock = validator.summaryBlock;

    assert.match(
      validator.workflow,
      /bash scripts\/resolve-android-release-metadata\.sh/,
      `${validator.name} must resolve metadata with the shared Gradle resolver`,
    );
    assert.match(
      validator.workflow,
      new RegExp(
        String.raw`steps\.[^.]+\.outputs\.(?:version|version_name)\b`,
      ),
      `${validator.name} must consume resolver outputs`,
    );
    assert.doesNotMatch(
      block,
      /versionCode='[0-9]+'/,
      `${validator.name} must not hardcode an APK versionCode`,
    );
    assert.doesNotMatch(
      block,
      /versionName='[0-9]+\.[0-9]+\.[0-9]+'/,
      `${validator.name} must not hardcode an APK versionName`,
    );
    assert.match(
      block,
      /apksigner.*verify --verbose "\$apk"/,
      `${validator.name} must verify the signed application APK`,
    );
    assert.match(
      block,
      new RegExp(
        String.raw`package: name='com\.safenet\.dns' versionCode='\$${validator.versionCodeVariable}' versionName='\$${validator.versionNameVariable}'`,
      ),
      `${validator.name} must verify app package, versionCode, and versionName`,
    );
    assert.match(
      block,
      validator.pinCheck,
      `${validator.name} must verify bundled PIN UI assets`,
    );
    if (validator.instrumentationPackage) {
      assert.match(
        block,
        validator.instrumentationPackage,
        `${validator.name} must verify the instrumentation package`,
      );
    }

    assert.match(
      summaryBlock,
      /Resolved versionName:\*\*.*\$version_name/,
      `${validator.name} summary must include the resolved versionName`,
    );
    assert.match(
      summaryBlock,
      /Resolved versionCode:\*\*.*\$version_code/,
      `${validator.name} summary must include the resolved versionCode`,
    );
    assert.match(
      summaryBlock,
      /Expected application package:\*\*.*com\.safenet\.dns/,
      `${validator.name} summary must include the expected application package`,
    );
    assert.match(
      summaryBlock,
      /\*\*Signed application APK verification:\*\*.*\$apk_outcome.*preserved APK artifact.*\$apk_url/,
      `${validator.name} summary must preserve the signed APK verification row and artifact link`,
    );
    assert.match(
      summaryBlock,
      validator.instrumentationSummaryRow,
      `${validator.name} summary must preserve the instrumentation verification row`,
    );
    assert.match(
      summaryBlock,
      validator.apkArtifactSource,
      `${validator.name} summary must source the APK link from an upload-artifact output or run-artifact fallback`,
    );
  }

  for (const workflow of [apkOnlyWorkflow, releaseWorkflow]) {
    assert.match(workflow, /bash scripts\/resolve-android-release-metadata\.sh/);
    assert.doesNotMatch(
      workflow,
      /sed -nE 's\/\^\[\[:space:\]\]\*version(Name|Code)/,
    );
  }
});
