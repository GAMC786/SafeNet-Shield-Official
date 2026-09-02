import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDirectory = join(repositoryRoot, ".github", "workflows");
const configFile = join(".github", "actionlint.yaml");

const workflowFiles = readdirSync(workflowDirectory, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")),
  )
  .map((entry) => join(".github", "workflows", entry.name))
  .sort();

if (workflowFiles.length === 0) {
  console.error(
    "No top-level .yml or .yaml workflow files were found under .github/workflows.",
  );
  process.exit(1);
}

console.log(
  `Linting ${workflowFiles.length} GitHub Actions workflow(s) with ${configFile}:`,
);
for (const workflowFile of workflowFiles) {
  console.log(`  ${workflowFile}`);
}

const result = spawnSync(
  "actionlint",
  ["-config-file", configFile, "-shellcheck", "shellcheck", ...workflowFiles],
  {
    cwd: repositoryRoot,
    stdio: "inherit",
  },
);

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error(
      "actionlint was not found. Install actionlint and ShellCheck, then rerun npm run lint:workflows.",
    );
  } else {
    console.error(`Could not run actionlint: ${result.error.message}`);
  }
  process.exit(1);
}

if (result.signal) {
  console.error(`actionlint terminated by signal ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);