// Offline support: keep the app shell so Decision Notes opens without a network.
// Gemini Nano runs inside Chrome, so with the shell cached the whole app works offline.
const CACHE = "decision-notes-v2";

self.addEventListener("install", (event) => {
  // Cache the page and the hashed JS/CSS bundles it links to, so the app works offline
  // right after the first visit (not only after a reload).
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const shell = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];
      try {
        const html = await (await fetch("/index.html", { cache: "no-store" })).text();
        shell.push(...new Set(html.match(/\/assets\/[^"']+\.(?:js|css)/g) || []));
      } catch {
        // Offline during install: the fetch handler fills the cache later.
      }
      await cache.addAll(shell);
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only same-origin GETs. Firebase, App Check and Gemini calls always go to the network.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // Network first (fresh deploys win), cache as fallback when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html")))
  );
});
