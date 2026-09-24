import { tailscaleStatusSchema, type TailscaleStatus } from "@shared/tailscale";

const API_ROOT = "https://api.tailscale.com/api/v2";
const DASHBOARD_URL = "https://login.tailscale.com/admin/machines";
const CHECK_TIMEOUT_MS = 5000;
let cachedToken: { value: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string | null> | null = null;

function tailnet() {
  return process.env.TAILSCALE_TAILNET?.trim() || null;
}

function basic(value: string) {
  return `Basic ${Buffer.from(value).toString("base64")}`;
}

async function accessToken(signal: AbortSignal) {
  const id = process.env.TAILSCALE_OAUTH_CLIENT_ID?.trim();
  const secret = process.env.TAILSCALE_OAUTH_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (!tokenRequest) {
    tokenRequest = fetch(`${API_ROOT}/oauth/token`, {
      method: "POST",
      signal,
      headers: { Accept: "application/json", Authorization: basic(`${id}:${secret}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "devices:core:read" }),
    }).then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
      if (typeof payload?.access_token !== "string") return null;
      const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) && payload.expires_in > 0
        ? payload.expires_in
        : 3_600;
      cachedToken = { value: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
      return payload.access_token;
    }).catch(() => null).finally(() => { tokenRequest = null; });
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
  if (!token || !network) return { response: null, devices: [] as Device[] };
  const response = await fetch(`${API_ROOT}/tailnet/${encodeURIComponent(network)}/devices`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal, redirect: "manual",
  });
  if (response.status === 401) cachedToken = null;
  return { response, devices: response.ok ? devices(await response.json().catch(() => null)) : null };
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
    const { response, devices: list } = await fetchDevices(controller.signal);
    if (!response?.ok) return base({ configured: true, tailnet: network, status: "unavailable", checkedAt: new Date().toISOString(), message: response?.status === 401 || response?.status === 403 ? "Tailscale rejected the OAuth credential." : `Tailscale responded with HTTP ${response?.status ?? "an error"}.` });
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