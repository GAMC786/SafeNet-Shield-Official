import { readFile } from "node:fs/promises";
import { wgEasyStatusSchema, type WgEasyStatus } from "@shared/wg-easy";

const CHECK_TIMEOUT_MS = 5000;
const DEFAULT_TUNNEL_MESSAGE =
  "The admin UI check does not prove UDP connectivity. Run the disposable-peer verifier on the WG-Easy host.";

function getConfiguredUrl() {
  const value = process.env.WG_EASY_URL?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function baseStatus(overrides: Partial<WgEasyStatus> = {}): WgEasyStatus {
  return wgEasyStatusSchema.parse({
    configured: false,
    adminUrl: null,
    wireguardEndpoint: process.env.WG_EASY_WIREGUARD_ENDPOINT?.trim() || null,
    status: "not-configured",
    checkedAt: null,
    message: "Connect a WG-Easy host to enable the VPN administration panel.",
    tunnelVerification: {
      status: "not-run",
      checkedAt: null,
      peerCreated: false,
      peerDeleted: false,
      peerHandshakeAt: null,
      hostHandshakeAt: null,
      message: DEFAULT_TUNNEL_MESSAGE,
    },
    ...overrides,
  });
}

async function getTunnelVerification() {
  const resultFile = process.env.WG_EASY_TUNNEL_RESULT_FILE?.trim();
  if (!resultFile) {
    return baseStatus().tunnelVerification;
  }

  try {
    const result = JSON.parse(await readFile(resultFile, "utf8"));
    return wgEasyStatusSchema.shape.tunnelVerification.parse(result);
  } catch {
    return baseStatus({
      tunnelVerification: {
        status: "failed",
        checkedAt: null,
        peerCreated: false,
        peerDeleted: false,
        peerHandshakeAt: null,
        hostHandshakeAt: null,
        message: "The WireGuard tunnel evidence file could not be read or was invalid.",
      },
    }).tunnelVerification;
  }
}

export async function getWgEasyStatus(): Promise<WgEasyStatus> {
  const tunnelVerification = await getTunnelVerification();
  const adminUrl = getConfiguredUrl();
  if (!adminUrl) {
    return baseStatus({
      tunnelVerification,
      ...(process.env.WG_EASY_URL
        ? { message: "WG_EASY_URL must be an HTTP or HTTPS URL without embedded credentials." }
        : {}),
    });
  }

  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(adminUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const reachable = response.status < 500;
    return baseStatus({
      configured: true,
      adminUrl,
      tunnelVerification,
      status: reachable ? "online" : "unavailable",
      checkedAt,
      message: reachable
        ? "WG-Easy admin UI is reachable. UDP tunnel connectivity is reported separately."
        : `WG-Easy responded with HTTP ${response.status}. Check the host and reverse proxy.`,
    });
  } catch (error) {
    return baseStatus({
      configured: true,
      adminUrl,
      tunnelVerification,
      status: "unavailable",
      checkedAt,
      message: error instanceof Error && error.name === "AbortError"
        ? "WG-Easy did not respond within 5 seconds."
        : "SafeNet could not reach the configured WG-Easy host.",
    });
  } finally {
    clearTimeout(timeout);
  }
}