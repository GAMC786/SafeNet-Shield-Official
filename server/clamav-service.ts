import {
  isLocalClamAvEnabled,
  localClamAvHeaders,
  localClamAvUrl,
} from "./clamav-local";

export type ClamAvStatus = {
  configured: boolean;
  reachable: boolean;
  verified: boolean;
  message: string;
  checkedAt: string;
  lastVerifiedAt: string | null;
  lastVerificationMessage: string | null;
  lastVerifiedEngineVersion: string | null;
  engineVersion?: string;
};

export type ClamAvScanResult = {
  verdict: "clean" | "threat" | "unknown";
  detected: boolean | null;
  threatName: string | null;
  message: string;
};

export type ClamAvVerification = {
  verified: boolean;
  verifiedAt: string;
  message: string;
  cleanScan: ClamAvScanResult | null;
  threatScan: ClamAvScanResult | null;
  engineVersion: string | null;
};

export type ClamAvVerificationRecord = ClamAvVerification & {
  endpointUrl: string;
  engineVersion: string;
};

export interface ClamAvVerificationStore {
  getClamAvVerification(): Promise<ClamAvVerificationRecord | null>;
  saveClamAvVerification(record: ClamAvVerificationRecord): Promise<void>;
}

const EICAR_TEST_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

type LocalVerification = ClamAvVerification & { endpointUrl: string };

let lastVerification: LocalVerification | null = null;

function getClamAvUrl() {
  const configuredUrl = process.env.CLAMAV_REST_URL?.trim();
  if (!configuredUrl) {
    return isLocalClamAvEnabled() ? localClamAvUrl() : null;
  }

  try {
    const url = new URL(configuredUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function requestHeaders(url: string) {
  return url === localClamAvUrl()
    ? localClamAvHeaders()
    : {};
}

function unavailable(
  message: string,
  verification: ClamAvVerificationRecord | LocalVerification | null,
  configured = Boolean(process.env.CLAMAV_REST_URL?.trim()),
): ClamAvStatus {
  return {
    configured,
    reachable: false,
    verified: false,
    message,
    checkedAt: new Date().toISOString(),
    lastVerifiedAt: verification?.verifiedAt ?? null,
    lastVerificationMessage: verification?.message ?? null,
    lastVerifiedEngineVersion: verification?.engineVersion ?? null,
  };
}

function responseMessage(body: unknown) {
  if (typeof body === "string") return body.trim();
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  for (const key of ["message", "status", "result", "scan_result", "version", "clamav_version"]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key].trim();
    }
  }
  return "";
}

function parseScanResponse(body: unknown): ClamAvScanResult {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const nested = record.result && typeof record.result === "object"
    ? record.result as Record<string, unknown>
    : {};
  const source = { ...record, ...nested };
  const text = [
    typeof body === "string" ? body : "",
    source.message,
    source.status,
    typeof source.result === "string" ? source.result : "",
    source.scan_result,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .trim();
  const resultThreatName = typeof source.result === "string" && !/^(?:OK|clean)$/i.test(source.result.trim())
    ? source.result.replace(/^.*:\s*/, "").replace(/\s+(?:FOUND|detected)$/i, "").trim()
    : null;
  const detectedValue = source.infected ?? source.is_infected ?? source.detected ?? source.threat;
  const detected = typeof detectedValue === "boolean"
    ? detectedValue
    : typeof detectedValue === "number"
      ? detectedValue !== 0
      : typeof detectedValue === "string"
        ? /^(true|yes|infected|found|threat|malicious)$/i.test(detectedValue.trim())
        : null;
  const threatCandidates = [
    source.threatName,
    source.threat_name,
    source.signature,
    source.virus,
    source.virusName,
    source.name,
    resultThreatName,
    ...(Array.isArray(source.viruses) ? source.viruses : []),
    ...(Array.isArray(source.threats) ? source.threats : []),
  ];
  const threatName = threatCandidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  )?.trim() ?? null;
  const message = responseMessage(body) || text;
  const textIndicatesThreat = /(?:FOUND|infected|malware|virus|threat)/i.test(text);
  const textIndicatesClean = /(?:OK|clean|no threat|not infected)/i.test(text);
  const finalDetected = detected ?? (textIndicatesThreat ? true : textIndicatesClean ? false : null);

  return {
    verdict: finalDetected === true ? "threat" : finalDetected === false ? "clean" : "unknown",
    detected: finalDetected,
    threatName,
    message: message || "ClamAV returned an unrecognized scan response.",
  };
}

async function requestHealth(url: string) {
  const response = await fetch(`${url}/health`, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain",
      ...requestHeaders(url),
    },
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Some clamd REST wrappers return a plain-text health response.
  }
  if (!response.ok) {
    throw new Error(`ClamAV REST health check failed with HTTP ${response.status}.`);
  }
  const engineVersion = body && typeof body === "object"
    ? (body as Record<string, unknown>).version ?? (body as Record<string, unknown>).clamav_version
    : undefined;
  return {
    body,
    message: responseMessage(body),
    engineVersion: typeof engineVersion === "string" && engineVersion.trim()
      ? engineVersion.trim()
      : null,
  };
}

async function readVerification(store?: ClamAvVerificationStore) {
  return store ? store.getClamAvVerification() : lastVerification;
}

