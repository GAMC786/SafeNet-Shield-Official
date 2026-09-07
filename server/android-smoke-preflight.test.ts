import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const smokeScriptPath = path.resolve(process.cwd(), "scripts/android-smoke-test.sh");
const workflow = readFileSync(
  path.resolve(process.cwd(), ".github/workflows/build.yml"),
  "utf8",
).replace(/\r\n/g, "\n");
const apkOnlyWorkflow = readFileSync(
  path.resolve(process.cwd(), ".github/workflows/build-apk-only.yml"),
  "utf8",
).replace(/\r\n/g, "\n");
const smokeScript = readFileSync(smokeScriptPath, "utf8");
const runnerScript = readFileSync(
  path.resolve(process.cwd(), "scripts/provision-android-runner.sh"),
  "utf8",
);
const mainActivity = readFileSync(
  path.resolve(
    process.cwd(),
    "android/app/src/main/java/com/safenet/dns/MainActivity.java",
  ),
  "utf8",
);
const androidAppGradle = readFileSync(
  path.resolve(process.cwd(), "android/app/build.gradle"),
  "utf8",
);

function getStepBlock(stepName: string) {
  const stepStart = workflow.indexOf(`      - name: ${stepName}`);
  assert.notEqual(stepStart, -1, `Workflow step not found: ${stepName}`);

  const nextStep = workflow.indexOf("\n      - name:", stepStart + 1);
  const nextJobMatch = /\n  \S/.exec(workflow.slice(stepStart + 1));
  const nextJob =
    nextJobMatch === null ? -1 : stepStart + 1 + nextJobMatch.index;
  const blockEnd = [nextStep, nextJob]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), workflow.length);

  return workflow.slice(stepStart, blockEnd);
}

function getRunScript(stepName: string) {
  const stepBlock = getStepBlock(stepName);
  const runMarker = "\n        run: |\n";
  const runStart = stepBlock.indexOf(runMarker);
  assert.notEqual(runStart, -1, `Multiline run block not found: ${stepName}`);

  const script = stepBlock
    .slice(runStart + runMarker.length)
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
  assert.ok(script.trim().length > 0, `Empty multiline run block: ${stepName}`);
  return script;
}

const releaseSmokeSummaryScript = getRunScript(
  "Publish release Android smoke summary",
);

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
  assert.match(preflightStep, /ANDROID_EMULATOR_TARGET: google_apis/);
  assert.match(
    preflightStep,
    /ANDROID_EMULATOR_SYSTEM_IMAGE: system-images;android-34;google_apis;x86_64/,
  );
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
  assert.match(smokeScript, /emulator-image\.txt/);
  assert.match(smokeScript, /cygpath -u "\$temp_dir"/);
  assert.match(smokeScript, /tr -d '\\r'/);
  assert.match(smokeScript, /api_level=\$api_level/);
  assert.match(smokeScript, /configured_api_level=\$emulator_api_level/);
  assert.match(smokeScript, /target=\$emulator_target/);
  assert.match(smokeScript, /architecture=\$emulator_arch/);
  assert.match(smokeScript, /system_image=\$emulator_system_image/);
  assert.match(smokeScript, /build_fingerprint=\$build_fingerprint/);
  assert.match(smokeScript, /cat "\$output_dir\/emulator-image\.txt"/);
});

