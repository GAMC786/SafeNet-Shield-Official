import { createRoot } from "react-dom/client";
import App, { getBuildClerkConfig, type ClerkRuntimeConfig } from "./App";
import "./index.css";
import { resolveApiUrl } from "./lib/api";

// Register the service worker for the production PWA only. A cache-first
// service worker must not intercept Vite's development modules or HMR.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch((err) => {
    console.log("Service Worker registration failed:", err);
  });
} else if (!import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    return Promise.all(registrations.map((registration) => registration.unregister()));
  });
  if ("caches" in window) {
    void caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("safenet-dns-"))
          .map((cacheName) => caches.delete(cacheName)),
      );
    });
  }
}

const root = createRoot(document.getElementById("root")!);

function renderStartupError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "The secure app configuration could not be loaded.";
  root.render(
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#090b14] p-6 text-center text-foreground">
      <div className="max-w-md space-y-3">
        <h1 className="font-display text-xl tracking-[0.12em] text-white">
          SafeNet Shield could not start
        </h1>
        <p className="text-sm text-slate-300">
          {message}
        </p>
      </div>
    </div>,
  );
}

async function loadClerkConfig(): Promise<ClerkRuntimeConfig> {
  const buildConfig = getBuildClerkConfig();
  if (buildConfig.publishableKey) {
    return buildConfig;
  }

  const response = await fetch(resolveApiUrl("/api/auth/config"), {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json().catch(() => null)) as
    | { publishableKey?: unknown; proxyUrl?: unknown; message?: unknown }
    | null;

  if (!response.ok || typeof payload?.publishableKey !== "string" || !payload.publishableKey) {
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : "The SafeNet server did not provide secure sign-in configuration.",
    );
  }

  return {
    publishableKey: payload.publishableKey,
    proxyUrl:
      typeof payload.proxyUrl === "string" && payload.proxyUrl.length > 0
        ? payload.proxyUrl
        : buildConfig.proxyUrl,
  };
}

void loadClerkConfig()
  .then((clerkConfig) => root.render(<App clerkConfig={clerkConfig} />))
  .catch(renderStartupError);
