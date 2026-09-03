import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register service worker for PWA
if ("serviceWorker" in navigator) {
  const serviceWorkerVersion = import.meta.env.VITE_APP_VERSION || "dev";
  navigator.serviceWorker.register(`/service-worker.js?v=${encodeURIComponent(serviceWorkerVersion)}`).catch((err) => {
    console.log("Service Worker registration failed:", err);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