test("main-branch APK-only workflow builds and uploads a signed APK and checksum", () => {
  assert.match(apkOnlyWorkflow, /^name: Build SafeNet Android APK only$/m);
  assert.match(apkOnlyWorkflow, /push:\n\s+branches:\n\s+- main/);
  assert.match(apkOnlyWorkflow, /workflow_dispatch:/);
  assert.match(
    apkOnlyWorkflow,
    /MOBILE_API_URL: https:\/\/safe-net-shield-official\.replit\.app/,
  );
  assert.match(apkOnlyWorkflow, /Verify production auth bootstrap/);
  assert.match(
    apkOnlyWorkflow,
    /curl --fail --silent --show-error --location --connect-timeout 10 --max-time 20 "\$MOBILE_API_URL\/api\/auth\/status"/,
  );
  assert.match(
    apkOnlyWorkflow,
    /typeof status\.authenticated !== 'boolean' \|\| status\.pinRequired !== false/,
  );
  assert.match(
    apkOnlyWorkflow,
    /validate-mobile-api\.mjs "\$MOBILE_API_URL"/,
  );
  assert.match(apkOnlyWorkflow, /run: \.\/gradlew assembleRelease/);
  assert.match(apkOnlyWorkflow, /apksigner.*verify --verbose "\$apk"/);
  assert.match(
    apkOnlyWorkflow,
     /aapt.*dump badging "\$apk" \| grep -F "package: name='com\.safenet\.dns' versionCode='33' versionName='\$APP_VERSION'"/,
  );
  assert.match(apkOnlyWorkflow, /Manual PIN entry UI was not included/);
  assert.match(apkOnlyWorkflow, /name: Upload APK only/);
  assert.match(
    apkOnlyWorkflow,
    /path: android\/app\/build\/outputs\/apk\/release\/app-release\.apk/,
  );
  assert.match(apkOnlyWorkflow, /name: Generate APK SHA-256 checksum/);
  assert.match(
    apkOnlyWorkflow,
    /checksum="\$\(sha256sum "\$apk" \| cut -d ' ' -f1\)"/,
  );
  assert.match(
    apkOnlyWorkflow,
    /printf '%s  app-release\.apk\\n' "\$checksum" > "\$checksum_file"/,
  );
  assert.match(
    apkOnlyWorkflow,
    /cd "\$\(dirname "\$apk"\)"\s+sha256sum --check "\$checksum_file"/,
  );
  assert.match(apkOnlyWorkflow, /name: Upload APK SHA-256 checksum/);
  assert.match(
    apkOnlyWorkflow,
    /name: SafeNet-Android-APK-v\$\{\{ steps\.app_version\.outputs\.version \}\}-SHA256/,
  );
  assert.match(
    apkOnlyWorkflow,
    /path: \$\{\{ runner\.temp \}\}\/app-release\.apk\.sha256/,
  );
  assert.match(
    apkOnlyWorkflow,
    /name: Install dependencies with bounded retry[\s\S]*?run: bash scripts\/npm-ci-with-retry\.sh/,
  );
  assert.match(
    apkOnlyWorkflow,
    /name: Upload npm install diagnostics[\s\S]*?if: always\(\)[\s\S]*?name: SafeNet-Android-npm-ci-diagnostics/,
  );
  assert.doesNotMatch(apkOnlyWorkflow, /needs:/);
  assert.doesNotMatch(apkOnlyWorkflow, /build-windows|Windows|assembleDebug|AndroidTest/i);
  assert.equal(
    (apkOnlyWorkflow.match(/uses: actions\/upload-artifact@v4/g) ?? []).length,
    3,
  );
});

test("Android WebView accepts the production PIN session cookie", () => {
  assert.match(mainActivity, /CookieManager\.getInstance\(\)/);
  assert.match(mainActivity, /setAcceptCookie\(true\)/);
  assert.match(
    mainActivity,
    /setAcceptThirdPartyCookies\((?:getBridge\(\)\.getWebView\(\)|webView), true\)/,
  );
});

type PreflightFailureMode = "root" | "remount" | "cleanup-remains";

