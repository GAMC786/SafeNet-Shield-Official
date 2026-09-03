const CACHE_NAME = "safenet-dns-v2";
const urlsToCache = [
  "/",
  "/index.html",
  "/manifest.json",
];

const serviceWorker = self as unknown as ServiceWorkerGlobalScope;

serviceWorker.addEventListener("install", (event) => {
  serviceWorker.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    }),
  );
});

serviceWorker.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      serviceWorker.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
    ]),
  );
});

serviceWorker.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isDevelopmentAsset =
    requestUrl.pathname.startsWith("/src/")
    || requestUrl.pathname.startsWith("/@")
    || requestUrl.pathname.includes("node_modules")
    || requestUrl.pathname === "/service-worker.js";
  if (isDevelopmentAsset) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      });
    }),
  );
});

export {};