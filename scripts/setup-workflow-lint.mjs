import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);
const requiredVersions = packageManifest.workflowLint;
const installDirectory = join(
  repositoryRoot,
  ".tools",
  "workflow-lint",
);

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

const architecture = {
  x64: {
    actionlint: "amd64",
    shellcheck: "x86_64",
  },
  arm64: {
    actionlint: "arm64",
    shellcheck: "aarch64",
  },
}[process.arch];

const platform = {
  linux: {
    actionlint: "linux",
    shellcheck: "linux",
    shellcheckExtension: "tar.xz",
  },
  darwin: {
    actionlint: "darwin",
    shellcheck: "darwin",
    shellcheckExtension: "tar.xz",
  },
  win32: {
    actionlint: "windows",
    shellcheck: "windows",
    shellcheckExtension: "zip",
  },
}[process.platform];

if (
  !platform ||
  !architecture ||
  (process.platform === "win32" && process.arch !== "x64")
) {
  console.error(
    `Unsupported platform: ${process.platform}/${process.arch}. ` +
      "Supported platforms are Linux x64/arm64, macOS x64/arm64, and Windows x64.",
  );
  process.exit(1);
}

const actionlintVersion = requiredVersions.actionlint;
const shellcheckVersion = requiredVersions.shellcheck;
const actionlintArchive = `actionlint_${actionlintVersion}_${platform.actionlint}_${architecture.actionlint}.tar.gz`;
const shellcheckArchive =
  process.platform === "win32"
    ? "shellcheck-v" + shellcheckVersion + ".zip"
    : `shellcheck-v${shellcheckVersion}.${platform.shellcheck}.${architecture.shellcheck}.${platform.shellcheckExtension}`;

const downloads = [
  {
    name: "actionlint",
    version: actionlintVersion,
    archive: actionlintArchive,
    url: `https://github.com/rhysd/actionlint/releases/download/v${actionlintVersion}/${actionlintArchive}`,
    executable: process.platform === "win32" ? "actionlint.exe" : "actionlint",
  },
  {
    name: "ShellCheck",
    version: shellcheckVersion,
    archive: shellcheckArchive,
    url: `https://github.com/koalaman/shellcheck/releases/download/v${shellcheckVersion}/${shellcheckArchive}`,
    executable: process.platform === "win32" ? "shellcheck.exe" : "shellcheck",
  },
];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function findFile(directory, fileName) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const match = findFile(entryPath, fileName);
      if (match) return match;
    } else if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
  }
  return null;
}

function extractArchive(archivePath, destination, extension) {
  const command =
    extension === "zip"
      ? process.platform === "win32"
        ? "powershell.exe"
        : "unzip"
      : "tar";
  const args =
    extension === "zip"
      ? process.platform === "win32"
        ? [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
            archivePath,
            destination,
          ]
        : ["-q", archivePath, "-d", destination]
      : extension === "tar.gz"
        ? ["-xzf", archivePath, "-C", destination]
        : ["-xJf", archivePath, "-C", destination];
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    fail(
      `Could not extract ${archivePath}: ${result.error.message}. ` +
        "Install the standard tar/unzip utilities and rerun npm run setup:workflow-lint.",
    );
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    fail(`Could not extract ${archivePath}${details ? `:\n${details}` : "."}`);
  }
}

async function download(download, destination) {
  console.log(`Downloading ${download.name} ${download.version}...`);
  let response;
  try {
    response = await fetch(download.url);
  } catch (error) {
    fail(`Could not download ${download.name}: ${error.message}`);
  }
  if (!response.ok) {
    fail(
      `Could not download ${download.name} ${download.version}: ` +
        `HTTP ${response.status} from ${download.url}`,
    );
  }
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "workflow-lint-"));
try {
  mkdirSync(installDirectory, { recursive: true });

  for (const downloadInfo of downloads) {
    const archivePath = join(temporaryDirectory, downloadInfo.archive);
    const extractionDirectory = join(
      temporaryDirectory,
      `${downloadInfo.name}-extracted`,
    );
    mkdirSync(extractionDirectory);
    await download(downloadInfo, archivePath);
    extractArchive(
      archivePath,
      extractionDirectory,
      downloadInfo.archive.endsWith(".tar.gz")
        ? "tar.gz"
        : downloadInfo.archive.endsWith(".tar.xz")
          ? "tar.xz"
          : "zip",
    );

    const extractedExecutable = findFile(
      extractionDirectory,
      downloadInfo.executable,
    );
    if (!extractedExecutable) {
      fail(
        `${downloadInfo.name} archive did not contain ${downloadInfo.executable}.`,
      );
    }

    const installedExecutable = join(
      installDirectory,
      downloadInfo.executable,
    );
    copyFileSync(extractedExecutable, installedExecutable);
    if (process.platform !== "win32") {
      chmodSync(installedExecutable, 0o755);
    }
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const installedTools = downloads
  .map((downloadInfo) => join(installDirectory, downloadInfo.executable))
  .filter((toolPath) => existsSync(toolPath));
if (installedTools.length !== downloads.length) {
  fail("One or more workflow lint tools could not be installed.");
}

console.log(
  `Installed actionlint ${actionlintVersion} and ShellCheck ${shellcheckVersion} in ${installDirectory}.`,
);
console.log(
  "Run npm run lint:workflows to verify the installed versions and lint the workflows.",
);
