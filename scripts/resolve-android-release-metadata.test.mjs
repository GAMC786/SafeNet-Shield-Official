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
  const workflows = await Promise.all([
    readFile(new URL(".github/workflows/build-apk-only.yml", repositoryRoot), "utf8"),
    readFile(new URL(".github/workflows/build.yml", repositoryRoot), "utf8"),
  ]);

  for (const workflow of workflows) {
    assert.match(workflow, /bash scripts\/resolve-android-release-metadata\.sh/);
    assert.doesNotMatch(
      workflow,
      /sed -nE 's\/\^\[\[:space:\]\]\*version(Name|Code)/,
    );
  }
});
