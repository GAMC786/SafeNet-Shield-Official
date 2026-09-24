import { tailscaleStatusSchema, type TailscaleStatus } from "@shared/tailscale";

const API_ROOT = "https://api.tailscale.com/api/v2";
const DASHBOARD_URL = "https://login.tailscale.com/admin/machines";
const CHECK_TIMEOUT_MS = 5000;
let cachedToken: { clientId: string; value: string; expiresAt: number } | null = null;
type TokenResult = { ok: true; value: string } | { ok: false; message: string };
let tokenRequest: Promise<TokenResult> | null = null;

function tailnet() {
  return process.env.TAILSCALE_TAILNET?.trim() || null;
}

async function accessToken(signal: AbortSignal) {
  const id = process.env.TAILSCALE_OAUTH_CLIENT_ID?.trim();
  const secret = process.env.TAILSCALE_OAUTH_CLIENT_SECRET?.trim();
  if (!id || !secret) return { ok: false, message: "Tailscale OAuth credentials are not configured." } as const;
  if (cachedToken?.clientId === id && cachedToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, value: cachedToken.value } as const;
  }
  if (!tokenRequest) {
    tokenRequest = fetch(`${API_ROOT}/oauth/token`, {
      method: "POST",
      signal,
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret }),
    }).then(async (response) => {
      if (!response.ok) {
        return { ok: false, message: `Tailscale OAuth rejected the client credentials (HTTP ${response.status}). Verify the client ID and secret.` } as const;
      }
      const payload = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
      if (typeof payload?.access_token !== "string") {
        return { ok: false, message: "Tailscale OAuth returned an unexpected token response." } as const;
      }
      const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) && payload.expires_in > 0
        ? payload.expires_in
        : 3_600;
      cachedToken = { clientId: id, value: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
      return { ok: true, value: payload.access_token } as const;
    }).catch((error: unknown) => ({
      ok: false as const,
      message: error instanceof Error && error.name === "AbortError"
        ? "Tailscale OAuth did not respond within 5 seconds."
        : "SafeNet could not reach the Tailscale OAuth endpoint.",
    })).finally(() => { tokenRequest = null; });
  }
  return tokenRequest;
}

type Device = Record<string, unknown>;
function devices(payload: unknown): Device[] | null {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { devices?: unknown }).devices)) return null;
  return (payload as { devices: unknown[] }).devices.filter((d): d is Device => Boolean(d && typeof d === "object"));
}
function text(device: Device, key: string) { return typeof device[key] === "string" ? device[key] as string : ""; }
function deviceName(device: Device) { return text(device, "hostname") || text(device, "name"); }
function owner(device: Device) {
  const user = device.user;
  if (typeof user === "string") return user;
  if (user && typeof user === "object") {
    const record = user as Device;
    return [text(record, "name"), text(record, "email"), text(record, "id")].find(Boolean) || "";
  }
  return "";
}
function deviceStatus(device: Device): "online" | "offline" | "unknown" {
  return typeof device.connectedToControl === "boolean" ? (device.connectedToControl ? "online" : "offline") : "unknown";
}

async function fetchDevices(signal: AbortSignal) {
  const token = await accessToken(signal);
  const network = tailnet();
  if (!token.ok) return { response: null, devices: null, tokenFailure: token.message };
  if (!network) return { response: null, devices: null, tokenFailure: null };
  const response = await fetch(`${API_ROOT}/tailnet/${encodeURIComponent(network)}/devices`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token.value}` }, signal, redirect: "manual",
  });
  if (response.status === 401) cachedToken = null;
  return { response, devices: response.ok ? devices(await response.json().catch(() => null)) : null, tokenFailure: null };
}

function base(overrides: Partial<TailscaleStatus> = {}): TailscaleStatus {
  return tailscaleStatusSchema.parse({
    configured: false, tailnet: null, dashboardUrl: DASHBOARD_URL, status: "not-configured",
    checkedAt: null, deviceCount: null, message: "Connect a Tailscale tailnet and OAuth credential to manage the private mesh.", ...overrides,
  });
}

export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  const network = tailnet();
  const configured = Boolean(network && process.env.TAILSCALE_OAUTH_CLIENT_ID?.trim() && process.env.TAILSCALE_OAUTH_CLIENT_SECRET?.trim());
  if (!configured) return base({ tailnet: network, message: "TAILSCALE_TAILNET, TAILSCALE_OAUTH_CLIENT_ID, and TAILSCALE_OAUTH_CLIENT_SECRET are required." });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const { response, devices: list, tokenFailure } = await fetchDevices(controller.signal);
    if (tokenFailure) return base({ configured: true, tailnet: network, status: "unavailable", checkedAt: new Date().toISOString(), message: tokenFailure });
    if (!response?.ok) {
      const message = response?.status === 401 || response?.status === 403
        ? `Tailscale denied device-list access (HTTP ${response.status}). Check the OAuth client's devices:core:read permission and selected tailnet.`
        : response?.status === 404
          ? "Tailscale could not find the selected tailnet. Use its tailnet name/ID or - for the OAuth client's default tailnet."
          : `Tailscale device API responded with HTTP ${response?.status ?? "an error"}.`;
      return base({ configured: true, tailnet: network, status: "unavailable", checkedAt: new Date().toISOString(), message });
    }
    if (!list) return base({ configured: true, tailnet: network, status: "unavailable", checkedAt: new Date().toISOString(), message: "Tailscale returned an unexpected device-list response." });
    return base({ configured: true, tailnet: network, status: "online", checkedAt: new Date().toISOString(), deviceCount: list.length, message: "Tailscale is reachable. The Tailscale admin console is ready for mesh administration." });
  } catch (error) {
    return base({ configured: true, tailnet: network, status: "unavailable", checkedAt: new Date().toISOString(), message: error instanceof Error && error.name === "AbortError" ? "Tailscale did not respond within 5 seconds." : "SafeNet could not reach Tailscale." });
  } finally { clearTimeout(timeout); }
}

export async function getTailscaleDeviceStatus(name: string) {
  if (!name || !tailnet()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const { response, devices: list } = await fetchDevices(controller.signal);
    if (!response?.ok || !list) return null;
    const device = list.find((candidate) => [text(candidate, "id"), text(candidate, "nodeId"), text(candidate, "name"), text(candidate, "hostname")].includes(name));
    if (!device) return null;
    return { device: { id: text(device, "id"), name: deviceName(device) || name, owner: owner(device), status: deviceStatus(device) } };
  } catch { return null; } finally { clearTimeout(timeout); }
}