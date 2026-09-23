import { headscaleStatusSchema, type HeadscaleStatus } from "@shared/headscale";

const CHECK_TIMEOUT_MS = 5000;

function getConfiguredUrl(name: "HEADSCALE_URL" | "HEADPLANE_URL") {
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

function baseStatus(overrides: Partial<HeadscaleStatus> = {}): HeadscaleStatus {
  return headscaleStatusSchema.parse({
    configured: false,
    headscaleUrl: null,
    headplaneUrl: null,
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
  if (!headscaleUrl || !headplaneUrl) {
    return baseStatus({ headscaleUrl, headplaneUrl });
  }

  const apiKey = process.env.HEADSCALE_API_KEY?.trim();
  if (!apiKey) {
    return baseStatus({
      headscaleUrl,
      headplaneUrl,
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