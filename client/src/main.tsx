import { createRoot } from "react-dom/client";
import "./index.css";
import {
  initializeGlitchTip,
  installGlitchTipGlobalHandlers,
} from "./lib/glitchtip";
import { loadSafeNetRuntimeConfig } from "./lib/runtime-config";

void initializeGlitchTip();
installGlitchTipGlobalHandlers();

// Register the service worker for the production PWA only. A cache-first
// service worker must not intercept Vite's development modules or HMR.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let hasServiceWorkerController = Boolean(navigator.serviceWorker.controller);
  let reloadedForUpdatedWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The first controller takes over a newly installed app shell. Reloading
    // on that event flashes the WebView during first launch; only reload when
    // an already-controlled page receives an updated worker.
    if (!hasServiceWorkerController) {
      hasServiceWorkerController = true;
      return;
    }
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

function renderStartupMessage(message: string, retry = false) {
  const isWonderlandLightMode = document.documentElement.classList.contains("light");
  root.render(
    <main
      id={retry ? undefined : "startup-loader"}
      role={retry ? "alert" : "status"}
      style={{
        alignItems: "center",
        background: isWonderlandLightMode ? "#f1f3f6" : "#090b14",
        color: isWonderlandLightMode ? "#1b2432" : "#f8fafc",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        justifyContent: "center",
        minHeight: "100dvh",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          color: isWonderlandLightMode ? "#1b2432" : undefined,
          fontSize: "20px",
          fontWeight: 700,
          margin: 0,
        }}
      >
        {retry ? "SafeNet needs a connection" : "Starting SafeNet"}
      </h1>
      <p
        style={{
          color: isWonderlandLightMode ? "#525964" : "#94a3b8",
          margin: 0,
        }}
      >
        {message}
      </p>
      {retry && (
        <button
          type="button"
          onClick={() => {
            renderStartupMessage("Loading SafeNet's public settings…");
            void bootstrap();
          }}
          style={{
            background: "#2563eb",
            border: 0,
            borderRadius: "8px",
            color: "#fff",
            fontWeight: 600,
            padding: "12px 20px",
          }}
        >
          Retry
        </button>
      )}
    </main>,
  );
}

async function bootstrap() {
  try {
    const runtimeConfig = await loadSafeNetRuntimeConfig(import.meta.env, {
      origin: window.location.origin,
    });
    window.__SAFENET_RUNTIME_CONFIG__ = runtimeConfig;
    const { default: App } = await import("./App");
    openDashboardOnLaunch();
    root.render(<App />);
  } catch (error) {
    console.error("SafeNet startup configuration failed.", error);
    renderStartupMessage(
      "SafeNet could not load the public authentication settings. Check your connection and try again.",
      true,
    );
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
  window.history.replaceState(
    {},
    "",
    `/${window.location.search}${window.location.hash}`,
  );
}

renderStartupMessage("Loading SafeNet's public settings…");
void bootstrap();
