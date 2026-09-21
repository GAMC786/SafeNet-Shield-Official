import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import {
  initializeGlitchTip,
  installGlitchTipGlobalHandlers,
} from "./lib/glitchtip";

void initializeGlitchTip();
installGlitchTipGlobalHandlers();

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

openDashboardOnLaunch();

root.render(<App />);
