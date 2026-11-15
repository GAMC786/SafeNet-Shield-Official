const CACHE_NAME = "safenet-dns-v4";
const urlsToCache = [
  "/",
  "/index.html",
  "/manifest.json",
];

const serviceWorker = self as unknown as ServiceWorkerGlobalScope;

serviceWorker.addEventListener("install", (event) => {
  void serviceWorker.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    }),
  );
});

serviceWorker.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith("safenet-dns-") && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        );
      }),
      serviceWorker.clients.claim(),
    ]),
  );
});

serviceWorker.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== serviceWorker.location.origin) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(async () => {
        const cachedPage = await caches.match("/index.html");
        return cachedPage ?? (await caches.match("/")) ?? Response.error();
      }),
    );
    return;
  }

  // Auth and API responses can change between requests; never serve them from
  // the app-shell cache.
  if (requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  // Only fingerprinted build assets are safe to reuse from cache.
  if (!requestUrl.pathname.startsWith("/assets/")) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedAsset = await cache.match(event.request);
      if (cachedAsset) {
        return cachedAsset;
      }

      const response = await fetch(event.request);
      if (response.ok && response.type === "basic") {
        void cache.put(event.request, response.clone());
      }
      return response;
    }),
  );
});

export {};