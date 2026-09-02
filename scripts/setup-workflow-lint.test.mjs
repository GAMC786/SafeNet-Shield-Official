import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  extractArchive,
  getDownloads,
  getPlatformConfiguration,
  getRequiredVersions,
} from "./setup-workflow-lint.mjs";
import {
  parseToolVersion,
  resolveTool,
  validateToolVersions,
} from "./lint-workflows.mjs";

const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const versions = getRequiredVersions(packageManifest);

test("maps every supported platform and architecture to release assets", () => {
  const cases = [
    {
      platform: "linux",
      architecture: "x64",
      actionlint: `actionlint_${versions.actionlint}_linux_amd64.tar.gz`,
      shellcheck: `shellcheck-v${versions.shellcheck}.linux.x86_64.tar.xz`,
      executables: ["actionlint", "shellcheck"],
    },
    {
      platform: "linux",
      architecture: "arm64",
      actionlint: `actionlint_${versions.actionlint}_linux_arm64.tar.gz`,
      shellcheck: `shellcheck-v${versions.shellcheck}.linux.aarch64.tar.xz`,
      executables: ["actionlint", "shellcheck"],
    },
    {
      platform: "darwin",
      architecture: "x64",
      actionlint: `actionlint_${versions.actionlint}_darwin_amd64.tar.gz`,
      shellcheck: `shellcheck-v${versions.shellcheck}.darwin.x86_64.tar.xz`,
      executables: ["actionlint", "shellcheck"],
    },
    {
      platform: "darwin",
      architecture: "arm64",
      actionlint: `actionlint_${versions.actionlint}_darwin_arm64.tar.gz`,
      shellcheck: `shellcheck-v${versions.shellcheck}.darwin.aarch64.tar.xz`,
      executables: ["actionlint", "shellcheck"],
    },
    {
      platform: "win32",
      architecture: "x64",
      actionlint: `actionlint_${versions.actionlint}_windows_amd64.tar.gz`,
      shellcheck: `shellcheck-v${versions.shellcheck}.zip`,
      executables: ["actionlint.exe", "shellcheck.exe"],
    },
  ];

  for (const expected of cases) {
    const configuration = getPlatformConfiguration(
      expected.platform,
      expected.architecture,
    );
    const downloads = getDownloads({
      platformName: expected.platform,
      architectureName: expected.architecture,
      versions,
    });

    assert.equal(downloads[0].archive, expected.actionlint);
    assert.equal(downloads[1].archive, expected.shellcheck);
    assert.deepEqual(
      downloads.map((download) => download.executable),
      expected.executables,
    );
    assert.equal(
      configuration.platform.actionlint,
      expected.platform === "win32" ? "windows" : expected.platform,
    );
  }
});

test("uses the versions checked by npm run lint:workflows", () => {
  const downloads = getDownloads({
    platformName: "linux",
    architectureName: "x64",
    versions,
  });

  assert.deepEqual(
    downloads.map((download) => download.version),
    [versions.actionlint, versions.shellcheck],
  );
  assert.doesNotThrow(() =>
    validateToolVersions({
      actionlint: parseToolVersion(
        "actionlint",
        `actionlint ${versions.actionlint}\n`,
      ),
      shellcheck: parseToolVersion(
        "shellcheck",
        `ShellCheck - shell script analysis tool\nversion: ${versions.shellcheck}\n`,
      ),
    }),
  );
  assert.throws(
    () =>
      validateToolVersions({
        actionlint: "0.0.0",
        shellcheck: versions.shellcheck,
      }),
    new RegExp(`actionlint ${versions.actionlint} is required`),
  );
});