function assertMockedPreflightFailure(
  failureMode: PreflightFailureMode,
  expectedMessage: RegExp,
) {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "android-smoke-preflight-"));
  const binDir = path.join(fixtureDir, "bin");
  const outputDir = path.join(fixtureDir, "evidence");
  const adbLog = path.join(fixtureDir, "adb.log");
  const mockAdbPath = path.join(binDir, "adb");
  const mockOpenSslCommand = "safenet-test-openssl";
  const mockOpenSslPath = path.join(binDir, mockOpenSslCommand);

  try {
    mkdirSync(binDir);
    writeFileSync(
      mockAdbPath,
      `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "\${MOCK_ADB_LOG:?}"
case " $* " in
  *" get-state "*) printf 'device\\n'; exit 0 ;;
  *" getprop "*)
    case "\${!#}" in
      ro.build.version.sdk) printf '35\\n' ;;
      ro.product.cpu.abilist) printf 'x86_64\\n' ;;
      ro.build.fingerprint) printf 'google/aosp_atd/emu_x86_64:35/AB123/1234567:userdebug/test-keys\\n' ;;
      *) printf '\\n' ;;
    esac
    exit 0
    ;;
  *" root "*)
    if [[ "\${MOCK_FAILURE_MODE:?}" == "root" ]]; then
      printf 'adbd cannot run as root in production builds\\n'
    fi
    exit 0
    ;;
  *" remount "*)
    if [[ "\${MOCK_FAILURE_MODE:?}" == "remount" ]]; then
      printf 'remount failed\\n' >&2
      exit 1
    fi
    exit 0
    ;;
  *" reboot "*|*" wait-for-device "*) exit 0 ;;
  *" push "*) exit 0 ;;
  *" shell chmod "*|*" shell test -s "*) exit 0 ;;
  *" shell rm -f "*) exit 0 ;;
  *" shell test -e "*)
    if [[ "\${MOCK_FAILURE_MODE:?}" == "cleanup-remains" ]]; then
      printf 'the temporary CA is still present\\n'
      exit 0
    fi
    exit 1
    ;;
esac
printf 'unexpected adb invocation: %s\\n' "$*" >&2
exit 1
`,
    );
    chmodSync(mockAdbPath, 0o755);
    writeFileSync(
      mockOpenSslPath,
      `#!/usr/bin/env bash
set -u
if [[ "\${1:-}" == "req" ]]; then
  key_path=""
  cert_path=""
  while [[ "\${#}" -gt 0 ]]; do
    case "\$1" in
      -keyout) key_path="\$2"; shift 2 ;;
      -out) cert_path="\$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  [[ -n "\$key_path" && -n "\$cert_path" ]] || exit 1
  printf 'mock-key\\n' > "\$key_path"
  printf 'mock-cert\\n' > "\$cert_path"
  exit 0
fi
if [[ "\${1:-}" == "x509" ]]; then
  printf 'abcdef12\\n'
  exit 0
fi
exit 1
`,
    );
    chmodSync(mockOpenSslPath, 0o755);

    const result = spawnSync(
      "bash",
      [
        smokeScriptPath,
        "--preflight",
        "--serial",
        "emulator-5554",
        "--output",
        outputDir,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          TMPDIR: ".",
          TEMP: ".",
          TMP: ".",
          MOCK_ADB_LOG: adbLog,
          MOCK_FAILURE_MODE: failureMode,
          OPENSSL_BIN: mockOpenSslCommand,
          ANDROID_EMULATOR_API_LEVEL: "35",
          ANDROID_EMULATOR_TARGET: "google_apis",
          ANDROID_EMULATOR_ARCH: "x86_64",
          ANDROID_EMULATOR_SYSTEM_IMAGE:
            "system-images;android-35;google_apis;x86_64",
        },
      },
    );

    assert.equal(
      result.status,
      1,
      `expected the mocked ${failureMode} failure to stop preflight:\n${result.stdout}\n${result.stderr}`,
    );
    assert.equal(result.signal, null);

    const metadataPath = path.join(outputDir, "emulator-image.txt");
    const preflightLogPath = path.join(outputDir, "preflight.log");
    const resultPath = path.join(outputDir, "result.txt");
    assert.ok(existsSync(metadataPath), "emulator metadata should remain uploadable");
    assert.ok(existsSync(preflightLogPath), "preflight log should remain uploadable");
    assert.ok(existsSync(resultPath), "failure result should remain uploadable");

    const metadata = readFileSync(metadataPath, "utf8");
    const preflightLog = readFileSync(preflightLogPath, "utf8");
    const failureResult = readFileSync(resultPath, "utf8");
    for (const evidence of [
      "api_level=35",
      "target=google_apis",
      "architecture=x86_64",
      "system_image=system-images;android-35;google_apis;x86_64",
      "build_fingerprint=google/aosp_atd/emu_x86_64:35/AB123/1234567:userdebug/test-keys",
    ]) {
      assert.match(metadata, new RegExp(`^${evidence}$`, "m"));
      assert.match(preflightLog, new RegExp(`^${evidence}$`, "m"));
      assert.match(failureResult, new RegExp(`^${evidence}$`, "m"));
    }
    assert.match(failureResult, /failure_category=FIXTURE_FAILURE/);
  assert.match(
    failureResult,
    expectedMessage,
    `unexpected preflight failure result:\n${failureResult}\nadb log:\n${readFileSync(adbLog, "utf8")}\npreflight log:\n${preflightLog}`,
  );
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

