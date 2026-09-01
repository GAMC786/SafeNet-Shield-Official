import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tests = [];

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectTests(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      tests.push(entryPath.replaceAll("\\", "/"));
    }
  }
}

await collectTests("server");

if (tests.length === 0) {
  console.error("No TypeScript test files were found under server.");
  process.exit(1);
}

let exitCode = 0;
for (const test of tests) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", test],
    { stdio: "inherit", shell: false },
  );

  if (result.error) {
    console.error(`Could not start test runner for ${test}: ${result.error.message}`);
    exitCode = 1;
    continue;
  }
  if (result.signal) {
    console.error(`Test runner for ${test} terminated by ${result.signal}.`);
    exitCode = 1;
    continue;
  }
  if (result.status !== 0) {
    exitCode = result.status ?? 1;
  }
}

process.exit(exitCode);