test("sources CI workflow lint versions from package.json", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/build.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /id: workflow-lint-versions/);
  assert.match(
    workflow,
    /SHELLCHECK_VERSION: \$\{\{ steps\.workflow-lint-versions\.outputs\.shellcheck_version \}\}/,
  );
  assert.match(
    workflow,
    /version: \$\{\{ steps\.workflow-lint-versions\.outputs\.actionlint_version \}\}/,
  );
  assert.match(
    workflow,
    /getRequiredVersions\(manifest\)/,
  );
  assert.doesNotMatch(workflow, /SHELLCHECK_VERSION:\s*['"]\d+\.\d+\.\d+['"]/);
  assert.doesNotMatch(
    workflow,
    /version:\s*['"]\d+\.\d+\.\d+['"]/,
  );
});

test("runs a maintainer-triggered or monthly cross-platform installer matrix", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/build.yml", import.meta.url),
    "utf8",
  );
  const matrixJobStart = workflow.indexOf("  cross-platform-workflow-lint:");
  const matrixJobEnd = workflow.indexOf("  build-android:", matrixJobStart);
  assert.notEqual(matrixJobStart, -1);
  assert.notEqual(matrixJobEnd, -1);
  const matrixJob = workflow.slice(matrixJobStart, matrixJobEnd);

  assert.match(
    workflow,
    /cross_platform_workflow_lint:[\s\S]*?type: boolean/,
  );
  assert.match(
    workflow,
    /schedule:[\s\S]*?- cron: '47 4 1 \* \*'/,
  );
  assert.match(
    matrixJob,
    /if:[\s\S]*?github\.event_name == 'workflow_dispatch' && inputs\.cross_platform_workflow_lint[\s\S]*?github\.event_name == 'schedule' && github\.event\.schedule == '47 4 1 \* \*'/,
  );
  assert.match(
    matrixJob,
    /runner: windows-latest[\s\S]*?platform: Windows[\s\S]*?architecture: x64/,
  );
  assert.match(
    matrixJob,
    /runner: macos-13[\s\S]*?platform: macOS[\s\S]*?architecture: x64/,
  );
  assert.match(
    matrixJob,
    /runner: macos-14[\s\S]*?platform: macOS[\s\S]*?architecture: arm64/,
  );
  assert.match(
    matrixJob,
    /uses: actions\/checkout@v4[\s\S]*?path: workflow-lint-checkout/,
  );
  assert.match(
    matrixJob,
    /working-directory: workflow-lint-checkout[\s\S]*?run: npm run setup:workflow-lint/,
  );
  assert.match(
    matrixJob,
    /working-directory: workflow-lint-checkout[\s\S]*?run: npm run lint:workflows/,
  );
  assert.match(
    matrixJob,
    /Report workflow lint failure stage[\s\S]*?WORKFLOW_LINT_PLATFORM[\s\S]*?WORKFLOW_LINT_ARCHITECTURE[\s\S]*?Failed stage/,
  );
});

test("rejects unsupported platforms with an actionable error", () => {
  assert.throws(
    () => getPlatformConfiguration("freebsd", "x64"),
    /Unsupported platform: freebsd\/x64.*Supported platforms are Linux x64\/arm64, macOS x64\/arm64, and Windows x64/,
  );
  assert.throws(
    () => getPlatformConfiguration("win32", "arm64"),
    /Unsupported platform: win32\/arm64/,
  );
});

test("reports missing extraction tools clearly", () => {
  for (const [archive, extension, tool] of [
    ["workflow-lint.zip", "zip", "unzip"],
    ["workflow-lint.tar.xz", "tar.xz", "tar"],
  ]) {
    assert.throws(
      () =>
        extractArchive(archive, "destination", extension, {
          platformName: "linux",
          spawn: () => ({
            error: { code: "ENOENT", message: `spawn ${tool} ENOENT` },
          }),
        }),
      new RegExp(
        `Could not extract ${archive.replace(".", "\\.")}: spawn ${tool} ENOENT.*Install the standard tar/unzip utilities`,
      ),
    );
  }
});

test("uses PowerShell and Windows executable names for zip extraction", () => {
  const calls = [];
  extractArchive("workflow-lint.zip", "destination", "zip", {
    platformName: "win32",
    spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "powershell.exe");
  assert.deepEqual(calls[0][1].slice(0, 4), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
  ]);
});

test("resolves Windows-installed tool executables with their .exe suffix", () => {
  const toolDirectory = mkdtempSync(join("scripts", "workflow-lint-tools-"));
  try {
    writeFileSync(join(toolDirectory, "actionlint.exe"), "");
    assert.equal(
      resolveTool("actionlint", { platformName: "win32", toolDirectory }),
      join(toolDirectory, "actionlint.exe"),
    );
    assert.equal(
      resolveTool("shellcheck", { platformName: "win32", toolDirectory }),
      "shellcheck",
    );
  } finally {
    rmSync(toolDirectory, { recursive: true, force: true });
  }
});