test("early root preflight failure preserves emulator metadata and logs", () => {
  assertMockedPreflightFailure("root", /adb root is unavailable/);
});

test("remount preflight failure preserves emulator metadata and logs", () => {
  assertMockedPreflightFailure(
    "remount",
    /the emulator could not remount its system partition/,
  );
});

test("temporary-CA cleanup preflight failure preserves emulator metadata and logs", () => {
  assertMockedPreflightFailure(
    "cleanup-remains",
    /the temporary preflight CA remained in the system trust store/,
  );
});

test("tagged releases use the hosted emulator with reduced validation", () => {
  assert.match(
    workflow,
    /android-release-smoke:\n\s+needs: build-android\n\s+if: startsWith\(github\.ref, 'refs\/tags\/v'\)/,
  );
  assert.match(workflow, /android-release-smoke:[\s\S]*?\n\s+runs-on: ubuntu-latest/);
  assert.match(
    workflow,
    /android-release-smoke:[\s\S]*?\n\s+timeout-minutes: 30/,
  );
  assert.match(workflow, /ANDROID_SMOKE_RESOLVER_MODE: public/);
  assert.match(workflow, /ANDROID_SMOKE_COVERAGE: hosted-emulator/);
  assert.match(workflow, /target: google_apis/);
  const releaseSmokeStep = getStepBlock(
    "Run hosted-emulator smoke test (reduced validation)",
  );
  assert.match(releaseSmokeStep, /api-level: 34/);
  assert.doesNotMatch(releaseSmokeStep, /--preflight/);
  assert.doesNotMatch(
    releaseSmokeStep,
    /emulator-options:[^\n]*writable-system/,
  );
  assert.match(
    releaseSmokeStep,
    /ANDROID_EMULATOR_SYSTEM_IMAGE: system-images;android-34;google_apis;x86_64/,
  );
  assert.match(
    workflow,
    /--apk "\$GITHUB_WORKSPACE\/artifacts\/android\/app-release\.apk"/,
  );
  assert.match(
    workflow,
    /--test-apk "\$GITHUB_WORKSPACE\/artifacts\/android-test\/app-release-androidTest\.apk"/,
  );
  assert.match(releaseSmokeStep, /continue-on-error: true/);
  assert.match(workflow, /needs: \[build-android, android-release-smoke\]/);
  const releaseStart = workflow.indexOf("\n  release:");
  assert.ok(releaseStart >= 0);
  const releaseJob = workflow.slice(releaseStart);
  assert.match(releaseJob, /if: >-\n\s+always\(\)/);
  assert.match(releaseJob, /needs\.build-android\.result == 'success'/);
  assert.match(
    releaseJob,
    /needs\.android-release-smoke\.result == 'success'[\s\S]*needs\.android-release-smoke\.result == 'failure'/,
  );
  assert.match(
    workflow,
    /build-windows:\n\s+# Tagged releases.*\n\s+# Windows packaging lane.*\n\s+if: github\.event_name != 'schedule' && !startsWith\(github\.ref, 'refs\/tags\/v'\)/s,
  );
  assert.doesNotMatch(workflow, /name: Download Windows artifact/);
  assert.doesNotMatch(workflow, /artifacts\/windows\/\*\.msi/);
  const releaseVerifyStep = getStepBlock("Verify Android release APK");
  assert.match(releaseVerifyStep, /apksigner.*verify --verbose "\$apk"/);
  assert.match(releaseVerifyStep, /apksigner.*verify --verbose "\$test_apk"/);
  assert.match(
    releaseVerifyStep,
    /versionCode='33' versionName='\$expected_version'/,
  );
  assert.match(
    releaseVerifyStep,
    /package: name='com\.safenet\.dns\.test'/,
  );
  assert.match(releaseVerifyStep, /metadata mismatch\. Expected badging/);
  assert.match(releaseVerifyStep, /"Android instrumentation APK package"/);
  assert.match(releaseVerifyStep, /Actual badging for/);
  assert.match(releaseVerifyStep, /sha256sum --check app-release\.apk\.sha256/);
  assert.match(releaseVerifyStep, /unzip -l "\$apk" \| grep -F "assets\/public\/"/);
  assert.match(workflow, /name: Download Android instrumentation artifact/);
  const createReleaseStep = getStepBlock("Create Release");
  assert.match(createReleaseStep, /artifacts\/android\/app-release\.apk/);
  assert.match(createReleaseStep, /artifacts\/android\/app-release\.apk\.sha256/);
  assert.match(
    createReleaseStep,
    /artifacts\/android-test\/app-release-androidTest\.apk/,
  );
  assert.match(runnerScript, /system-images;android-\$\{api_level\};aosp_atd;x86_64/);
  assert.match(runnerScript, /build-tools;\$build_tools_version/);
  assert.match(runnerScript, /\/dev\/kvm/);
});

