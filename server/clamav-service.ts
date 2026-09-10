const CLAMAV_REST_URL = process.env.CLAMAV_REST_URL?.trim().replace(/\/+$/, "");

export type ClamAvStatus = {
  configured: boolean;
  reachable: boolean;
  message: string;
};

function unavailable(message: string): ClamAvStatus {
  return { configured: Boolean(CLAMAV_REST_URL), reachable: false, message };
}

export async function getClamAvStatus(): Promise<ClamAvStatus> {
  if (!CLAMAV_REST_URL) {
    return unavailable("ClamAV REST is not configured. Set CLAMAV_REST_URL in the deployment.");
  }
  try {
    const response = await fetch(`${CLAMAV_REST_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return unavailable(`ClamAV REST health check failed with HTTP ${response.status}.`);
    }
    return {
      configured: true,
      reachable: true,
      message: "ClamAV REST is reachable and ready for explicit file scans.",
    };
  } catch (error) {
    return unavailable(
      `ClamAV REST could not be reached: ${error instanceof Error ? error.message : "request failed"}`,
    );
  }
}

export async function scanWithClamAv(payload: Buffer) {
  if (!CLAMAV_REST_URL) {
    throw new Error("ClamAV REST is not configured. Scanning is unavailable.");
  }
  if (!payload.length) {
    throw new Error("The ClamAV scan payload is empty.");
  }
  const response = await fetch(`${CLAMAV_REST_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: payload,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ClamAV REST rejected the scan (HTTP ${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}