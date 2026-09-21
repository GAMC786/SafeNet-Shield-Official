import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scriptPath = new URL("./setup-android-sdk.sh", import.meta.url);
const variables = readFileSync(new URL("../android/variables.gradle", import.meta.url), "utf8");
const compileSdkVersion = variables.match(/^\s*compileSdkVersion\s*=\s*(\d+)/m)?.[1];
const buildToolsVersion = variables.match(
  /^\s*androidBuildToolsVersion\s*=\s*'([^']+)'/m,
)?.[1];

assert.ok(compileSdkVersion);
assert.ok(buildToolsVersion);

function createHarness(mode) {
  const root = mkdtempSync(join(tmpdir(), "setup-android-sdk-"));
  const sdkRoot = join(root, "sdk");
  const runnerTemp = join(root, "runner-temp");
  const outputDir = join(root, "evidence");
  const binDir = join(root, "bin");
  const stateFile = join(root, "sdkmanager-count");
  const sdkManager = join(binDir, "sdkmanager");

  mkdirSync(sdkRoot);
  mkdirSync(runnerTemp);
  mkdirSync(outputDir);
  mkdirSync(binDir);
  writeFileSync(
    sdkManager,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" --licenses "* ]]; then
  exit 0
fi
count=0
[[ -f ${JSON.stringify(stateFile)} ]] && count="$(cat ${JSON.stringify(stateFile)})"
count=$((count + 1))
printf '%s' "$count" > ${JSON.stringify(stateFile)}
case ${JSON.stringify(mode)} in
  transient-then-success)
    if (( count < 3 )); then
      echo 'Warning: Failed to download repository XML: Connection reset' >&2
      exit 1
    fi
    ;;
  transient-always-fails)
    echo 'Warning: Failed to download package: timed out' >&2
    exit 9
    ;;
  package-unavailable)
    echo "Warning: Failed to find package 'platforms;android-${compileSdkVersion}'" >&2
    exit 1
    ;;
esac
mkdir -p \
  ${JSON.stringify(join(sdkRoot, "platform-tools"))} \
  ${JSON.stringify(join(sdkRoot, `platforms/android-${compileSdkVersion}`))} \
  ${JSON.stringify(join(sdkRoot, `build-tools/${buildToolsVersion}`))}
`,
  );
  chmodSync(sdkManager, 0o755);

  const sleep = join(binDir, "sleep");
  writeFileSync(sleep, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(sleep, 0o755);

  const result = spawnSync(
    "bash",
    [scriptPath.pathname],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ANDROID_SDK_ROOT: sdkRoot,
        ANDROID_SDK_SETUP_OUTPUT_DIR: outputDir,
        PATH: `${binDir}:${process.env.PATH}`,
        RUNNER_TEMP: runnerTemp,
        SDKMANAGER: sdkManager,
      },
      encoding: "utf8",
    },
  );

  const resultFile = existsSync(join(outputDir, "result.txt"))
    ? readFileSync(join(outputDir, "result.txt"), "utf8")
    : "";
  const count = readFileSync(stateFile, "utf8");
  return { count, outputDir, result, resultFile, sdkRoot };
}

test("retries transient repository failures and then installs the pinned packages", () => {
  const { count, result, sdkRoot } = createHarness("transient-then-success");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(count, "3");
  assert.ok(
    readdirSync(join(sdkRoot, "platforms")).includes(`android-${compileSdkVersion}`),
  );
});

test("does not retry a persistent package-availability failure", () => {
  const { count, result, resultFile } = createHarness("package-unavailable");

  assert.equal(result.status, 1);
  assert.equal(count, "1");
  assert.match(resultFile, /^failure_reason=PACKAGE_UNAVAILABLE$/m);
  assert.match(resultFile, /^attempts=1$/m);
});

test("bounds transient retries and preserves the final sdkmanager status", () => {
  const { count, result, resultFile, outputDir } = createHarness("transient-always-fails");

  assert.equal(result.status, 9);
  assert.equal(count, "3");
  assert.match(resultFile, /^failure_reason=TRANSIENT_REPOSITORY_OR_DOWNLOAD$/m);
  assert.match(resultFile, /^attempts=3$/m);
  assert.match(resultFile, /^exit_status=9$/m);
  assert.ok(readFileSync(join(outputDir, "diagnostics.log"), "utf8").includes("timed out"));
});