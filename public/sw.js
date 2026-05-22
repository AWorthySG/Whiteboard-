// Service worker for A Worthy Whiteboard.
//
// Two cache buckets:
//
// 1. STATIC_CACHE — long-lived, holds icon assets and Next.js's
//    content-hashed JS/CSS chunks. These filenames embed a content
//    hash (e.g. /_next/static/chunks/abc123-foo.js), so we can serve
//    a cached response indefinitely. The first launch is the only one
//    that has to hit the network for chunks; every subsequent open
//    boots from cache and the page is interactive in under a second.
//
// 2. SHELL_CACHE — short-lived stale-while-revalidate for the few
//    other safe-to-cache assets (manifest, top-level icon).
//
// Live data — Next.js route HTML, API calls, Supabase, LiveKit,
// the tldraw sync worker — is always network-only. We never want
// a stale room shell, a stale auth token, or a stale snapshot.

const STATIC_CACHE = "wb-static-v2";
const SHELL_CACHE = "wb-shell-v2";
const SHELL_ASSETS = ["/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        await cache.addAll(SHELL_ASSETS);
      } catch {
        // No-op — the network will serve them normally.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const keep = new Set([STATIC_CACHE, SHELL_CACHE]);
      await Promise.all(
        names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// Cache-first for Next.js content-hashed static chunks. The hash in
// the filename means a deployed bundle is effectively immutable — if
// the JS changes, Next emits a new filename. So we never need to
// revalidate; just keep the response forever.
function isHashedStaticAsset(url) {
  return url.origin === self.location.origin &&
    url.pathname.startsWith("/_next/static/");
}

// Stale-while-revalidate for the small set of shell assets that
// could change between deploys but don't need to be perfectly fresh.
function isShellAsset(url) {
  return SHELL_ASSETS.includes(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (isHashedStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      })(),
    );
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(req);
        // Kick off a background refresh either way so the next launch
        // picks up any deploy-time changes.
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => undefined);
        return cached ?? (await refresh) ?? fetch(req);
      })(),
    );
    return;
  }

  // Everything else (HTML routes, API calls, Supabase, LiveKit,
  // sync worker WebSocket upgrade requests, etc.) is always network.
});
