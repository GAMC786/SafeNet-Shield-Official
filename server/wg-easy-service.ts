import { wgEasyStatusSchema, type WgEasyStatus } from "@shared/wg-easy";

const CHECK_TIMEOUT_MS = 5000;

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
    ...overrides,
  });
}

export async function getWgEasyStatus(): Promise<WgEasyStatus> {
  const adminUrl = getConfiguredUrl();
  if (!adminUrl) {
    return baseStatus({
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
      status: reachable ? "online" : "unavailable",
      checkedAt,
      message: reachable
        ? "WG-Easy is reachable. Use its web UI to manage peers and the WireGuard server."
        : `WG-Easy responded with HTTP ${response.status}. Check the host and reverse proxy.`,
    });
  } catch (error) {
    return baseStatus({
      configured: true,
      adminUrl,
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