function createAndroidReleaseApkFixture() {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "android-release-apk-"));
  const artifactDir = path.join(fixtureDir, "artifacts");
  const appDir = path.join(artifactDir, "android");
  const testAppDir = path.join(artifactDir, "android-test");
  const sdkToolsDir = path.join(fixtureDir, "sdk", "build-tools", "36.0.0");
  const appApk = path.join(appDir, "app-release.apk");
  const testApk = path.join(testAppDir, "app-release-androidTest.apk");
  const appBadging = path.join(fixtureDir, "app-badging.txt");
  const testBadging = path.join(fixtureDir, "test-badging.txt");
  const binDir = path.join(fixtureDir, "bin");
  const aapt = path.join(sdkToolsDir, "aapt");
  const apksigner = path.join(sdkToolsDir, "apksigner");
  const unzip = path.join(binDir, "unzip");

  mkdirSync(appDir, { recursive: true });
  mkdirSync(testAppDir, { recursive: true });
  mkdirSync(sdkToolsDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  for (const apk of [appApk, testApk]) {
    writeFileSync(apk, "fixture APK\n");
  }

  writeFileSync(
    aapt,
    `#!/usr/bin/env bash
set -eu
if [[ "\${3:?}" == *"app-release-androidTest.apk" ]]; then
  cat "\${MOCK_TEST_BADGING:?}"
else
  cat "\${MOCK_APP_BADGING:?}"
fi
`,
  );
  writeFileSync(
    apksigner,
    `#!/usr/bin/env bash
set -eu
exit 0
`,
  );
  writeFileSync(
    unzip,
    `#!/usr/bin/env bash
set -eu
printf '  assets/public/index.html\\n'
`,
  );
  chmodSync(aapt, 0o755);
  chmodSync(apksigner, 0o755);
  chmodSync(unzip, 0o755);

  return {
    fixtureDir,
    binDir,
    appDir,
    testAppDir,
    appApk,
    testApk,
    appBadging,
    testBadging,
    sdkRoot: path.join(fixtureDir, "sdk"),
  };
}

