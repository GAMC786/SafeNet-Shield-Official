import { headscaleStatusSchema, type HeadscaleStatus } from "@shared/headscale";

const CHECK_TIMEOUT_MS = 5000;
const NODE_STATUS_TIMEOUT_MS = 5000;

function getConfiguredUrl(
  name: "HEADSCALE_URL" | "HEADPLANE_URL" | "HEADPLANE_NODE_API_URL",
) {
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

function getNodeCount(payload: unknown) {
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === "object" && Array.isArray((payload as { nodes?: unknown }).nodes)) {
    return (payload as { nodes: unknown[] }).nodes.length;
  }
  return null;
}

function getNodes(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray((payload as { nodes?: unknown }).nodes)) {
    return (payload as { nodes: unknown[] }).nodes;
  }
  return [];
}

function getNodeOwner(node: Record<string, unknown>) {
  const user = node.user;
  if (typeof user === "string") return user;
  if (user && typeof user === "object") {
    const record = user as { name?: unknown; displayName?: unknown; id?: unknown };
    return [record.name, record.displayName, record.id].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    ) ?? "";
  }
  return "";
}

export async function getHeadscaleNodeStatus(nodeName: string) {
  const headscaleUrl = getConfiguredUrl("HEADSCALE_URL");
  const apiKey = process.env.HEADSCALE_API_KEY?.trim();
  if (!headscaleUrl || !apiKey || !nodeName) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NODE_STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(`${headscaleUrl}/api/v1/node`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const node = getNodes(payload).find((candidate): candidate is Record<string, unknown> => {
      if (!candidate || typeof candidate !== "object") return false;
      const record = candidate as Record<string, unknown>;
      return [record.name, record.hostname, record.givenName].some((value) => value === nodeName);
    });
    if (!node) return null;

    const owner = getNodeOwner(node);
    const online = node.online === true;
    return {
      node: {
        name: typeof node.name === "string" ? node.name : nodeName,
        visibility: "visible" as const,
        owner,
        status: online ? "online" as const : "offline" as const,
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function baseStatus(overrides: Partial<HeadscaleStatus> = {}): HeadscaleStatus {
  return headscaleStatusSchema.parse({
    configured: false,
    headscaleUrl: null,
    headplaneUrl: null,
    headplaneNodeApiConfigured: false,
    status: "not-configured",
    checkedAt: null,
    nodeCount: null,
    message: "Connect a Headscale control server and Headplane UI to manage the private mesh.",
    ...overrides,
  });
}

export async function getHeadscaleStatus(): Promise<HeadscaleStatus> {
  const headscaleUrl = getConfiguredUrl("HEADSCALE_URL");
  const headplaneUrl = getConfiguredUrl("HEADPLANE_URL");
  const headplaneNodeApiUrl = getConfiguredUrl("HEADPLANE_NODE_API_URL");
  const headplaneNodeApiToken = process.env.HEADPLANE_NODE_API_TOKEN?.trim();
  const headplaneNodeApiConfigured = Boolean(headplaneNodeApiUrl && headplaneNodeApiToken);

  if (process.env.HEADSCALE_URL && !headscaleUrl) {
    return baseStatus({
      message: "HEADSCALE_URL must be an HTTP or HTTPS URL without embedded credentials.",
    });
  }
  if (process.env.HEADPLANE_URL && !headplaneUrl) {
    return baseStatus({
      headscaleUrl,
      message: "HEADPLANE_URL must be an HTTP or HTTPS URL without embedded credentials.",
    });
  }
  if (process.env.HEADPLANE_NODE_API_URL && !headplaneNodeApiUrl) {
    return baseStatus({
      headscaleUrl,
      headplaneUrl,
      message: "HEADPLANE_NODE_API_URL must be an HTTP or HTTPS URL without embedded credentials.",
    });
  }
  if (!headscaleUrl || !headplaneUrl) {
    return baseStatus({
      headscaleUrl,
      headplaneUrl,
      headplaneNodeApiConfigured,
    });
  }

  const apiKey = process.env.HEADSCALE_API_KEY?.trim();
  if (!apiKey) {
    return baseStatus({
      headscaleUrl,
      headplaneUrl,
      headplaneNodeApiConfigured,
      message: "Headscale URLs are configured, but HEADSCALE_API_KEY is missing.",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${headscaleUrl}/api/v1/node`, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) {
      return baseStatus({
        configured: true,
        headscaleUrl,
        headplaneUrl,
        headplaneNodeApiConfigured,
        status: "unavailable",
        checkedAt: new Date().toISOString(),
        message: response.status === 401 || response.status === 403
          ? "Headscale rejected the API key. Create a valid Headscale API key."
          : `Headscale responded with HTTP ${response.status}. Check the control server and reverse proxy.`,
      });
    }

    const payload = await response.json().catch(() => null);
    return baseStatus({
      configured: true,
      headscaleUrl,
      headplaneUrl,
      headplaneNodeApiConfigured,
      status: "online",
      checkedAt: new Date().toISOString(),
      nodeCount: getNodeCount(payload),
      message: "Headscale control plane is reachable. Headplane is ready for mesh administration.",
    });
  } catch (error) {
    return baseStatus({
      configured: true,
      headscaleUrl,
      headplaneUrl,
      headplaneNodeApiConfigured,
      status: "unavailable",
      checkedAt: new Date().toISOString(),
      message: error instanceof Error && error.name === "AbortError"
        ? "Headscale did not respond within 5 seconds."
        : "SafeNet could not reach the configured Headscale control server.",
    });
  } finally {
    clearTimeout(timeout);
  }
}