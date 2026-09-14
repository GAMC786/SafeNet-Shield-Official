import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LOCAL_MODE = "true";
const DEFAULT_PORT = 3310;
const MAX_SCAN_BYTES = 64 * 1024 * 1024;

let clamdProcess: ChildProcess | null = null;
let readyPromise: Promise<void> | null = null;
const requestToken = randomBytes(32).toString("hex");

function stateDirectory() {
  return process.env.CLAMAV_STATE_DIR?.trim() || path.join(os.tmpdir(), "safenet-clamav");
}

function databaseDirectory() {
  return path.join(stateDirectory(), "database");
}

function clamdConfigPath() {
  return path.join(stateDirectory(), "clamd.conf");
}

function freshclamConfigPath() {
  return path.join(stateDirectory(), "freshclam.conf");
}

function port() {
  const configured = Number.parseInt(process.env.CLAMAV_LOCAL_PORT ?? "", 10);
  return Number.isInteger(configured) && configured > 0 && configured < 65536
    ? configured
    : DEFAULT_PORT;
}

export function isLocalClamAvEnabled() {
  return process.env.CLAMAV_LOCAL_MODE?.trim().toLowerCase() === LOCAL_MODE;
}

export function localClamAvUrl() {
  return `http://127.0.0.1:${process.env.PORT || "5000"}/internal/clamav`;
}

export function localClamAvHeaders() {
  return { "x-safenet-clamav-token": requestToken };
}

export function isAuthorizedLocalClamAvRequest(value: string | undefined) {
  return isLocalClamAvEnabled() && value === requestToken;
}

async function writeConfigs() {
  await mkdir(databaseDirectory(), { recursive: true });
  await writeFile(
    clamdConfigPath(),
    [
      `DatabaseDirectory ${databaseDirectory()}`,
      "Foreground yes",
      `TCPSocket ${port()}`,
      `TCPAddr 127.0.0.1`,
      "MaxScanSize 64M",
      "StreamMaxLength 64M",
      "MaxFileSize 64M",
      "MaxScanTime 120000",
      "",
    ].join("\n"),
  );
  await writeFile(
    freshclamConfigPath(),
    [
      `DatabaseDirectory ${databaseDirectory()}`,
      "DatabaseMirror database.clamav.net",
      "Checks 12",
      "Foreground yes",
      "",
    ].join("\n"),
  );
}

async function refreshSignatures() {
  try {
    await execFileAsync("freshclam", ["--config-file", freshclamConfigPath()], {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "freshclam failed";
    if (!/up to date|database is up-to-date/i.test(message)) {
      throw new Error(`ClamAV signatures could not be refreshed: ${message.slice(0, 300)}`);
    }
  }
}

function startDaemon() {
  if (clamdProcess && clamdProcess.exitCode === null && !clamdProcess.killed) {
    return;
  }
  clamdProcess = spawn("clamd", ["--config-file", clamdConfigPath()], {
    stdio: "ignore",
    detached: false,
  });
  clamdProcess.unref();
  clamdProcess.once("exit", () => {
    clamdProcess = null;
  });
}

async function waitForDaemon() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port: port() }, () => {
          socket.end();
          resolve();
        });
        socket.once("error", reject);
        socket.setTimeout(500, () => {
          socket.destroy();
          reject(new Error("ClamAV daemon connection timed out."));
        });
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("ClamAV daemon did not become ready.");
}

async function initialize() {
  await writeConfigs();
  await refreshSignatures();
  startDaemon();
  await waitForDaemon();
}

export async function startLocalClamAv() {
  if (!isLocalClamAvEnabled()) return;
  await ensureLocalClamAvReady();
}

export async function ensureLocalClamAvReady() {
  if (!isLocalClamAvEnabled()) {
    throw new Error("Local ClamAV mode is not enabled.");
  }
  if (!readyPromise) {
    readyPromise = initialize().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  await readyPromise;
}

export async function localClamAvHealth() {
  await ensureLocalClamAvReady();
  const { stdout } = await execFileAsync(
    "clamdscan",
    ["--config-file", clamdConfigPath(), "--version"],
    {
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    },
  );
  return {
    status: "ok",
    version: stdout.trim() || "ClamAV",
  };
}

export async function scanWithLocalClamAv(payload: Buffer) {
  if (!payload.length) {
    throw new Error("The ClamAV scan payload is empty.");
  }
  if (payload.length > MAX_SCAN_BYTES) {
    throw new Error("The ClamAV scan payload exceeds the 64 MB limit.");
  }

  await ensureLocalClamAvReady();
  const directory = await mkdtemp(path.join(os.tmpdir(), "safenet-clamav-scan-"));
  const filePath = path.join(directory, "payload.bin");
  try {
    await writeFile(filePath, payload);
    try {
      const { stdout, stderr } = await execFileAsync(
        "clamdscan",
        ["--config-file", clamdConfigPath(), "--fdpass", "--no-summary", filePath],
        { timeout: 120_000, maxBuffer: 256 * 1024 },
      );
      return {
        status: "OK",
        detected: false,
        result: stdout.trim() || "OK",
      };
    } catch (error) {
      const processError = error as NodeJS.ErrnoException & {
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      const output = `${processError.stdout ?? ""}\n${processError.stderr ?? ""}`.trim();
      if (Number(processError.code) === 1 || /FOUND|Eicar-Test-Signature/i.test(output)) {
        return {
          status: "FOUND",
          detected: true,
          result: output || "Threat detected",
        };
      }
      throw new Error(`ClamAV scan failed: ${(output || processError.message || "unknown error").slice(0, 300)}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}