function runReleaseApkVerificationFixture({
  appBadging,
  testBadging,
}: {
  appBadging: string;
  testBadging: string;
}) {
  const fixture = createAndroidReleaseApkFixture();
  try {
    writeFileSync(fixture.appBadging, `${appBadging}\n`);
    writeFileSync(fixture.testBadging, `${testBadging}\n`);

    const result = spawnSync("bash", ["-c", getRunScript("Verify Android release APKs")], {
      cwd: fixture.fixtureDir,
      encoding: "utf8",
      env: {
        ...process.env,
        ANDROID_HOME: fixture.sdkRoot,
        ANDROID_SDK_ROOT: "",
         GITHUB_REF_NAME: "v1.0.41",
        MOCK_APP_BADGING: fixture.appBadging,
        MOCK_TEST_BADGING: fixture.testBadging,
        PATH: `${fixture.binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
    });

    return {
      ...result,
      output: [result.stdout, result.stderr].filter(Boolean).join("\n"),
    };
  } finally {
    rmSync(fixture.fixtureDir, { recursive: true, force: true });
  }
}

test("release APK verification validates app and instrumentation badging independently", () => {
  assert.match(androidAppGradle, /applicationId "com\.safenet\.dns"/);
  assert.match(androidAppGradle, /testApplicationId "com\.safenet\.dns\.test"/);
  assert.match(
    androidAppGradle,
    /testInstrumentationRunner "androidx\.test\.runner\.AndroidJUnitRunner"/,
  );

  const result = runReleaseApkVerificationFixture({
    appBadging:
       "package: name='com.safenet.dns' versionCode='33' versionName='1.0.41'",
    testBadging: [
      "package: name='com.safenet.dns.test' versionCode='1' versionName='1.0.0'",
      "instrumentation: name='androidx.test.runner.AndroidJUnitRunner' targetPackage='com.safenet.dns' label='' targetProcesses=''",
    ].join("\n"),
  });

  assert.equal(result.status, 0, `release APK fixture failed:\n${result.output}`);
  assert.equal(result.signal, null);
});

test("release APK verification clearly rejects instrumentation metadata drift", () => {
  const wrongPackage = runReleaseApkVerificationFixture({
    appBadging:
       "package: name='com.safenet.dns' versionCode='33' versionName='1.0.41'",
    testBadging:
      "package: name='com.safenet.other.test' versionCode='1' versionName='1.0.0'\n" +
      "instrumentation: name='androidx.test.runner.AndroidJUnitRunner' targetPackage='com.safenet.dns'",
  });
  assert.equal(wrongPackage.status, 1, wrongPackage.output);
  assert.match(
    wrongPackage.output,
    /Android instrumentation APK package metadata mismatch/,
  );
  assert.match(
    wrongPackage.output,
    /Expected badging: package: name='com\.safenet\.dns\.test'/,
  );

});

test("hosted emulator wrapper failure still reaches release evidence upload", () => {
  const smokeStep = getStepBlock(
    "Run hosted-emulator smoke test (reduced validation)",
  );
  const uploadStep = getStepBlock("Upload release Android smoke evidence");

  // The action wrapper can fail while booting the emulator, before either
  // command in its script exits normally. This is distinct from the mocked
  // adb failures above, which exercise the preflight script itself.
  assert.match(smokeStep, /uses: reactivecircus\/android-emulator-runner@v2/);
  assert.match(smokeStep, /script: \.\/scripts\/android-smoke-test\.sh /);
  assert.doesNotMatch(smokeStep, /--preflight/);
  assert.match(smokeStep, /--apk "\$GITHUB_WORKSPACE\/artifacts\/android\/app-release\.apk"/);

  // always() is required because an action-level wrapper failure prevents
  // the smoke script from producing a normal exit status.
  assert.match(uploadStep, /\n        if: always\(\)/);
  assert.match(
    uploadStep,
    /path: android\/app\/build\/reports\/android-smoke\/latest/,
  );
  assert.match(uploadStep, /if-no-files-found: warn/);
});

test("release smoke summary script is extracted and passes Bash syntax validation", () => {
  const result = spawnSync("bash", ["-n"], {
    input: releaseSmokeSummaryScript,
    encoding: "utf8",
  });

  assert.equal(
    result.status,
    0,
    `release smoke summary script failed Bash syntax validation:\n${result.stdout}\n${result.stderr}`,
  );
  assert.equal(result.signal, null);
});

function runReleaseSmokeSummary(category?: string) {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "android-release-summary-"));
  const workspaceDir = path.join(fixtureDir, "workspace");
  const evidenceDir = path.join(
    workspaceDir,
    "android/app/build/reports/android-smoke/latest",
  );
  const summaryPath = path.join(fixtureDir, "github-step-summary.md");

  try {
    mkdirSync(workspaceDir, { recursive: true });
    if (category) {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(path.join(evidenceDir, "failure-category.txt"), `${category}\n`);
    }

    const result = spawnSync("bash", ["-c", releaseSmokeSummaryScript], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_WORKSPACE: workspaceDir,
        GITHUB_STEP_SUMMARY: summaryPath,
        SMOKE_STEP_OUTCOME: "failure",
        RUN_URL: "https://github.com/SafeNetInc/safenet/actions/runs/123",
        EVIDENCE_URL: "https://github.com/SafeNetInc/safenet/actions/runs/123#artifacts",
      },
    });

    assert.equal(
      result.status,
      0,
      `release smoke summary failed for ${category ?? "missing evidence"}:\n${result.stdout}\n${result.stderr}`,
    );
    assert.equal(result.signal, null);
    return readFileSync(summaryPath, "utf8");
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

test("release smoke summary reports wrapper failure when no evidence exists", () => {
  const summary = runReleaseSmokeSummary();

  assert.match(summary, /- \*\*Failure category:\*\* `EMULATOR_RUNNER_FAILURE`/);
  assert.match(summary, /- \*\*Smoke step:\*\* `failure`/);
});

test("release smoke summary preserves each recorded failure category", () => {
  const recordedCategories = [
    "PASS",
    "FIXTURE_FAILURE",
    "ENETUNREACH",
    "UNRELATED_NETWORK_FAILURE",
    "NON_NETWORK_FAILURE",
  ];

  for (const category of recordedCategories) {
    const summary = runReleaseSmokeSummary(category);
    assert.match(
      summary,
      new RegExp(`- \\*\\*Failure category:\\*\\* \`${category}\``),
    );
  }
});

