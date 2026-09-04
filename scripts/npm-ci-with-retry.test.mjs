import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scriptPath = new URL("./npm-ci-with-retry.sh", import.meta.url);

function createFakeNpm(directory, { failuresBeforeSuccess }) {
  const stateFile = join(directory, "npm-ci-count");
  const npmPath = join(directory, "npm");
  writeFileSync(
    npmPath,
    `#!/usr/bin/env bash
set -euo pipefail
state_file=${JSON.stringify(stateFile)}
case "\${1:-}" in
  ci)
    count=0
    if [[ -f "$state_file" ]]; then count="$(cat "$state_file")"; fi
    count=$((count + 1))
    printf '%s' "$count" > "$state_file"
    if (( count <= ${failuresBeforeSuccess} )); then
      echo 'npm ERR! Exit handler never called' >&2
      exit 1
    fi
    echo 'added dependencies'
    ;;
  --version)
    echo '10.9.4'
    ;;
  config)
    if [[ "\${2:-}" == 'get' && "\${3:-}" == 'registry' ]]; then
      echo 'https://registry.npmjs.org/'
    elif [[ "\${2:-}" == 'get' && "\${3:-}" == 'cache' ]]; then
      echo '/tmp/npm-cache'
    fi
    ;;
  cache)
    echo 'Cache verified'
    ;;
esac
`,
  );
  chmodSync(npmPath, 0o755);
  return stateFile;
}

function createTestRunner({ failuresBeforeSuccess }) {
  const directory = mkdtempSync(join(tmpdir(), "npm-ci-with-retry-"));
  const runnerTemp = join(directory, "runner-temp");
  const binDirectory = join(directory, "bin");
  mkdirSync(runnerTemp);
  mkdirSync(binDirectory);
  writeFileSync(join(directory, "package-lock.json"), JSON.stringify({
    packages: {
      "node_modules/example": {
        resolved: "http://package-firewall.replit.local/npm/example/-/example-1.0.0.tgz",
        integrity: "sha512-example",
      },
    },
  }));
  const stateFile = createFakeNpm(binDirectory, { failuresBeforeSuccess });
  writeFileSync(join(binDirectory, "node"), "#!/usr/bin/env bash\necho 'v22.22.0'\n");
  chmodSync(join(binDirectory, "node"), 0o755);
  writeFileSync(join(binDirectory, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(binDirectory, "sleep"), 0o755);

  const result = spawnSync(
    "bash",
    [scriptPath.pathname],
    {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        RUNNER_TEMP: runnerTemp,
      },
      encoding: "utf8",
    },
  );

  return {
    directory,
    result,
    stateFile,
    diagnosticsDirectory: join(runnerTemp, "npm-ci-diagnostics"),
  };
}

test("retries transient npm failures and records bounded diagnostics", () => {
  const { directory, result, stateFile, diagnosticsDirectory } =
    createTestRunner({ failuresBeforeSuccess: 2 });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(execFileSync("cat", [stateFile], { encoding: "utf8" }), "3");
  assert.equal(
    readdirSync(diagnosticsDirectory).filter((name) => name.endsWith(".log")).length,
    3,
  );
  assert.equal(
    readdirSync(diagnosticsDirectory).filter((name) => name.endsWith("-diagnostics.txt"))
      .length,
    2,
  );
  assert.match(
    execFileSync(
      "cat",
      [join(diagnosticsDirectory, "npm-ci-attempt-1-diagnostics.txt")],
      { encoding: "utf8" },
    ),
    /Exit handler never called|npm ci exit status: 1/,
  );
  assert.match(
    execFileSync("cat", [join(directory, "package-lock.json")], {
      encoding: "utf8",
    }),
    /https:\/\/registry\.npmjs\.org\/example/,
  );
});

test("fails after the bounded retry budget and keeps the diagnostics", () => {
  const { result, stateFile, diagnosticsDirectory } = createTestRunner({
    failuresBeforeSuccess: 99,
  });

  assert.notEqual(result.status, 0);
  assert.equal(execFileSync("cat", [stateFile], { encoding: "utf8" }), "3");
  assert.equal(
    readdirSync(diagnosticsDirectory).filter((name) => name.endsWith("-diagnostics.txt"))
      .length,
    3,
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /npm ci failed after 3 attempts/,
  );
});