// Minimal service worker so browsers consider the app installable.
// We intentionally don't cache anything aggressively — the room is live
// and a stale cached page would be confusing. The SW exists to satisfy
// PWA-install requirements; the network handles the rest.

const CACHE = "whiteboard-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(["/manifest.webmanifest", "/icon.svg"]);
      } catch {
        // No-op; the network will serve them normally.
      }
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Pass through everything; let the cache serve only static icons offline.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname === "/manifest.webmanifest" || url.pathname === "/icon.svg") {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req)),
    );
  }
});
