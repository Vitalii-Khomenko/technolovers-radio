/* Service Worker: legt nur die App-Hülle in den Cache.
   Radio-Streams (fremde Adressen) laufen immer direkt, nie über den Cache. */
const CACHE = "tl-radio-v3";
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
  // Fremde Hosts (Streams, Schriften) und Nicht-GET: nicht anfassen
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        // Nur vollständige, erfolgreiche Antworten merken: keine Fehlerseiten (404/500), die offline sonst die echte Datei ersetzen,
        // und keine Teilantworten (206), die der Cache ohnehin ablehnt
        if (res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
        }
        return res;
      })
      // Offline: Treffer aus dem Cache; die App-Seite nur als Ersatz für Seitenaufrufe, nicht für Bilder oder Skripte
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
        .then((res) => res || Response.error()))
  );
});
