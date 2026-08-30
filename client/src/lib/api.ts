const configuredApiOrigin = (import.meta.env.VITE_API_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, "");

function isCapacitorLocalOrigin() {
  return (
    typeof window !== "undefined" &&
    window.location.hostname === "localhost" &&
    (window.location.protocol === "http:" || window.location.protocol === "https:")
  );
}

export function resolveApiUrl(path: string) {
  if (!path.startsWith("/api")) {
    return path;
  }

  if (configuredApiOrigin) {
    return `${configuredApiOrigin}${path}`;
  }

  if (isCapacitorLocalOrigin()) {
    throw new Error(
      "This APK does not have a backend address. Rebuild it with MOBILE_API_URL set to the HTTPS address of the SafeNet DNS server.",
    );
  }

  return path;
}

export type ApiFetchOptions = RequestInit & {
  timeoutMs?: number;
};

export async function apiFetch(
  path: string,
  { timeoutMs = 15000, signal, ...init }: ApiFetchOptions = {},
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    return await fetch(resolveApiUrl(path), {
      ...init,
      signal: controller.signal,
      credentials: init.credentials ?? "include",
    });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(
        `The SafeNet DNS server did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function getConfiguredApiOrigin() {
  return configuredApiOrigin;
}