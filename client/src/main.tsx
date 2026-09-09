import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

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

// Keep the first paint visible long enough to avoid a compositor flash, but do
// not hold a ready app behind a decorative ten-second minimum.
const STARTUP_LOADER_DURATION_MS = 320;
const STARTUP_LOADER_FADE_MS = 180;
const STARTUP_COMPLETE_EVENT = "safenet:startup-complete";
let startupDurationComplete = false;
let startupAppReady = false;
let startupHandoffScheduled = false;

function completeStartupIfReady() {
  if (!startupDurationComplete || !startupAppReady) {
    return;
  }
  const loader = document.getElementById("startup-loader");
  if (
    !loader ||
    loader.classList.contains("is-complete") ||
    startupHandoffScheduled
  ) {
    return;
  }
  startupHandoffScheduled = true;
  // Let the app commit and paint before fading the static shell. One owner and
  // one frame handoff avoids the HTML loader, React tree, and native fallback
  // flashing over each other.
  window.requestAnimationFrame(() => {
    loader.setAttribute("aria-busy", "false");
    loader.classList.add("is-complete");
    window.setTimeout(() => {
      loader.remove();
      window.dispatchEvent(new Event(STARTUP_COMPLETE_EVENT));
    }, STARTUP_LOADER_FADE_MS);
  });
}

function markStartupAppReady() {
  startupAppReady = true;
  completeStartupIfReady();
}

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
    const progress = Math.min(
      1,
      elapsed / STARTUP_LOADER_DURATION_MS,
    );
    const value = Math.floor(
      progress * 100,
    );
    progressBar.style.transform = `scaleX(${progress})`;
    percentage.textContent = `${value}%`;
    loader.setAttribute("aria-valuenow", String(value));

    if (value < 100) {
      window.requestAnimationFrame(updateProgress);
      return;
    }

    startupDurationComplete = true;
    completeStartupIfReady();
  };

  window.requestAnimationFrame(updateProgress);
}

startStartupLoader();

function hideDashboardFallback() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.getElementById("dashboard-fallback")?.remove();
    });
  });
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

openDashboardOnLaunch();

hideDashboardFallback();
root.render(<App />);
markStartupAppReady();
