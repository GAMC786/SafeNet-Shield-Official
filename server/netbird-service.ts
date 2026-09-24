import { netbirdStatusSchema, type NetBirdStatus } from "@shared/netbird";

const CHECK_TIMEOUT_MS = 5000;

function getConfiguredUrl(name: "NETBIRD_MANAGEMENT_URL" | "NETBIRD_DASHBOARD_URL") {
  const value = process.env[name]?.trim();
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

function getPeers(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (payload && typeof payload === "object" && Array.isArray((payload as { peers?: unknown }).peers)) {
    return (payload as { peers: unknown[] }).peers.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  }
  return [];
}

function owner(peer: Record<string, unknown>) {
  const value = peer.user ?? peer.owner ?? peer.user_id;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record.name, record.email, record.id].find((item): item is string => typeof item === "string" && item.length > 0) ?? "";
  }
  return "";
}

function peerName(peer: Record<string, unknown>) {
  return typeof peer.name === "string" ? peer.name : typeof peer.hostname === "string" ? peer.hostname : "";
}

function peerId(peer: Record<string, unknown>) {
  return typeof peer.id === "string" ? peer.id : "";
}

function peerOnline(peer: Record<string, unknown>) {
  if (typeof peer.connected === "boolean") return peer.connected;
  return peer.online === true || peer.status === "online";
}

async function fetchPeers(managementUrl: string, token: string, signal: AbortSignal) {
  const response = await fetch(`${managementUrl}/api/peers`, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { Accept: "application/json", Authorization: `Token ${token}` },
  });
  if (!response.ok) return { response, peers: [] as Record<string, unknown>[] };
  return { response, peers: getPeers(await response.json().catch(() => null)) };
}

function baseStatus(overrides: Partial<NetBirdStatus> = {}): NetBirdStatus {
  return netbirdStatusSchema.parse({
    configured: false,
    managementUrl: null,
    dashboardUrl: null,
    status: "not-configured",
    checkedAt: null,
    peerCount: null,
    message: "Connect a NetBird management server and dashboard to manage the private mesh.",
    ...overrides,
  });
}

export async function getNetBirdStatus(): Promise<NetBirdStatus> {
  const managementUrl = getConfiguredUrl("NETBIRD_MANAGEMENT_URL");
  const dashboardUrl = getConfiguredUrl("NETBIRD_DASHBOARD_URL");
  if (process.env.NETBIRD_MANAGEMENT_URL && !managementUrl) {
    return baseStatus({ message: "NETBIRD_MANAGEMENT_URL must be an HTTP or HTTPS URL without embedded credentials." });
  }
  if (process.env.NETBIRD_DASHBOARD_URL && !dashboardUrl) {
    return baseStatus({ managementUrl, message: "NETBIRD_DASHBOARD_URL must be an HTTP or HTTPS URL without embedded credentials." });
  }
  if (!managementUrl || !dashboardUrl) return baseStatus({ managementUrl, dashboardUrl });
  const token = process.env.NETBIRD_API_TOKEN?.trim();
  if (!token) return baseStatus({ managementUrl, dashboardUrl, message: "NetBird URLs are configured, but NETBIRD_API_TOKEN is missing." });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const { response, peers } = await fetchPeers(managementUrl, token, controller.signal);
    if (!response.ok) {
      return baseStatus({
        configured: true, managementUrl, dashboardUrl, status: "unavailable",
        checkedAt: new Date().toISOString(),
        message: response.status === 401 || response.status === 403
          ? "NetBird rejected the API token. Create a valid NetBird API token."
          : `NetBird responded with HTTP ${response.status}. Check the management server and reverse proxy.`,
      });
    }
    return baseStatus({
      configured: true, managementUrl, dashboardUrl, status: "online",
      checkedAt: new Date().toISOString(), peerCount: peers.length,
      message: "NetBird management server is reachable. NetBird Dashboard is ready for mesh administration.",
    });
  } catch (error) {
    return baseStatus({
      configured: true, managementUrl, dashboardUrl, status: "unavailable",
      checkedAt: new Date().toISOString(),
      message: error instanceof Error && error.name === "AbortError"
        ? "NetBird did not respond within 5 seconds."
        : "SafeNet could not reach the configured NetBird management server.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getNetBirdPeerStatus(name: string) {
  const managementUrl = getConfiguredUrl("NETBIRD_MANAGEMENT_URL");
  const token = process.env.NETBIRD_API_TOKEN?.trim();
  if (!managementUrl || !token || !name) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const { response, peers } = await fetchPeers(managementUrl, token, controller.signal);
    if (!response.ok) return null;
    const peer = peers.find((candidate) => [peerName(candidate), peerId(candidate), candidate.hostname].some((value) => value === name));
    if (!peer) return null;
    return { peer: { id: peerId(peer), name: peerName(peer) || name, owner: owner(peer), status: peerOnline(peer) ? "online" as const : "offline" as const } };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}