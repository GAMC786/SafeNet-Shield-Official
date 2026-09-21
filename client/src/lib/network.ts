export type NetworkJsonRequestOptions = RequestInit & {
  timeoutMs?: number;
};

export async function fetchJsonWithTimeout<T>(
  url: string,
  { timeoutMs = 7000, signal, ...init }: NetworkJsonRequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as T | { message?: string } | null;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `Network request returned HTTP ${response.status}.`;
      throw new Error(message);
    }
    return payload as T;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`The network request did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function getPublicIp(signal?: AbortSignal): Promise<{ ip: string }> {
  const providers = [
    "https://api.ipify.org?format=json",
    "https://ipwho.is/",
    "https://ipapi.co/json/",
  ];
  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      const payload = await fetchJsonWithTimeout<Record<string, unknown>>(provider, {
        cache: "no-store",
        signal,
        timeoutMs: 5000,
      });
      if (typeof payload.ip === "string" && payload.ip.trim()) {
        return { ip: payload.ip.trim() };
      }
      throw new Error("The public-IP provider returned no usable address.");
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error("Public-IP lookup failed.");
    }
  }

  throw lastError ?? new Error("No public-IP provider could be reached.");
}