test("scheduled and manual runs check the dedicated runner independently", () => {
  const healthStart = workflow.indexOf("  android-runner-health:");
  const releaseSmokeStart = workflow.indexOf("  android-release-smoke:", healthStart);

  assert.ok(healthStart >= 0);
  assert.ok(releaseSmokeStart > healthStart);

  const healthJob = workflow.slice(healthStart, releaseSmokeStart);
  assert.match(
    healthJob,
    /if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/,
  );
  assert.match(
    healthJob,
    /runs-on: \[self-hosted, linux, x64, android-writable-system\]/,
  );
  assert.match(healthJob, /ANDROID_EMULATOR_API_LEVEL: 35/);
  assert.match(healthJob, /ANDROID_AVD_NAME: safenet-writable/);
  assert.match(healthJob, /provision-android-runner\.sh --check/);
  assert.match(healthJob, /android-runner-health\.log/);
  assert.doesNotMatch(healthJob, /actions\/upload-artifact/);
  assert.doesNotMatch(healthJob, /needs:/);
});

test("runner health validation explains each required host capability", () => {
  assert.match(runnerScript, /system image is missing/);
  assert.match(runnerScript, /build-tools are missing/);
  assert.match(runnerScript, /Required AVD is missing/);
  assert.match(runnerScript, /\/dev\/kvm is required/);
  assert.match(runnerScript, /passwordless sudo for the fixture's resolver ports/);
});
