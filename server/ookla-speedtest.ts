import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type OoklaSpeedtestErrorCode = "aborted" | "failed" | "timeout" | "unavailable";

export class OoklaSpeedtestError extends Error {
  constructor(
    message: string,
    public readonly code: OoklaSpeedtestErrorCode,
  ) {
    super(message);
    this.name = "OoklaSpeedtestError";
  }
}

export interface OoklaSpeedtestResult {
  engine: "ookla";
  timestamp: string;
  latency: number | null;
  jitter: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  packetLoss: number | null;
  isp: string | null;
  publicIp: string | null;
  server: {
    name: string | null;
    location: string | null;
    country: string | null;
  };
  resultUrl: string | null;
}

const cachedCliPath = path.join(process.cwd(), ".cache", "ookla-speedtest", "speedtest");
const defaultTimeoutMs = 90_000;

function configuredTimeoutMs() {
  const configured = Number(process.env.SPEEDTEST_CLI_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 10_000 ? configured : defaultTimeoutMs;
}

function resolveCliCommand() {
  const configured = process.env.SPEEDTEST_CLI_PATH?.trim();
  if (configured) return configured;
  if (existsSync(cachedCliPath)) return cachedCliPath;
  return "speedtest";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractJson(stdout: string) {
  const firstBrace = stdout.indexOf("{");
  const lastBrace = stdout.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new OoklaSpeedtestError("Ookla Speedtest returned no JSON result.", "failed");
  }
  try {
    return asRecord(JSON.parse(stdout.slice(firstBrace, lastBrace + 1)));
  } catch {
    throw new OoklaSpeedtestError("Ookla Speedtest returned invalid JSON.", "failed");
  }
}

function bytesPerSecondToMbps(value: unknown) {
  const bandwidth = numberValue(value);
  return bandwidth === null ? null : Number(((bandwidth * 8) / 1_000_000).toFixed(2));
}

function parseResult(stdout: string): OoklaSpeedtestResult {
  const payload = extractJson(stdout);
  const ping = asRecord(payload.ping);
  const download = asRecord(payload.download);
  const upload = asRecord(payload.upload);
  const server = asRecord(payload.server);
  const networkInterface = asRecord(payload.interface);
  const result = asRecord(payload.result);

  return {
    engine: "ookla",
    timestamp: stringValue(payload.timestamp) ?? new Date().toISOString(),
    latency: numberValue(ping.latency),
    jitter: numberValue(ping.jitter),
    downloadMbps: bytesPerSecondToMbps(download.bandwidth),
    uploadMbps: bytesPerSecondToMbps(upload.bandwidth),
    packetLoss: numberValue(payload.packetLoss),
    isp: stringValue(payload.isp),
    publicIp: stringValue(networkInterface.externalIp),
    server: {
      name: stringValue(server.name),
      location: stringValue(server.location),
      country: stringValue(server.country),
    },
    resultUrl: stringValue(result.url),
  };
}

export function runOoklaSpeedtest(signal?: AbortSignal) {
  return new Promise<OoklaSpeedtestResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OoklaSpeedtestError("The Ookla Speedtest was cancelled.", "aborted"));
      return;
    }

    const command = resolveCliCommand();
    const child = spawn(command, ["--accept-license", "--accept-gdpr", "--format=json"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SPEEDTEST_NON_INTERACTIVE: "1",
      },
    });
    const timeoutMs = configuredTimeoutMs();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: OoklaSpeedtestError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      child.kill("SIGTERM");
      fail(new OoklaSpeedtestError("The Ookla Speedtest was cancelled.", "aborted"));
    };
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      if (stdout.length < 2_000_000) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      if (stderr.length < 8_000) stderr += chunk.toString();
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        fail(new OoklaSpeedtestError(
          "Ookla Speedtest CLI is not installed on this server.",
          "unavailable",
        ));
        return;
      }
      fail(new OoklaSpeedtestError("The Ookla Speedtest could not be started.", "failed"));
    });
    child.once("close", (code) => {
      if (settled) return;
      if (timedOut) {
        fail(new OoklaSpeedtestError(
          `Ookla Speedtest timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
          "timeout",
        ));
        return;
      }
      if (signal?.aborted) {
        fail(new OoklaSpeedtestError("The Ookla Speedtest was cancelled.", "aborted"));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim().split("\n").filter(Boolean).at(-1);
        fail(new OoklaSpeedtestError(
          detail ? `Ookla Speedtest failed: ${detail}` : `Ookla Speedtest exited with code ${code ?? "unknown"}.`,
          "failed",
        ));
        return;
      }
      try {
        settled = true;
        cleanup();
        resolve(parseResult(stdout));
      } catch (error) {
        fail(error instanceof OoklaSpeedtestError
          ? error
          : new OoklaSpeedtestError("Ookla Speedtest returned an unusable result.", "failed"));
      }
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}