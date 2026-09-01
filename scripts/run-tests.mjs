import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

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

const testProcess = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...tests],
  { stdio: "inherit", shell: false },
);

testProcess.on("error", (error) => {
  console.error(`Could not start test runner: ${error.message}`);
  process.exit(1);
});

testProcess.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Test runner terminated by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});