export type SafeNetRuntimeConfig = {
  clerkPublishableKey: string;
  clerkProxyUrl?: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export type RuntimeConfigEnvironment = {
  DEV: boolean;
  VITE_API_URL?: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string;
  VITE_CLERK_PROXY_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_DEVELOPMENT_URL?: string;
  VITE_SUPABASE_DEVELOPMENT_PUBLISHABLE_KEY?: string;
};

declare global {
  interface Window {
    __SAFENET_RUNTIME_CONFIG__?: SafeNetRuntimeConfig;
  }
}

type RuntimeConfigResponse = Partial<SafeNetRuntimeConfig>;
type RuntimeConfigFetch = (input: string, init?: RequestInit) => Promise<Response>;

function clean(value?: string) {
  return value?.trim() || "";
}

function isComplete(config: RuntimeConfigResponse): config is SafeNetRuntimeConfig {
  return Boolean(
    clean(config.clerkPublishableKey)
      && clean(config.supabaseUrl)
      && clean(config.supabasePublishableKey),
  );
}

export async function loadSafeNetRuntimeConfig(
  environment: RuntimeConfigEnvironment,
  options: {
    origin: string;
    fetcher?: RuntimeConfigFetch;
  },
): Promise<SafeNetRuntimeConfig> {
  const staticConfig: RuntimeConfigResponse = {
    clerkPublishableKey: clean(environment.VITE_CLERK_PUBLISHABLE_KEY),
    clerkProxyUrl: clean(environment.VITE_CLERK_PROXY_URL),
    supabaseUrl: clean(
      environment.DEV
        ? environment.VITE_SUPABASE_DEVELOPMENT_URL
        : environment.VITE_SUPABASE_URL,
    ),
    supabasePublishableKey: clean(
      environment.DEV
        ? environment.VITE_SUPABASE_DEVELOPMENT_PUBLISHABLE_KEY
        : environment.VITE_SUPABASE_PUBLISHABLE_KEY,
    ),
  };
  if (isComplete(staticConfig)) return staticConfig;

  const apiOrigin = clean(environment.VITE_API_URL) || options.origin;
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    response = await (options.fetcher ?? fetch)(
      new URL("/api/auth/config", apiOrigin).toString(),
      {
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
  } catch {
    throw new Error("Could not reach SafeNet to load its public authentication settings.");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error("SafeNet's public authentication settings are unavailable.");
  }

  let remoteConfig: RuntimeConfigResponse;
  try {
    remoteConfig = await response.json() as RuntimeConfigResponse;
  } catch {
    throw new Error("SafeNet returned invalid public authentication settings.");
  }

  const config = {
    clerkPublishableKey: staticConfig.clerkPublishableKey || clean(remoteConfig.clerkPublishableKey),
    clerkProxyUrl: staticConfig.clerkProxyUrl || clean(remoteConfig.clerkProxyUrl),
    supabaseUrl: staticConfig.supabaseUrl || clean(remoteConfig.supabaseUrl),
    supabasePublishableKey: staticConfig.supabasePublishableKey || clean(remoteConfig.supabasePublishableKey),
  };
  if (!isComplete(config)) {
    throw new Error("SafeNet's public authentication settings are incomplete.");
  }
  return config;
}
