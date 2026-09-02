import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tests = [];
const testDirectories = ["server", "scripts"];

function encodeAnnotation(value) {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectTests(entryPath);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.mjs"))
    ) {
      tests.push(entryPath.replaceAll("\\", "/"));
    }
  }
}

for (const directory of testDirectories) {
  await collectTests(directory);
}

if (tests.length === 0) {
  console.error("No test files were found under the configured test directories.");
  process.exit(1);
}

let exitCode = 0;
for (const test of tests) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", test],
    { encoding: "utf8", shell: false },
  );

  if (result.error) {
    const message = `Could not start test runner for ${test}: ${result.error.message}`;
    console.error(message);
    console.log(`::error title=Test runner failure::${encodeAnnotation(message)}`);
    exitCode = 1;
    continue;
  }
  if (result.signal) {
    const message = `Test runner for ${test} terminated by ${result.signal}.`;
    console.error(message);
    console.log(`::error title=Test runner failure::${encodeAnnotation(message)}`);
    exitCode = 1;
    continue;
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const message = `Test failed for ${test} with exit code ${result.status ?? 1}.\n${output}`;
    console.error(message);
    console.log(`::error title=Test failure::${encodeAnnotation(message).slice(0, 60000)}`);
    exitCode = result.status ?? 1;
  } else {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }
}

process.exit(exitCode);