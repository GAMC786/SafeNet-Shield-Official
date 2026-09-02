import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDirectory = join(repositoryRoot, ".github", "workflows");
const configFile = join(".github", "actionlint.yaml");
const localToolDirectory = join(repositoryRoot, ".tools", "workflow-lint");
const packageManifest = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);
const requiredVersions = packageManifest.workflowLint;

export function validateRequiredVersions(versions) {
  if (
    !versions ||
    typeof versions.actionlint !== "string" ||
    typeof versions.shellcheck !== "string"
  ) {
    throw new Error(
      "package.json must define workflowLint.actionlint and workflowLint.shellcheck versions.",
    );
  }
  return versions;
}

validateRequiredVersions(requiredVersions);

export function resolveTool(
  command,
  { platformName = process.platform, toolDirectory = localToolDirectory } = {},
) {
  const localCommand = platformName === "win32" ? `${command}.exe` : command;
  const localPath = join(toolDirectory, localCommand);
  return existsSync(localPath) ? localPath : command;
}

export function parseToolVersion(command, output) {
  if (command === "shellcheck") {
    return output.match(/(?:^|\n)version:\s*(\d+\.\d+\.\d+)\b/)?.[1];
  }
  return output.match(/\b\d+\.\d+\.\d+\b/)?.[0];
}

export function validateToolVersions(installedVersions, versions = requiredVersions) {
  validateRequiredVersions(versions);
  for (const [tool, installedVersion] of Object.entries(installedVersions)) {
    const requiredVersion = versions[tool];
    if (installedVersion !== requiredVersion) {
      throw new Error(
        `${tool} ${requiredVersion} is required, but ${installedVersion ?? "an unrecognized version"} was found. See the workflow linting instructions in replit.md.`,
      );
    }
  }
}

function readToolVersion(command, args, label) {
  const result = spawnSync(resolveTool(command), args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        `${label} was not found. Install ${requiredVersions[label.toLowerCase()]} and rerun npm run lint:workflows.`,
      );
    }
    throw new Error(`Could not check ${label}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `Could not check ${label}${details ? `:\n${details}` : "."}`,
    );
  }

  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

async function main() {
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
  const installedVersions = {
    actionlint: parseToolVersion("actionlint", actionlintOutput),
    shellcheck: parseToolVersion("shellcheck", shellcheckOutput),
  };
  validateToolVersions(installedVersions);

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
    throw new Error(
      "No top-level .yml or .yaml workflow files were found under .github/workflows.",
    );
  }

  console.log(
    `Linting ${workflowFiles.length} GitHub Actions workflow(s) with ${configFile}:`,
  );
  for (const workflowFile of workflowFiles) {
    console.log(`  ${workflowFile}`);
  }

  const result = spawnSync(resolveTool("actionlint"), [
    "-config-file",
    configFile,
    "-shellcheck",
    resolveTool("shellcheck"),
    ...workflowFiles,
  ], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        "actionlint was not found. See the workflow linting instructions in replit.md, then rerun npm run lint:workflows.",
      );
    }
    throw new Error(`Could not run actionlint: ${result.error.message}`);
  }

  if (result.signal) {
    throw new Error(`actionlint terminated by signal ${result.signal}.`);
  }

  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}