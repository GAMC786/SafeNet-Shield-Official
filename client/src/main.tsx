import { createRoot } from "react-dom/client";
import App, {
  getBuildClerkConfig,
  type ClerkRuntimeConfig,
} from "./App";
import "./index.css";
import { resolveApiUrl } from "./lib/api";

// Register the service worker for the production PWA only. A cache-first
// service worker must not intercept Vite's development modules or HMR.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let reloadedForUpdatedWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForUpdatedWorker) {
      return;
    }
    reloadedForUpdatedWorker = true;
    window.location.reload();
  });
  navigator.serviceWorker
    .register("/service-worker.js")
    .then((registration) => registration.update())
    .catch((err) => {
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

const STARTUP_LOADER_DURATION_MS = 10_000;

function startStartupLoader() {
  const loader = document.getElementById("startup-loader");
  const progressBar = document.getElementById("startup-loader-progress-bar");
  const percentage = document.getElementById("startup-loader-percentage");
  if (!loader || !progressBar || !percentage) {
    return;
  }

  const startedAt = performance.now();
  const updateProgress = () => {
    const elapsed = performance.now() - startedAt;
    const value = Math.min(
      100,
      Math.floor((elapsed / STARTUP_LOADER_DURATION_MS) * 100),
    );
    progressBar.style.width = `${value}%`;
    percentage.textContent = `${value}%`;
    loader.setAttribute("aria-valuenow", String(value));

    if (value < 100) {
      window.requestAnimationFrame(updateProgress);
      return;
    }

    loader.classList.add("is-complete");
    window.setTimeout(() => loader.remove(), 240);
  };

  window.requestAnimationFrame(updateProgress);
}

startStartupLoader();

function hideDashboardFallback() {
  document.getElementById("dashboard-fallback")?.remove();
}

function renderStartupError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "The secure app configuration could not be loaded.";
  hideDashboardFallback();
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

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(resolveApiUrl("/api/auth/config"), {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
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
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The SafeNet server did not respond within 12 seconds.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function isPackagedApp() {
  return (
    window.location.hostname === "localhost" &&
    (window.location.protocol === "http:" || window.location.protocol === "https:")
  );
}

function openDashboardOnLaunch() {
  if (!isPackagedApp() || window.location.pathname === "/") {
    return;
  }
  window.history.replaceState({}, "", "/");
}

openDashboardOnLaunch();

const buildConfig = getBuildClerkConfig();
if (buildConfig.publishableKey) {
  hideDashboardFallback();
  root.render(<App clerkConfig={buildConfig} />);
} else if (isPackagedApp()) {
  // Keep the static Command Center visible if a release was built without
  // Clerk configuration. Never replace it with a blank surface.
  console.warn("SafeNet APK is missing its embedded Clerk publishable key.");
} else {
  void loadClerkConfig()
    .then((clerkConfig) => {
      hideDashboardFallback();
      root.render(<App clerkConfig={clerkConfig} />);
    })
    .catch(renderStartupError);
}
