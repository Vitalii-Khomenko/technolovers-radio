/* Service worker: caches only the app shell.
   Radio streams (foreign addresses) always go straight to the network, never through the cache. */
const CACHE = "radio-v5";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Foreign hosts (streams, fonts) and non-GET requests: leave them alone
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        // Only remember complete, successful responses: no error pages (404/500), which would otherwise replace the real file offline,
        // and no partial responses (206), which the cache rejects anyway
        if (res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
        }
        return res;
      })
      // Offline: use the cached copy; the app page only stands in for page loads, not for images or scripts
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
        .then((res) => res || Response.error()))
  );
});
