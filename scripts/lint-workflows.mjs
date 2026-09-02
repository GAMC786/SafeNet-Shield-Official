import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDirectory = join(repositoryRoot, ".github", "workflows");
const configFile = join(".github", "actionlint.yaml");
const packageManifest = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);
const requiredVersions = packageManifest.workflowLint;

if (
  !requiredVersions ||
  typeof requiredVersions.actionlint !== "string" ||
  typeof requiredVersions.shellcheck !== "string"
) {
  console.error(
    "package.json must define workflowLint.actionlint and workflowLint.shellcheck versions.",
  );
  process.exit(1);
}

function readToolVersion(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error(
        `${label} was not found. Install ${label} ${requiredVersions[label.toLowerCase()]} and rerun npm run lint:workflows.`,
      );
    } else {
      console.error(`Could not check ${label}: ${result.error.message}`);
    }
    process.exit(1);
  }

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    console.error(
      `Could not check ${label}${details ? `:\n${details}` : "."}`,
    );
    process.exit(1);
  }

  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

const actionlintOutput = readToolVersion(
  "actionlint",
  ["-version"],
  "actionlint",
);
const shellcheckOutput = readToolVersion(
  "shellcheck",
  ["--version"],
  "shellcheck",
);
const actionlintVersion = actionlintOutput.match(/\b\d+\.\d+\.\d+\b/)?.[0];
const shellcheckVersion = shellcheckOutput.match(
  /(?:^|\n)version:\s*(\d+\.\d+\.\d+)\b/,
)?.[1];

const installedVersions = {
  actionlint: actionlintVersion,
  shellcheck: shellcheckVersion,
};
for (const [tool, installedVersion] of Object.entries(installedVersions)) {
  const requiredVersion = requiredVersions[tool];
  if (installedVersion !== requiredVersion) {
    console.error(
      `${tool} ${requiredVersion} is required, but ${installedVersion ?? "an unrecognized version"} was found. See the workflow linting instructions in replit.md.`,
    );
    process.exit(1);
  }
}

console.log(
  `Using actionlint ${installedVersions.actionlint} and ShellCheck ${installedVersions.shellcheck}.`,
);

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

const result = spawnSync("actionlint", [
  "-config-file",
  configFile,
  "-shellcheck",
  "shellcheck",
  ...workflowFiles,
], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error(
      "actionlint was not found. See the workflow linting instructions in replit.md, then rerun npm run lint:workflows.",
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