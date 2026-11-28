export type SafeNetRuntimeConfig = {
  auth0Domain: string;
  auth0ClientId: string;
  auth0Audience: string;
  googleEnabled?: boolean;
};

export type RuntimeConfigEnvironment = {
  DEV: boolean;
  VITE_API_URL?: string;
  VITE_AUTH0_DOMAIN?: string;
  VITE_AUTH0_CLIENT_ID?: string;
  VITE_AUTH0_AUDIENCE?: string;
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

function cleanAuth0Domain(value?: string) {
  return clean(value).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function isComplete(config: RuntimeConfigResponse): config is SafeNetRuntimeConfig {
  return Boolean(
    clean(config.auth0Domain)
      && clean(config.auth0ClientId)
      && clean(config.auth0Audience),
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
    auth0Domain: cleanAuth0Domain(environment.VITE_AUTH0_DOMAIN),
    auth0ClientId: clean(environment.VITE_AUTH0_CLIENT_ID),
    auth0Audience: clean(environment.VITE_AUTH0_AUDIENCE),
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
    auth0Domain: staticConfig.auth0Domain || cleanAuth0Domain(remoteConfig.auth0Domain),
    auth0ClientId: staticConfig.auth0ClientId || clean(remoteConfig.auth0ClientId),
    auth0Audience: staticConfig.auth0Audience || clean(remoteConfig.auth0Audience),
    googleEnabled: remoteConfig.googleEnabled === true,
  };
  if (!isComplete(config)) {
    throw new Error("SafeNet's public authentication settings are incomplete.");
  }
  return config;
}
