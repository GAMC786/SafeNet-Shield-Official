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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);
const installDirectory = join(
  repositoryRoot,
  ".tools",
  "workflow-lint",
);

export function getRequiredVersions(manifest) {
  const versions = manifest?.workflowLint;
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

export function getPlatformConfiguration(
  platformName = process.platform,
  architectureName = process.arch,
) {
  const architecture = {
    x64: {
      actionlint: "amd64",
      shellcheck: "x86_64",
    },
    arm64: {
      actionlint: "arm64",
      shellcheck: "aarch64",
    },
  }[architectureName];
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
  }[platformName];

  if (
    !platform ||
    !architecture ||
    (platformName === "win32" && architectureName !== "x64")
  ) {
    throw new Error(
      `Unsupported platform: ${platformName}/${architectureName}. ` +
        "Supported platforms are Linux x64/arm64, macOS x64/arm64, and Windows x64.",
    );
  }

  return { platform, architecture };
}

export function getDownloads({
  platformName = process.platform,
  architectureName = process.arch,
  versions = getRequiredVersions(packageManifest),
} = {}) {
  const { platform, architecture } = getPlatformConfiguration(
    platformName,
    architectureName,
  );
  const actionlintArchive = `actionlint_${versions.actionlint}_${platform.actionlint}_${architecture.actionlint}.tar.gz`;
  const shellcheckArchive =
    platformName === "win32"
      ? `shellcheck-v${versions.shellcheck}.zip`
      : `shellcheck-v${versions.shellcheck}.${platform.shellcheck}.${architecture.shellcheck}.${platform.shellcheckExtension}`;

  return [
    {
      name: "actionlint",
      version: versions.actionlint,
      archive: actionlintArchive,
      url: `https://github.com/rhysd/actionlint/releases/download/v${versions.actionlint}/${actionlintArchive}`,
      executable: platformName === "win32" ? "actionlint.exe" : "actionlint",
    },
    {
      name: "ShellCheck",
      version: versions.shellcheck,
      archive: shellcheckArchive,
      url: `https://github.com/koalaman/shellcheck/releases/download/v${versions.shellcheck}/${shellcheckArchive}`,
      executable: platformName === "win32" ? "shellcheck.exe" : "shellcheck",
    },
  ];
}

function fail(message) {
  throw new Error(message);
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

export function extractArchive(
  archivePath,
  destination,
  extension,
  { platformName = process.platform, spawn = spawnSync } = {},
) {
  const command =
    extension === "zip"
      ? platformName === "win32"
        ? "powershell.exe"
        : "unzip"
      : "tar";
  const args =
    extension === "zip"
      ? platformName === "win32"
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
  const result = spawn(command, args, { encoding: "utf8" });
  if (result.error) {
    fail(
      `Could not extract ${archivePath}: ${result.error.message}. ` +
        "Install the standard tar/unzip utilities (or PowerShell on Windows) and rerun npm run setup:workflow-lint.",
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

async function main() {
  const requiredVersions = getRequiredVersions(packageManifest);
  const downloads = getDownloads({
    platformName: process.platform,
    architectureName: process.arch,
    versions: requiredVersions,
  });
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
    `Installed actionlint ${requiredVersions.actionlint} and ShellCheck ${requiredVersions.shellcheck} in ${installDirectory}.`,
  );
  console.log(
    "Run npm run lint:workflows to verify the installed versions and lint the workflows.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