function isCurrentVerification(
  verification: ClamAvVerificationRecord | LocalVerification | null,
  url: string,
  engineVersion: string | null,
) {
  return Boolean(
    verification?.verified &&
    verification.endpointUrl === url &&
    engineVersion &&
    verification.engineVersion === engineVersion,
  );
}

export async function getClamAvStatus(store?: ClamAvVerificationStore): Promise<ClamAvStatus> {
  let verification: ClamAvVerificationRecord | LocalVerification | null = null;
  let verificationReadError: unknown = null;
  try {
    verification = await readVerification(store);
  } catch (error) {
    verificationReadError = error;
  }

  const url = getClamAvUrl();
  if (!url) {
    return unavailable(
      process.env.CLAMAV_REST_URL?.trim()
        ? "ClamAV REST configuration is invalid. Set CLAMAV_REST_URL to an http(s) URL without embedded credentials."
        : "ClamAV REST is not configured. Set CLAMAV_REST_URL in the deployment.",
      verification,
      false,
    );
  }
  try {
    const { engineVersion } = await requestHealth(url);
    const verified = !verificationReadError && isCurrentVerification(verification, url, engineVersion);
    const message = verificationReadError
      ? "ClamAV REST is reachable, but shared verification evidence could not be read."
      : verified
        ? "ClamAV REST is reachable and verified for explicit file scans."
        : verification && verification.endpointUrl === url && verification.engineVersion !== engineVersion
          ? "ClamAV REST is reachable, but its stored proof is stale for the current engine version."
          : engineVersion
            ? "ClamAV REST is reachable, but its clean and threat scan proof has not been verified for this engine."
            : "ClamAV REST is reachable, but it did not report an engine version that can validate shared proof.";
    return {
      configured: true,
      reachable: true,
      verified,
      message,
      checkedAt: new Date().toISOString(),
      lastVerifiedAt: verification?.verifiedAt ?? null,
      lastVerificationMessage: verification?.message ?? null,
      lastVerifiedEngineVersion: verification?.engineVersion ?? null,
      ...(engineVersion ? { engineVersion } : {}),
    };
  } catch (error) {
    return unavailable(
      `ClamAV REST could not be reached: ${error instanceof Error ? error.message : "request failed"}`,
      verification,
      true,
    );
  }
}

async function scanRequest(url: string, payload: Buffer): Promise<ClamAvScanResult> {
  const response = await fetch(`${url}/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      Accept: "application/json, text/plain",
      ...requestHeaders(url),
    },
    body: payload,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // The result parser also supports plain-text clamd responses.
  }
  if (!response.ok) {
    throw new Error(`ClamAV REST rejected the scan (HTTP ${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return parseScanResponse(body);
}

export async function scanWithClamAv(
  payload: Buffer,
  store?: ClamAvVerificationStore,
): Promise<ClamAvScanResult> {
  const url = getClamAvUrl();
  if (!url) {
    throw new Error("ClamAV REST is not configured. Scanning is unavailable.");
  }
  if (!payload.length) {
    throw new Error("The ClamAV scan payload is empty.");
  }
  let verification: ClamAvVerificationRecord | LocalVerification | null = null;
  try {
    verification = await readVerification(store);
  } catch {
    throw new Error("ClamAV shared verification evidence could not be read. Scanning is unavailable.");
  }
  const { engineVersion } = await requestHealth(url);
  if (!isCurrentVerification(verification, url, engineVersion)) {
    throw new Error("ClamAV REST is not verified. Run the clean-file and EICAR threat proof before scanning for protection.");
  }
  return scanRequest(url, payload);
}

export async function verifyClamAv(store?: ClamAvVerificationStore): Promise<ClamAvVerification> {
  const url = getClamAvUrl();
  const verifiedAt = new Date().toISOString();
  if (!url) {
    throw new Error("ClamAV REST is not configured. Set CLAMAV_REST_URL in the deployment.");
  }

  try {
    const { engineVersion } = await requestHealth(url);
    const cleanScan = await scanRequest(url, Buffer.from("SafeNet ClamAV verification: clean fixture."));
    const threatScan = await scanRequest(url, Buffer.from(EICAR_TEST_SIGNATURE));
    const finalHealth = await requestHealth(url);
    const engineStable = Boolean(
      engineVersion &&
      finalHealth.engineVersion &&
      engineVersion === finalHealth.engineVersion,
    );
    const verified = cleanScan.verdict === "clean" &&
      threatScan.verdict === "threat" &&
      engineStable;
    const message = verified
      ? "ClamAV health, clean-file, and EICAR threat checks passed."
      : !engineStable
        ? "ClamAV engine version changed or was not reported consistently during verification."
      : "ClamAV is reachable, but the clean-file and EICAR threat checks did not produce the expected results.";
    const result = { verified, verifiedAt, message, cleanScan, threatScan, engineVersion };
    lastVerification = { ...result, endpointUrl: url };
    if (verified && store && engineVersion) {
      await store.saveClamAvVerification({
        ...result,
        endpointUrl: url,
        engineVersion,
      });
    }
    return result;
  } catch (error) {
    lastVerification = {
      verified: false,
      verifiedAt,
      message: error instanceof Error ? error.message : "ClamAV verification failed.",
      cleanScan: null,
      threatScan: null,
      engineVersion: null,
      endpointUrl: url,
    };
    throw error;
  }
}